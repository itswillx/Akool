import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { captureException } from "../_shared/sentry.ts";
import {
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  type LookupAction,
  type LookupItem,
  type LookupRequest,
  type LookupResponse,
  type OutlineSection,
  type ProviderId,
  type ProviderStatus,
} from "./types.ts";
import {
  ENABLED_PROVIDERS,
  PROVIDERS,
  ProviderFailure,
  articleUrl,
  creativeCommonsLicenseUrl,
  doiUrl,
  fetchProvider,
  githubRepositoryUrl,
  lookupContactEmail,
  openLibraryWorkUrl,
  stackQuestionUrl,
} from "./providers.ts";
import {
  cacheKey,
  isProviderCooling,
  readCache,
  writeCache,
  writeProviderCooldown,
} from "./cache.ts";
import { compactText, wikipediaExtractToMarkdown } from "./transform.ts";

// Proxy para APIs publicas SEM CHAVE (Wikipedia, Wikcionario e, na fase 4,
// Open Library / Crossref / Stack Exchange / GitHub). Nenhum LLM envolvido.
//
// Por que server-side e nao fetch direto do browser:
//   1. o CSP de producao so libera connect-src para *.supabase.co;
//   2. a Wikimedia exige User-Agent identificavel, que o browser nao deixa setar;
//   3. o cache precisa ser COMPARTILHADO, porque os tetos das APIs sao por IP;
//   4. nao entrega o IP de cada usuario a seis terceiros.
//
// Molde: supabase/functions/ai-chat/index.ts (CORS, auth, check_rate_limit).

// SEC-007: CORS em _shared/cors.ts; sem ALLOWED_ORIGINS, só produção.
const ALLOWED_ORIGINS = allowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));

function corsHeadersFor(req: Request): Record<string, string> {
  // O PostgREST nao expoe Retry-After (ver src/lib/rateLimit.ts); aqui a
  // config de CORS e nossa, entao da para expor.
  return corsHeaders(req, ALLOWED_ORIGINS, { exposeHeaders: ["Retry-After"] });
}

interface RateLimitVerdict {
  allowed: boolean;
  hits: number;
  limit: number;
  retry_after: number;
  tripped: boolean;
}

// deno-lint-ignore no-explicit-any
async function checkRateLimit(
  client: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict | null> {
  try {
    const { data, error } = await client.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_subject: subject,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] RPC falhou:", error.message);
      return null;
    }
    return data as RateLimitVerdict;
  } catch (err) {
    console.error("[rate-limit] excecao:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

const USER_LIMIT = 120;
const USER_WINDOW = 3600;

/**
 * Orcamento GLOBAL do provedor.
 *
 * 🔴 Divergencia deliberada do molde do ai-chat, que e fail-OPEN: aqui e
 * fail-CLOSED. Se o banco vacilar e nao der para confirmar orcamento, o
 * provedor e pulado. Fail-open num teto de 40/h (GitHub) queimaria a hora
 * inteira em segundos e poderia banir o IP de saida para TODOS os usuarios.
 * Resultado parcial e o que torna o fail-closed barato.
 *
 * NAO "conserte" isto de volta para fail-open.
 */
// deno-lint-ignore no-explicit-any
async function reserveProviderBudget(client: any, id: ProviderId, cost: number): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
  const spec = PROVIDERS[id];
  for (let token = 0; token < cost; token += 1) {
    const budget = await checkRateLimit(
      client, `study_lookup:${spec.budgetBucket}`, "global", spec.globalLimit, spec.globalWindowSeconds,
    );
    if (!budget?.allowed) return false;
    const burst = await checkRateLimit(
      client, `study_lookup:${spec.budgetBucket}:burst`, "global", spec.burstLimit, spec.burstWindowSeconds,
    );
    if (!burst?.allowed) return false;
  }
  return true;
}

function json(body: unknown, status: number, cors: Record<string, string>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", ...extra },
  });
}

// ─── Acoes ───

interface Ctx {
  // deno-lint-ignore no-explicit-any
  service: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
  statuses: ProviderStatus[];
}

/** Busca-ou-chama, com cache compartilhado antes do orcamento. */
async function viaCache<T>(
  ctx: Ctx,
  id: ProviderId,
  action: LookupAction,
  key: string,
  upstreamCost: number,
  call: () => Promise<T>,
  isEmpty: (value: T) => boolean,
): Promise<T | null> {
  const spec = PROVIDERS[id];
  const hit = await readCache<T>(ctx.service, id, action, key);
  if (hit) {
    ctx.statuses.push({ id, ok: true, cached: true });
    return hit.payload;
  }
  if (await isProviderCooling(ctx.service, id)) {
    ctx.statuses.push({ id, ok: false, cached: false, error: "backoff" });
    return null;
  }
  // Orcamento so e consultado em MISS -- um hit custa zero.
  if (!(await reserveProviderBudget(ctx.service, id, upstreamCost))) {
    ctx.statuses.push({ id, ok: false, cached: false, error: "budget" });
    return null;
  }
  try {
    const value = await call();
    const ttl = id === "wikipedia" && action === "outline" ? 14 * 86400 : spec.ttlSeconds;
    await writeCache(ctx.service, id, action, key, value, ttl, isEmpty(value));
    ctx.statuses.push({ id, ok: true, cached: false });
    return value;
  } catch (err) {
    const kind = err instanceof ProviderFailure ? err.kind : "unavailable";
    ctx.statuses.push({ id, ok: false, cached: false, error: kind });
    return null;
  }
}

// deno-lint-ignore no-explicit-any
function searchTitles(payload: any): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
  const hits = payload?.query?.search;
  if (!Array.isArray(hits)) return [];
  return hits.map((h: { title?: string }) => h?.title).filter((t: unknown): t is string => typeof t === "string");
}

async function doOutline(
  ctx: Ctx,
  query: string,
  exactTitle?: string,
): Promise<Partial<LookupResponse>> {
  const spec = PROVIDERS.wikipedia;
  const key = cacheKey(`outline:${exactTitle ? `page:${exactTitle}` : `search:${query}`}`);
  const payload = await viaCache(
    ctx, "wikipedia", "outline", key,
    exactTitle ? 1 : 2,
    async () => {
      const titles = exactTitle
        ? [exactTitle]
        : searchTitles(await fetchProvider(spec, new URLSearchParams({
          action: "query", list: "search", srsearch: query, srlimit: "5",
          format: "json", formatversion: "2",
        })));
      if (titles.length === 0) return { pageTitle: "", alternates: [], sections: [] };
      const parsed = await fetchProvider(spec, new URLSearchParams({
        action: "parse", page: titles[0], prop: "sections",
        format: "json", formatversion: "2",
      // deno-lint-ignore no-explicit-any
      })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
      const sections: OutlineSection[] = Array.isArray(parsed?.parse?.sections)
        ? parsed.parse.sections.map((s: Record<string, unknown>) => ({
          index: String(s.index ?? ""),
          level: String(s.level ?? ""),
          line: String(s.line ?? ""),
          anchor: String(s.anchor ?? ""),
        }))
        : [];
      return { pageTitle: titles[0], alternates: exactTitle ? [] : titles.slice(1), sections };
    },
    v => !v.pageTitle,
  );
  if (!payload || !payload.pageTitle) return { results: [] };
  return {
    results: [],
    outline: {
      pageTitle: payload.pageTitle,
      pageUrl: articleUrl(spec, payload.pageTitle),
      alternates: payload.alternates,
      sections: payload.sections,
    },
  };
}

async function doSummary(ctx: Ctx, query: string): Promise<Partial<LookupResponse>> {
  const spec = PROVIDERS.wikipedia;
  const key = cacheKey(`summary:${query}`);
  const payload = await viaCache(
    ctx, "wikipedia", "summary", key,
    1,
    async () => {
      // O upstream vem em HTML apenas dentro da function. A transformacao
      // remove todas as tags e preserva somente negrito como Markdown, para
      // alimentar o glossario sem jamais devolver HTML ao navegador.
      // generator=search resolve busca E extracao numa chamada so. Usar
      // titles= direto exigiria que a query fosse o titulo EXATO do artigo,
      // o que quase nunca vale para o titulo de uma etapa de estudo.
      const data = await fetchProvider(spec, new URLSearchParams({
        action: "query", generator: "search", gsrsearch: query, gsrlimit: "1",
        prop: "extracts", exintro: "1",
        redirects: "1", format: "json", formatversion: "2",
      // deno-lint-ignore no-explicit-any
      })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
      const page = data?.query?.pages?.[0];
      const text = wikipediaExtractToMarkdown(page?.extract);
      if (!page || page.missing || !text) {
        return { pageTitle: "", text: "" };
      }
      return { pageTitle: String(page.title ?? query), text };
    },
    v => !v.text,
  );
  if (!payload || !payload.text) return { results: [] };
  return {
    results: [],
    summary: {
      pageTitle: payload.pageTitle,
      pageUrl: articleUrl(spec, payload.pageTitle),
      text: payload.text,
      license: spec.license,
      licenseUrl: spec.licenseUrl,
    },
  };
}

async function doDefine(ctx: Ctx, query: string): Promise<Partial<LookupResponse>> {
  // Wikcionario primeiro; sem verbete, o lead da Wikipedia.
  for (const id of ["wiktionary", "wikipedia"] as const) {
    const spec = PROVIDERS[id];
    const key = cacheKey(`define:${query}`);
    const payload = await viaCache(
      ctx, id, "define", key,
      1,
      async () => {
        const data = await fetchProvider(spec, new URLSearchParams({
          action: "query", prop: "extracts", explaintext: "1", exchars: "600",
          redirects: "1", titles: query, format: "json", formatversion: "2",
        // deno-lint-ignore no-explicit-any
        })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
        const page = data?.query?.pages?.[0];
        if (!page || page.missing || typeof page.extract !== "string" || !page.extract.trim()) {
          return { pageTitle: "", text: "" };
        }
        return { pageTitle: String(page.title ?? query), text: page.extract.trim() };
      },
      v => !v.text,
    );
    if (payload && payload.text) {
      return {
        results: [{
          id: `${id}:${payload.pageTitle}`,
          title: payload.pageTitle,
          url: articleUrl(spec, payload.pageTitle),
          snippet: payload.text,
          provider: id,
          license: spec.license,
          licenseUrl: spec.licenseUrl,
        }],
      };
    }
  }
  return { results: [] };
}

async function resourceLookup(
  ctx: Ctx,
  id: ProviderId,
  query: string,
  limit: number,
): Promise<LookupItem[]> {
  const spec = PROVIDERS[id];
  const key = cacheKey(`resources:${limit}:${query}`);
  const items = await viaCache<LookupItem[]>(
    ctx, id, "resources", key, 1,
    async () => {
      if (id === "wikipedia") {
        const data = await fetchProvider(spec, new URLSearchParams({
          action: "query", list: "search", srsearch: query, srlimit: String(limit),
          format: "json", formatversion: "2",
        }));
        return searchTitles(data).map(title => ({
          id: `wikipedia:${title}`,
          title,
          url: articleUrl(spec, title),
          provider: id,
          license: spec.license,
          licenseUrl: spec.licenseUrl,
        }));
      }

      if (id === "openlibrary") {
        // deno-lint-ignore no-explicit-any
        const data = await fetchProvider(spec, new URLSearchParams({
          q: query, limit: String(limit),
          fields: "key,title,author_name,first_publish_year",
        })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
        return (Array.isArray(data?.docs) ? data.docs : []).flatMap((doc: Record<string, unknown>) => {
          const url = openLibraryWorkUrl(doc.key);
          const title = compactText(doc.title);
          if (!url || !title) return [];
          const authors = Array.isArray(doc.author_name)
            ? doc.author_name.filter((a): a is string => typeof a === "string").slice(0, 2).join(", ")
            : "";
          const year = Number.isFinite(Number(doc.first_publish_year)) ? String(doc.first_publish_year) : "";
          const snippet = [authors, year].filter(Boolean).join(" · ");
          return [{
            id: `openlibrary:${String(doc.key)}`, title, url,
            ...(snippet ? { snippet } : {}), provider: id,
            license: spec.license, licenseUrl: spec.licenseUrl,
          }];
        }).slice(0, limit);
      }

      if (id === "crossref") {
        const params = new URLSearchParams({
          "query.bibliographic": query,
          rows: String(limit),
          select: "DOI,title,author,published-print,published-online",
        });
        const email = lookupContactEmail();
        if (email) params.set("mailto", email);
        // deno-lint-ignore no-explicit-any
        const data = await fetchProvider(spec, params) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
        return (Array.isArray(data?.message?.items) ? data.message.items : []).flatMap((item: Record<string, unknown>) => {
          const url = doiUrl(item.DOI);
          const titles = Array.isArray(item.title) ? item.title : [];
          const title = compactText(titles[0]);
          if (!url || !title) return [];
          const authors = Array.isArray(item.author)
            ? item.author.slice(0, 2).map((a: Record<string, unknown>) => compactText(`${a.given ?? ""} ${a.family ?? ""}`)).filter(Boolean).join(", ")
            : "";
          return [{
            id: `crossref:${String(item.DOI)}`, title, url,
            ...(authors ? { snippet: authors } : {}), provider: id,
            license: spec.license, licenseUrl: spec.licenseUrl,
          }];
        }).slice(0, limit);
      }

      if (id === "stackexchange") {
        // deno-lint-ignore no-explicit-any
        const data = await fetchProvider(spec, new URLSearchParams({
          site: "pt.stackoverflow", order: "desc", sort: "relevance",
          q: query, pagesize: String(limit), filter: "default",
        })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
        if (Number(data?.backoff) > 0) {
          await writeProviderCooldown(ctx.service, id, Number(data.backoff));
        }
        return (Array.isArray(data?.items) ? data.items : []).flatMap((item: Record<string, unknown>) => {
          const url = stackQuestionUrl(item.question_id);
          const title = compactText(item.title);
          if (!url || !title) return [];
          const license = compactText(item.content_license) || spec.license;
          const licenseUrl = creativeCommonsLicenseUrl(license) ?? spec.licenseUrl;
          return [{
            id: `stackexchange:${String(item.question_id)}`, title, url,
            provider: id, license,
            licenseUrl,
          }];
        }).slice(0, limit);
      }

      // GitHub: a URL publica e derivada de full_name, nunca ecoada do payload.
      // deno-lint-ignore no-explicit-any
      const data = await fetchProvider(spec, new URLSearchParams({
        q: query, per_page: String(limit), sort: "stars", order: "desc",
      })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado
      return (Array.isArray(data?.items) ? data.items : []).flatMap((item: Record<string, unknown>) => {
        const url = githubRepositoryUrl(item.full_name);
        const title = compactText(item.full_name);
        if (!url || !title) return [];
        const language = compactText(item.language);
        const stars = Number.isFinite(Number(item.stargazers_count)) ? `★ ${Number(item.stargazers_count)}` : "";
        const snippet = [language, stars].filter(Boolean).join(" · ");
        const repoLicense = item.license && typeof item.license === "object"
          ? compactText((item.license as Record<string, unknown>).spdx_id)
          : "";
        return [{
          id: `github:${String(item.id ?? title)}`, title, url,
          ...(snippet ? { snippet } : {}), provider: id,
          license: repoLicense && repoLicense !== "NOASSERTION" ? repoLicense : spec.license,
          licenseUrl: spec.licenseUrl,
        }];
      }).slice(0, limit);
    },
    value => value.length === 0,
  );
  return items ?? [];
}

async function doResources(
  ctx: Ctx,
  query: string,
  limit: number,
  providers: ProviderId[],
): Promise<Partial<LookupResponse>> {
  // Fan-out entre hosts diferentes; cada adapter ainda passa pelo cache e
  // pelos dois gates globais. Falha de uma fonte nao cancela as demais.
  const groups = await Promise.all(providers.map(id => resourceLookup(ctx, id, query, limit)));
  return { results: groups.flat() };
}

// ─── Handler ───

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_authorization" }, 401, cors);

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await anon.auth.getUser();
    if (userError || !user) return json({ error: "unauthorized" }, 401, cors);

    let body: LookupRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad_request" }, 400, cors);
    }

    const action = body?.action;
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!["outline", "summary", "define", "resources"].includes(action)) {
      return json({ error: "bad_request" }, 400, cors);
    }
    if (!query || query.length > MAX_QUERY_LENGTH) {
      return json({ error: "bad_request" }, 400, cors);
    }
    const limit = Math.min(Math.max(Math.floor(Number(body?.limit) || 5), 1), MAX_LIMIT);
    const pageTitle = typeof body?.pageTitle === "string" ? body.pageTitle.trim() : "";
    if (pageTitle.length > MAX_QUERY_LENGTH || (pageTitle && action !== "outline")) {
      return json({ error: "bad_request" }, 400, cors);
    }
    let providers: ProviderId[] = ["wikipedia"];
    if (action === "resources" && body?.providers !== undefined) {
      if (!Array.isArray(body.providers) || body.providers.length === 0) {
        return json({ error: "bad_request" }, 400, cors);
      }
      const unique = [...new Set(body.providers)];
      if (unique.some(id => typeof id !== "string" || !ENABLED_PROVIDERS.includes(id as ProviderId))) {
        return json({ error: "bad_request" }, 400, cors);
      }
      providers = unique as ProviderId[];
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Teto por usuario ANTES de qualquer trabalho. Fail-open (como o ai-chat):
    // contador indisponivel nao pode negar servico a todo mundo.
    const rate = await checkRateLimit(service, "study_lookup:uid", user.id, USER_LIMIT, USER_WINDOW);
    if (rate && !rate.allowed) {
      return json(
        { error: "rate_limited", retry_after: rate.retry_after },
        429, cors, { "Retry-After": String(rate.retry_after) },
      );
    }

    const ctx: Ctx = { service, statuses: [] };
    let partial: Partial<LookupResponse>;
    switch (action) {
      case "outline": partial = await doOutline(ctx, query, pageTitle || undefined); break;
      case "summary": partial = await doSummary(ctx, query); break;
      case "define": partial = await doDefine(ctx, query); break;
      default: partial = await doResources(ctx, query, limit, providers); break;
    }

    const response: LookupResponse = {
      action,
      results: partial.results ?? [],
      ...(partial.outline ? { outline: partial.outline } : {}),
      ...(partial.summary ? { summary: partial.summary } : {}),
      providers: ctx.statuses,
    };
    // Sempre 200 quando a requisicao era valida: falha de provedor viaja no
    // corpo. Um 5xx colidiria com o catch de "backend nao configurado" do
    // cliente e faria o usuario achar que a function nao foi deployada.
    return json(response, 200, cors);
  } catch (err) {
    console.error("[study-lookup]", err instanceof Error ? err.message : String(err));
    await captureException(err, { fn: "study-lookup" });
    return json({ error: "internal_error" }, 500, cors);
  }
});

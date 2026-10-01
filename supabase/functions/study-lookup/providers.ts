import type { ProviderId } from "./types.ts";

// Specs congeladas dos provedores. NENHUM deles usa chave de API.
//
// 🔴 A URL de saida e remontada de `origin` + `path` (literais) a cada chamada,
// e o texto do usuario so entra como VALOR de URLSearchParams -- nunca em host
// nem em path. `assertProviderUrl` confere isso antes de todo fetch, e o fetch
// usa `redirect: "error"` porque um 30x para host controlado por atacante e o
// bypass classico de SSRF (api.php nunca precisa de redirect).

export interface ProviderSpec {
  id: ProviderId;
  /** Exato, com esquema. Comparado com === antes do fetch. */
  origin: string;
  /** Literal, nunca interpolado. */
  path: string;
  license: string;
  licenseUrl: string;
  ttlSeconds: number;
  /** Bucket compartilhado quando varios hosts pertencem ao mesmo operador. */
  budgetBucket: string;
  /** Teto GLOBAL (nao por usuario): a function tem um unico IP de saida. */
  globalLimit: number;
  globalWindowSeconds: number;
  /** Suaviza rajadas que um bucket horario sozinho nao impede. */
  burstLimit: number;
  burstWindowSeconds: number;
}

const HOUR = 3600;
const DAY = 86400;

// Wikipedia e Wikcionario compartilham os limites globais da Wikimedia. O
// teto horario e autoimposto e conservador; o bucket curto evita rajadas.
export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  wikipedia: {
    id: "wikipedia",
    origin: "https://pt.wikipedia.org",
    path: "/w/api.php",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    ttlSeconds: 7 * DAY,
    budgetBucket: "wikimedia",
    globalLimit: 500,
    globalWindowSeconds: HOUR,
    burstLimit: 3,
    burstWindowSeconds: 1,
  },
  wiktionary: {
    id: "wiktionary",
    origin: "https://pt.wiktionary.org",
    path: "/w/api.php",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    ttlSeconds: 30 * DAY,
    budgetBucket: "wikimedia",
    globalLimit: 500,
    globalWindowSeconds: HOUR,
    burstLimit: 3,
    burstWindowSeconds: 1,
  },
  // Fase 4 -- specs prontas, ainda sem uso.
  openlibrary: {
    id: "openlibrary",
    origin: "https://openlibrary.org",
    path: "/search.json",
    license: "Open Library",
    licenseUrl: "https://openlibrary.org/developers/licensing",
    ttlSeconds: 30 * DAY,
    budgetBucket: "openlibrary",
    globalLimit: 300,
    globalWindowSeconds: HOUR,
    burstLimit: 3,
    burstWindowSeconds: 1,
  },
  crossref: {
    id: "crossref",
    origin: "https://api.crossref.org",
    path: "/works",
    license: "Crossref",
    licenseUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
    ttlSeconds: 30 * DAY,
    budgetBucket: "crossref",
    globalLimit: 500,
    globalWindowSeconds: HOUR,
    burstLimit: 3,
    burstWindowSeconds: 1,
  },
  stackexchange: {
    id: "stackexchange",
    origin: "https://api.stackexchange.com",
    path: "/2.3/search/advanced",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    // Teto duro de 300/dia por IP: TTL longo e o que torna isso viavel.
    ttlSeconds: 3 * DAY,
    budgetBucket: "stackexchange",
    globalLimit: 200,
    globalWindowSeconds: DAY,
    burstLimit: 10,
    burstWindowSeconds: 1,
  },
  github: {
    id: "github",
    origin: "https://api.github.com",
    path: "/search/repositories",
    license: "GitHub",
    licenseUrl: "https://docs.github.com/en/rest",
    ttlSeconds: DAY,
    budgetBucket: "github",
    // 60/h por IP dividido por toda a base -- na pratica vive esgotado.
    globalLimit: 40,
    globalWindowSeconds: HOUR,
    burstLimit: 8,
    burstWindowSeconds: 60,
  },
};

/** Provedores realmente ligados. Mantido explicito para validar o request. */
export const ENABLED_PROVIDERS: ProviderId[] = [
  "wikipedia", "wiktionary", "openlibrary", "crossref", "stackexchange", "github",
];

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;

export function lookupContact(): string {
  return Deno.env.get("LOOKUP_CONTACT")?.trim() || "https://www.slinkysalsichinha.com.br";
}

export function lookupContactEmail(): string | null {
  const contact = lookupContact();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null;
}

function userAgent(): string {
  // Contato vem de env, nunca literal: AGENTS.md 8 proibe dado sensivel em
  // codigo, e e-mail cru em repo e isca de scraper. A Wikimedia EXIGE um
  // User-Agent identificavel.
  return `AkoolEstudos/1.0 (${lookupContact()})`;
}

export function buildProviderUrl(spec: ProviderSpec, params: URLSearchParams): URL {
  const url = new URL(spec.path, spec.origin);
  url.search = params.toString();
  // Rede de seguranca contra uma spec malformada ou um path interpolado por
  // engano numa mudanca futura.
  if (url.origin !== spec.origin || url.pathname !== spec.path) {
    throw new Error("provider_url_mismatch");
  }
  return url;
}

export class ProviderFailure extends Error {
  constructor(readonly kind: "timeout" | "unavailable" | "too_large" | "budget" | "backoff") {
    super(kind);
    this.name = "ProviderFailure";
  }
}

/**
 * Le a resposta com teto de bytes. `action=parse` num artigo grande devolve
 * megabytes e derruba o isolate, entao nao se faz `await res.text()` as cegas.
 */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await res.body?.cancel();
    throw new ProviderFailure("too_large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new ProviderFailure("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Chama um provedor. Nunca repassa corpo nem status do upstream para fora. */
export async function fetchProvider(
  spec: ProviderSpec,
  params: URLSearchParams,
): Promise<unknown> {
  const url = buildProviderUrl(spec, params);
  const ua = userAgent();
  let res: Response;
  try {
    res = await fetch(url, {
      // Um 30x levaria para um host fora da allowlist -- tratamos como falha.
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": ua,
        // User-Agent e forbidden header em fetch e os runtimes divergem sobre
        // honra-lo; Api-User-Agent e o que a Wikimedia documenta ler.
        "Api-User-Agent": ua,
        "Accept": "application/json",
      },
    });
  } catch (err) {
    if (err instanceof ProviderFailure) throw err;
    const name = err instanceof Error ? err.name : "";
    throw new ProviderFailure(name === "TimeoutError" ? "timeout" : "unavailable");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ProviderFailure(res.status === 429 || res.status === 403 ? "budget" : "unavailable");
  }
  const text = await readCapped(res);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderFailure("unavailable");
  }
}

/** URL publica canonica de um artigo -- a UNICA URL devolvida ao cliente. */
export function articleUrl(spec: ProviderSpec, title: string): string {
  return `${spec.origin}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

export function openLibraryWorkUrl(key: unknown): string | null {
  if (typeof key !== "string" || !/^\/(?:works|books)\/OL[0-9A-Z]+[WM]$/.test(key)) return null;
  return `https://openlibrary.org${key}`;
}

export function doiUrl(doi: unknown): string | null {
  if (typeof doi !== "string" || !/^10\.\d{4,9}\/\S+$/i.test(doi)) return null;
  return `https://doi.org/${encodeURI(doi)}`;
}

export function stackQuestionUrl(id: unknown): string | null {
  const value = Number(id);
  return Number.isSafeInteger(value) && value > 0
    ? `https://pt.stackoverflow.com/questions/${value}`
    : null;
}

export function githubRepositoryUrl(fullName: unknown): string | null {
  if (typeof fullName !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return null;
  return `https://github.com/${fullName}`;
}

export function creativeCommonsLicenseUrl(license: unknown): string | null {
  if (typeof license !== "string") return null;
  const match = license.trim().match(/^CC (BY(?:-SA)?) (\d\.\d)$/i);
  if (!match) return null;
  return `https://creativecommons.org/licenses/${match[1].toLowerCase()}/${match[2]}/`;
}

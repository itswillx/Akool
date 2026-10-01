import type { LookupAction, ProviderId } from "./types.ts";

// Cache compartilhado em `public.study_lookup_cache` (service_role apenas).
//
// Compartilhado, e nao por usuario nem em memoria, porque os tetos das APIs sao
// POR IP e a function tem um unico IP de saida: o orcamento e coletivo, logo o
// cache tem de ser coletivo. Isolates sao reciclados e nao compartilham
// memoria, entao cache em processo daria N caches e N vezes as chamadas.

const READABLE_KEY_LENGTH = 80;

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Normaliza a query para chave de cache.
 *
 * A chave conserva um prefixo legivel e ganha um hash estavel para evitar
 * colisao entre queries longas. Ela NAO remove acento -- "sessao" e "sessão" sao artigos diferentes na
 * Wikipedia, e colapsa-los devolveria conteudo errado.
 */
export function cacheKey(query: string): string {
  const normalized = query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  // A parte legivel continua util no SQL, e o sufixo elimina a colisao que
  // existia quando duas queries de ate 200 chars compartilhavam os 120 iniciais.
  return `${normalized.slice(0, READABLE_KEY_LENGTH)}#${stableHash(normalized)}`;
}

// TTL curto para resultado vazio: sem isso, um erro de digitacao repetido
// queima orcamento toda vez. Nunca se cacheia FALHA de provider -- isso fixaria
// uma indisponibilidade por dias.
const EMPTY_TTL_SECONDS = 6 * 3600;

// deno-lint-ignore no-explicit-any
type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- código como publicado

export interface CacheHit<T> {
  payload: T;
}

export async function readCache<T>(
  client: Client,
  provider: ProviderId,
  action: LookupAction,
  key: string,
): Promise<CacheHit<T> | null> {
  try {
    const { data, error } = await client
      .from("study_lookup_cache")
      .select("payload, hits")
      // Filtro pelo vencimento: linha velha nunca e servida, mesmo se o
      // expurgo atrasar.
      .gt("expires_at", new Date().toISOString())
      .eq("provider", provider)
      .eq("action", action)
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    // Contador de uso: unica forma de descobrir depois se os TTLs prestam.
    // Best-effort -- falhar aqui nao pode invalidar um hit valido.
    client
      .from("study_lookup_cache")
      .update({ hits: (data.hits ?? 0) + 1 })
      .eq("provider", provider).eq("action", action).eq("cache_key", key)
      .then(() => {}, () => {});
    return { payload: data.payload as T };
  } catch {
    // Cache indisponivel nao pode derrubar a feature: segue como miss.
    return null;
  }
}

export async function writeCache(
  client: Client,
  provider: ProviderId,
  action: LookupAction,
  key: string,
  payload: unknown,
  ttlSeconds: number,
  isEmpty: boolean,
): Promise<void> {
  const ttl = isEmpty ? Math.min(ttlSeconds, EMPTY_TTL_SECONDS) : ttlSeconds;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  try {
    await client.from("study_lookup_cache").upsert({
      provider,
      action,
      cache_key: key,
      payload,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
      hits: 0,
    }, { onConflict: "provider,action,cache_key" });
  } catch {
    // Escrita de cache e best-effort.
  }
  // Expurgo oportunista: nao ha pg_cron neste projeto. Mesmo padrao que
  // private.rate_limit_touch ja usa.
  if (Math.random() < 0.02) {
    try {
      await client.rpc("study_lookup_cache_prune");
    } catch { /* ignora */ }
  }
}

const BACKOFF_KEY = "__provider_backoff__";

export async function isProviderCooling(client: Client, provider: ProviderId): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("study_lookup_cache")
      .select("cache_key")
      .eq("provider", provider)
      .eq("action", "resources")
      .eq("cache_key", BACKOFF_KEY)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) return true;
    return !!data;
  } catch {
    // Nao confirmar o cooldown equivale a falha do gate global: fail-closed.
    return true;
  }
}

export async function writeProviderCooldown(
  client: Client,
  provider: ProviderId,
  seconds: number,
): Promise<void> {
  const ttl = Math.min(Math.max(Math.floor(seconds), 1), 3600);
  const now = new Date();
  try {
    await client.from("study_lookup_cache").upsert({
      provider,
      action: "resources",
      cache_key: BACKOFF_KEY,
      payload: { backoff: ttl },
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
      hits: 0,
    }, { onConflict: "provider,action,cache_key" });
  } catch { /* best-effort; o budget curto ainda protege o provedor */ }
}

// SEC-012 — leitura do 429 devolvido pelas RPCs com rate limit.
//
// As RPCs `validate_invite_code` e `search_users_for_share` emitem o 429 via
// `raise sqlstate 'PGRST'` (ver supabase/migrations/20260812170000_sec_rate_limit_core.sql),
// que o PostgREST traduz para um corpo JSON com `code`/`message`/`hint`. O
// supabase-js entrega isso como PostgrestError, então `error.code` é a string
// que definimos — não um SQLSTATE de cinco caracteres.
//
// Por que os segundos vêm do `hint` e não do header `Retry-After`: o browser só
// expõe headers de resposta cross-origin que estejam listados em
// `Access-Control-Expose-Headers`, e o PostgREST do Supabase não lista
// `Retry-After`. O header continua sendo enviado (proxies e curl leem), mas
// para o JS a única fonte legível é o corpo.

/** Shape mínimo do que o supabase-js devolve em `error`. Evita depender do tipo do SDK. */
interface RateLimitedErrorLike {
  code?: string | null
  hint?: string | null
}

export const RATE_LIMITED_CODE = 'rate_limited'

/** True quando o erro veio de um limite de taxa estourado (HTTP 429). */
export function isRateLimited(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (error as RateLimitedErrorLike).code === RATE_LIMITED_CODE
}

/**
 * Segundos até a janela virar, extraídos do `hint` (`retry_after_seconds=N`).
 * Retorna null se o hint estiver ausente ou malformado — o chamador decide o
 * fallback, já que a mensagem faz sentido mesmo sem o número exato.
 */
export function rateLimitRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const hint = (error as RateLimitedErrorLike).hint
  if (typeof hint !== 'string') return null
  const match = hint.match(/retry_after_seconds=(\d+)/)
  if (!match) return null
  const seconds = Number.parseInt(match[1], 10)
  return Number.isFinite(seconds) ? seconds : null
}

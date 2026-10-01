// REL-011: tira dado pessoal e credencial do que vai para o Sentry. Usado pelo
// app (src/lib/observability.ts) e pelas edges (_shared/sentry.ts). Nada de
// Deno aqui: o Vitest testa este arquivo direto.

const REPLACEMENTS: [RegExp, string][] = [
  // JWT (sessão do Supabase, service role): três partes base64url.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  // Token pessoal da cards-api.
  [/\bakool_pat_[0-9a-f]{16,}/gi, '[token]'],
  // Chaves de API de IA que o app manipula (OpenAI, Anthropic e afins).
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[api-key]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [token]'],
  // Credencial em query string ou fragmento de URL.
  [/([?&#](?:access_token|refresh_token|id_token|token|apikey|api_key|key|code|password|secret)=)[^&#\s"']+/gi, '$1[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // CPF e sequências longas de dígitos (cartão, conta).
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[number]'],
]

// Chaves cujo valor nunca sai, seja qual for o conteúdo.
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|session|credential/i

const MAX_DEPTH = 8

export function scrubString(input: string): string {
  let out = input
  for (const [re, replacement] of REPLACEMENTS) out = out.replace(re, replacement)
  return out
}

/** Copia `value` trocando strings pelo scrub e valores de chaves sensíveis por "[redacted]". */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubString(value) as T
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value
  if (Array.isArray(value)) return value.map(item => scrubDeep(item, depth + 1)) as T
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) && item !== null && item !== undefined && typeof item !== 'object'
      ? '[redacted]'
      : scrubDeep(item, depth + 1)
  }
  return out as T
}

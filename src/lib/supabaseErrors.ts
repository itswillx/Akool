import type { TranslationKey } from '../i18n/translations'

// ARCH-003: erro do Supabase (PostgREST, Postgres, rede) → mensagem para quem
// usa o app. Antes, cada tela tratava do seu jeito e quase tudo que não era
// permissão ou rede virava uma mensagem genérica. As duas camadas: quando a
// causa é reconhecível, a pessoa vê o "porquê"; senão, a mensagem da operação
// (`fallback`).

export type SupabaseErrorKind =
  | 'permission' | 'session' | 'network' | 'duplicate' | 'reference'
  | 'invalid' | 'not_found' | 'timeout' | 'unknown'

export interface SupabaseErrorLike {
  message?: string | null
  code?: string | null
}

export interface MappedSupabaseError {
  kind: SupabaseErrorKind
  code: string | null
  message: string
}

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string

const KIND_KEY: Record<Exclude<SupabaseErrorKind, 'unknown'>, TranslationKey> = {
  permission: 'toast_error_permission',
  session: 'toast_error_session',
  network: 'toast_error_network',
  duplicate: 'toast_error_duplicate',
  reference: 'toast_error_reference',
  invalid: 'toast_error_invalid',
  not_found: 'toast_error_not_found',
  timeout: 'toast_error_timeout',
}

const CODE_KIND: Record<string, SupabaseErrorKind> = {
  '42501': 'permission',         // insufficient_privilege (RLS/grant)
  PGRST_NO_ROWS: 'permission',   // update/delete que o RLS barrou com 0 linhas (requireRows)
  PGRST301: 'session',           // JWT expirado ou inválido
  '23505': 'duplicate',          // unique_violation
  '23503': 'reference',          // foreign_key_violation
  '23514': 'invalid',            // check_violation
  '23502': 'invalid',            // not_null_violation
  '22P02': 'invalid',            // invalid_text_representation (ex.: uuid malformado)
  PGRST116: 'not_found',         // .single() sem linha
  '57014': 'timeout',            // statement_timeout
}

/** Só a classificação (sem texto), para quem decide o que fazer com o erro. */
export function classifySupabaseError(error: SupabaseErrorLike | null | undefined): SupabaseErrorKind {
  if (!error) return 'unknown'
  const byCode = error.code ? CODE_KIND[error.code] : undefined
  if (byCode) return byCode
  const message = error.message ?? ''
  if (/jwt expired|invalid jwt|jwt/i.test(message)) return 'session'
  if (/row-level security|permission denied|not authorized/i.test(message)) return 'permission'
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|aborted/i.test(message)) return 'network'
  return 'unknown'
}

export function mapSupabaseError(
  error: SupabaseErrorLike | null | undefined,
  t: TFn,
  fallback: TranslationKey,
): MappedSupabaseError {
  const kind = classifySupabaseError(error)
  return {
    kind,
    code: error?.code ?? null,
    message: t(kind === 'unknown' ? fallback : KIND_KEY[kind]),
  }
}

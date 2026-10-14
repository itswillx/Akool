// API-005: erros da API num formato só (docs/api-arquitetura.md §5 e §10).
// Envelope: {error: {code, message, required?, details?, retry_after?}}.
//
// O texto do Postgres só chega a quem chamou quando vem de um RAISE do app:
// código P0001, ou qualquer código com `hint = 'akool'` (convenção das funções
// novas, supabase/migrations/README.md). O resto (RLS, constraint, erro de
// tipo) vira uma mensagem genérica em pt-BR com o código estável.

import { describeScope, type ScopeLevel } from './catalog.ts'
import type { SchemaIssue } from './schema.ts'

export type ErrorCode =
  | 'unauthenticated' | 'token_invalid' | 'insufficient_scope' | 'forbidden' | 'not_found'
  | 'conflict' | 'version_conflict' | 'validation_failed' | 'rate_limited'
  | 'idempotency_in_progress' | 'idempotency_mismatch' | 'timeout' | 'unavailable' | 'internal'

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  token_invalid: 401,
  insufficient_scope: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  version_conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  idempotency_in_progress: 409,
  idempotency_mismatch: 422,
  timeout: 504,
  unavailable: 503,
  internal: 500,
}

export const GENERIC_MESSAGE: Readonly<Record<ErrorCode, string>> = {
  unauthenticated: 'Envie o token pessoal em Authorization: Bearer.',
  token_invalid: 'Token inválido, revogado ou expirado.',
  insufficient_scope: 'Este token não tem a permissão necessária.',
  forbidden: 'Sem permissão para fazer isso.',
  not_found: 'Não encontrado.',
  conflict: 'A operação conflita com o estado atual.',
  version_conflict: 'O item mudou desde a versão informada. Releia e tente de novo.',
  validation_failed: 'Entrada inválida.',
  rate_limited: 'Muitas requisições. Tente de novo em instantes.',
  idempotency_in_progress: 'Uma requisição com esta chave de idempotência ainda está em andamento.',
  idempotency_mismatch: 'Esta chave de idempotência já foi usada com outro conteúdo.',
  timeout: 'A operação demorou demais. Tente de novo.',
  unavailable: 'Serviço ocupado. Tente de novo em instantes.',
  internal: 'Erro interno.',
}

/** Erro como o postgres.js (detail) ou o PostgREST (details) entregam. */
export interface PgErrorLike {
  code?: string | null
  message?: string | null
  hint?: string | null
  detail?: string | null
  details?: string | null
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    /** `secao.subsecao:nivel` que faltou (insufficient_scope). */
    required?: readonly string[]
    /** validation_failed: os problemas em JSON Pointer. */
    details?: readonly SchemaIssue[] | Readonly<Record<string, unknown>>
    retry_after?: number
  }
}

export interface ApiErrorResponse {
  status: number
  headers: Readonly<Record<string, string>>
  body: ApiErrorBody
  /** Só o 500: o gateway manda para o Sentry (com scrub). */
  report: boolean
}

export interface ApiErrorOptions {
  message?: string
  required?: readonly string[]
  details?: ApiErrorBody['error']['details']
  retryAfter?: number
}

export function apiError(code: ErrorCode, opts: ApiErrorOptions = {}): ApiErrorResponse {
  const headers: Record<string, string> = {}
  if (code === 'unauthenticated') headers['WWW-Authenticate'] = 'Bearer realm="akool"'
  if (code === 'token_invalid') headers['WWW-Authenticate'] = 'Bearer realm="akool", error="invalid_token"'
  if (opts.retryAfter !== undefined) headers['Retry-After'] = String(opts.retryAfter)

  const error: ApiErrorBody['error'] = { code, message: opts.message ?? GENERIC_MESSAGE[code] }
  if (opts.required && opts.required.length > 0) error.required = opts.required
  if (opts.details !== undefined) error.details = opts.details
  if (opts.retryAfter !== undefined) error.retry_after = opts.retryAfter
  return { status: ERROR_STATUS[code], headers, body: { error }, report: code === 'internal' }
}

// docs/api-arquitetura.md §10. Fora da tabela, 500.
const SQLSTATE_CODE: Readonly<Record<string, ErrorCode>> = {
  '42501': 'forbidden',
  P0002: 'not_found',
  '22023': 'validation_failed',
  '22P02': 'validation_failed',
  '23514': 'validation_failed',
  '23503': 'validation_failed',
  '23502': 'validation_failed',
  '22001': 'validation_failed',
  '22003': 'validation_failed',
  P0001: 'conflict',
  '23505': 'conflict',
  '40001': 'unavailable',
  '40P01': 'unavailable',
  '55P03': 'unavailable',
  '57014': 'timeout',
}

// Segundos sugeridos para tentar de novo quando o banco não diz.
const DEFAULT_RETRY: Partial<Record<ErrorCode, number>> = { unavailable: 1, timeout: 2 }

export function sqlstateToCode(state: string | null | undefined): ErrorCode {
  return (state && Object.hasOwn(SQLSTATE_CODE, state) ? SQLSTATE_CODE[state] : undefined) ?? 'internal'
}

/** Mensagem escrita pelo app num RAISE (pode ir para quem chamou). */
export function isAppMessage(err: PgErrorLike): boolean {
  return err.code === 'P0001' || err.hint === 'akool'
}

function parseJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function retrySeconds(hint: unknown): number | undefined {
  const match = typeof hint === 'string' ? /retry_after_seconds=(\d+)/.exec(hint) : null
  return match ? Number.parseInt(match[1], 10) : undefined
}

// private.raise_rate_limited: SQLSTATE 'PGRST' com um JSON na mensagem (é o
// que o postgres.js entrega); pelo PostgREST, o mesmo erro já chega com
// code 'rate_limited' e o hint.
function rateLimited(err: PgErrorLike): ApiErrorResponse | null {
  if (err.code === 'rate_limited') return apiError('rate_limited', { retryAfter: retrySeconds(err.hint) ?? 1 })
  if (err.code !== 'PGRST') return null
  const payload = parseJson(err.message)
  if (payload?.code !== 'rate_limited') return null
  return apiError('rate_limited', { retryAfter: retrySeconds(payload.hint) ?? 1 })
}

/** Erro do banco → resposta da API. `detail`, `details` e o `hint` cru nunca vão no corpo. */
export function fromPgError(err: PgErrorLike): ApiErrorResponse {
  const limited = rateLimited(err)
  if (limited) return limited
  const code = sqlstateToCode(err.code)
  const message = isAppMessage(err) && err.message ? err.message : undefined
  return apiError(code, { message, retryAfter: DEFAULT_RETRY[code] })
}

export function validationFailed(issues: readonly SchemaIssue[]): ApiErrorResponse {
  return apiError('validation_failed', { details: issues })
}

export interface ScopeRequirement {
  sub: string
  level: ScopeLevel
}

/**
 * 403 de permissão do token. `mode` diz se faltam todas (`all`, "e") ou se
 * qualquer uma bastaria (`any`, "ou", o `requires.anyOf` das ações).
 */
export function insufficientScope(missing: readonly ScopeRequirement[], mode: 'all' | 'any' = 'all'): ApiErrorResponse {
  const text = missing.map(r => describeScope(r.sub, r.level)).join(mode === 'any' ? ' ou ' : ' e ')
  return apiError('insufficient_scope', {
    message: `Este token não tem a permissão ${text}. Libere editando o token ou gerando outro em Configurações → API.`,
    required: missing.map(r => `${r.sub}:${r.level}`),
  })
}

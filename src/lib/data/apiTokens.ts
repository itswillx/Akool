import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import type { ApiScopes } from '../../types'

// API-009: tokens pessoais da API (Configurações → API). O banco guarda só o
// hash: o texto do token aparece uma única vez, na criação. As RPCs (migration
// api001_token_scopes) conferem a sessão do app, o catálogo, a validade pelo
// nível e o segundo fator; o RLS só mostra os tokens da própria pessoa. Quem
// chama lê `{ data, error }`, como nas outras funções de src/lib/data.

/** Sem user_id (o RLS já filtra) e sem token_hash (nem tem grant). */
export const API_TOKEN_COLUMNS = 'id, name, prefix, scopes, created_at, last_used_at, last_client, expires_at, revoked_at'

export interface ApiTokenRow {
  id: string
  name: string
  prefix: string
  scopes: ApiScopes
  created_at: string
  last_used_at: string | null
  last_client: string | null
  expires_at: string
  revoked_at: string | null
}

export type ApiTokenStatus = 'active' | 'revoked' | 'expired'

/** Revogado vence; expirado só conta se não foi revogado. */
export function apiTokenStatus(token: Pick<ApiTokenRow, 'revoked_at' | 'expires_at'>, now = Date.now()): ApiTokenStatus {
  if (token.revoked_at) return 'revoked'
  if (new Date(token.expires_at).getTime() <= now) return 'expired'
  return 'active'
}

/** Os tokens da pessoa, mais novos primeiro. */
export function listApiTokens() {
  return supabase.from('api_tokens').select(API_TOKEN_COLUMNS).order('created_at', { ascending: false })
}

/** O que create_api_token devolve; `token` é o segredo, mostrado uma vez. */
export type CreatedApiToken = { id: string; token: string; prefix: string; expires_at: string; scopes: ApiScopes }

/**
 * Gera um token. Sempre com escopos explícitos: sem eles, o banco daria os do
 * /fila (os tokens de antes do API-009).
 */
export async function createApiToken(input: { name: string; expiresInDays: number; scopes: ApiScopes }) {
  const { data, error } = await supabase.rpc('create_api_token', {
    p_name: input.name.trim() || 'Token',
    p_expires_in_days: input.expiresInDays,
    p_scopes: input.scopes,
  })
  return { data: error ? null : (data as CreatedApiToken), error }
}

/** Troca as permissões de um token ativo. O segredo não muda. */
export function updateApiTokenScopes(id: string, scopes: ApiScopes) {
  return supabase.rpc('update_api_token_scopes', { p_id: id, p_scopes: scopes })
}

export function revokeApiToken(id: string) {
  return supabase.rpc('revoke_api_token', { p_id: id })
}

/** Revoga todos os tokens ativos; `data` diz quantos. */
export function revokeAllApiTokens() {
  return supabase.rpc('revoke_all_my_api_tokens')
}

/** Apaga o token em qualquer estado. Ativo, ele para de funcionar na hora. */
export function deleteApiToken(id: string) {
  return supabase.rpc('delete_api_token', { p_id: id })
}

/**
 * Exclui os revogados e expirados, um delete_api_token por vez (não há RPC em
 * lote). "Não encontrado" conta como excluído: outra aba chegou antes. Para no
 * primeiro erro de outro tipo e diz quantos já saíram.
 */
export async function purgeInactiveApiTokens(tokens: readonly ApiTokenRow[], now = Date.now()): Promise<{ deleted: number; error: PostgrestError | null }> {
  let deleted = 0
  for (const token of tokens) {
    if (apiTokenStatus(token, now) === 'active') continue
    const { error } = await deleteApiToken(token.id)
    if (error && error.code !== 'P0002') return { deleted, error }
    deleted++
  }
  return { deleted, error: null }
}

export type ApiTokenErrorKind = 'mfa' | 'admin_only' | 'limit' | 'not_found' | 'session' | 'invalid' | 'other'

/** Pelo código e pelas mensagens das RPCs (migration api001_token_scopes). */
export function classifyApiTokenError(error: { code?: string | null; message?: string | null }): ApiTokenErrorKind {
  const code = error.code ?? ''
  const message = error.message ?? ''
  // PGRST301-303: JWT inválido, ausente ou vencido.
  if (code.startsWith('PGRST30')) return 'session'
  if (code === '42501') {
    if (message.includes('segundo fator')) return 'mfa'
    if (message.includes('só para administradores')) return 'admin_only'
    if (message === 'not authenticated' || message.includes('pelo app')) return 'session'
    return 'other'
  }
  if (code === 'P0001' && message.startsWith('Limite de')) return 'limit'
  if (code === 'P0002') return 'not_found'
  if (code === '22023') return 'invalid'
  return 'other'
}

import { supabase } from '../supabase'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env'
import type { TranslationKey } from '../../i18n/translations'

// ARCH-008: o que o painel de admin pede ao banco e à edge admin-ops, num
// lugar só. Trocar role, ativar/desativar, excluir e o último login passam
// pela edge (service role; barra rebaixar o último admin; grava audit_log).
// Cotas e revogação são RPCs security definer com checagem de admin e
// auditoria (SEC-018). Excluir um código usado ou expirado é um delete direto:
// a RPC de revogar só aceita código não usado, porque devolve o slot.

const EDGE_FN = `${SUPABASE_URL}/functions/v1/admin-ops`

export interface AdminOpsResult {
  error?: string
  success?: boolean
  users?: { id: string; last_sign_in_at?: string }[]
}

/** Colunas que a lista de usuários pede (SEC-013: só pela RPC de admin). */
export const ADMIN_PROFILE_COLUMNS =
  'id, email, display_name, role, is_active, language, created_at, invite_slots_remaining, last_login_date, avatar_emoji, avatar_color, avatar_url'

// A edge responde em inglês; os erros conhecidos viram chave de tradução e o
// resto passa como veio.
export const ADMIN_OPS_ERROR_KEYS: Record<string, TranslationKey> = {
  admin_err_backend: 'admin_err_backend',
  'Cannot demote the last admin': 'admin_err_last_admin',
  'Cannot perform this action on yourself': 'admin_err_self_action',
  'Invalid role': 'admin_err_invalid_role',
  'Forbidden: admin only': 'admin_err_forbidden',
  mfa_required: 'admin_err_mfa_required',
  'User not found': 'admin_err_user_not_found',
}

// PERF-001: o token é lido na hora da chamada; a sessão não fica no contexto
// de Auth (ela mudava a cada foco da aba e re-renderizava o app todo).
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * Sempre resolve num objeto com `error` opcional: backend fora ou corpo que não
 * é JSON (502, timeout) viram `admin_err_backend`/`HTTP <status>`, e não uma
 * promessa rejeitada que deixava o botão travado sem aviso.
 */
export async function callAdminOps(session: string, body: Record<string, unknown>): Promise<AdminOpsResult> {
  let res: Response
  try {
    res = await fetch(EDGE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    })
  } catch {
    return { error: 'admin_err_backend' }
  }
  let data: AdminOpsResult = {}
  try {
    data = await res.json() as AdminOpsResult
  } catch {
    // Corpo vazio ou não-JSON: o status decide abaixo.
  }
  if (!res.ok) return { ...data, error: String(data.error ?? `HTTP ${res.status}`) }
  return data
}

export function listProfilesForAdmin() {
  return supabase.rpc('admin_list_profiles').select(ADMIN_PROFILE_COLUMNS).order('created_at', { ascending: true })
}

/** Último login (Auth) por id, pela edge; vazio sem sessão ou se a edge falhar. */
export async function lastSignIns(): Promise<Record<string, string | null>> {
  const token = await currentAccessToken()
  if (!token) return {}
  const res = await callAdminOps(token, { action: 'list_users' })
  const out: Record<string, string | null> = {}
  for (const u of res.users ?? []) out[u.id] = u.last_sign_in_at ?? null
  return out
}

export function listAllInviteCodes() {
  return supabase
    .from('invite_codes')
    .select('id, code, created_by, used_by, created_at, expires_at, used_at')
    .order('created_at', { ascending: false })
}

/** ±slots de convite de um usuário (nunca abaixo de 0; audita). */
export function addInviteSlots(userId: string, slots: number) {
  return supabase.rpc('admin_add_invite_slots', { p_user_id: userId, p_slots: slots })
}

/** Apaga um código não usado e devolve o slot a quem o criou (audita). */
export function revokeInviteCode(codeId: string) {
  return supabase.rpc('admin_revoke_invite_code', { p_code_id: codeId })
}

/** Apaga um código usado ou expirado (sem devolver slot). */
export function deleteInviteCode(codeId: string) {
  return supabase.from('invite_codes').delete().eq('id', codeId).select('id')
}

export function resetPasswordForEmail(email: string) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
}

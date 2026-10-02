import { supabase } from '../supabase'

// ARCH-008: convites num lugar só, para as Configurações (os meus códigos) e
// para o painel de admin (todos os códigos, cotas). Quem chama continua lendo
// `{ data, error }`, como nas outras funções de src/lib/data.

export type InviteStatus = 'pending' | 'used' | 'expired'

/** Usado vence; expirado só conta se ninguém usou. */
export function inviteStatus(code: { used_at: string | null; expires_at: string }, now = new Date()): InviteStatus {
  if (code.used_at) return 'used'
  if (new Date(code.expires_at) < now) return 'expired'
  return 'pending'
}

/** Os códigos que o RLS deixa ver (os meus; todos, para admin), mais novos primeiro. */
export function listMyInviteCodes() {
  return supabase
    .from('invite_codes')
    .select('id, code, created_at, expires_at, used_at, used_by')
    .order('created_at', { ascending: false })
}

/** E-mail por id de perfil, para mostrar quem criou ou usou um código. */
export async function profileEmailsById(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const { data } = await supabase.from('profiles').select('id, email').in('id', unique)
  const out: Record<string, string> = {}
  for (const p of data ?? []) out[p.id] = p.email
  return out
}

/** Gera um código; gasta um slot de quem não é admin. */
export function generateInviteCode() {
  return supabase.rpc('generate_invite_code')
}

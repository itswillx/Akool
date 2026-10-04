import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { requireRows } from '../optimistic'
import type { AppNotification } from '../../types'

// NOTIF-001: acesso às notificações num lugar só (antes: o NotificationsContext
// e o Dashboard chamavam o supabase direto). Quem chama lê `{ data, error }`,
// como nas outras funções de src/lib/data. Só `_notify()` (no banco) cria
// notificações; aqui o dono lê, marca lida/não lida e exclui.

/** Tamanho da página da central ("carregar mais" busca a próxima). */
export const NOTIFICATIONS_PAGE = 30

/** Onde a página anterior parou: a ordem é created_at desc, id desc (desempate estável). */
export interface NotificationCursor {
  created_at: string
  id: string
}

/** Uma página das notificações do usuário, mais novas primeiro. */
export function listNotifications(userId: string, cursor?: NotificationCursor, limit = NOTIFICATIONS_PAGE) {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
  if (cursor) {
    // Aspas: o timestamp tem ':' e '+', que o filtro `or` do PostgREST trataria como sintaxe.
    query = query.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`)
  }
  return query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
}

/** Quantas não lidas o usuário tem no total (não só as carregadas). */
export function countUnreadNotifications(userId: string) {
  return supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('read', false)
}

/** Marca uma como lida ou não lida; 0 linhas vira erro (a notificação sumiu). */
export async function setNotificationRead(id: string, read: boolean) {
  return requireRows(await supabase.from('notifications').update({ read }).eq('id', id).select('id'))
}

/** Todas as não lidas do usuário viram lidas (0 linhas é normal: outra aba já marcou). */
export function markAllNotificationsRead(userId: string) {
  return supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
}

export async function deleteNotification(id: string) {
  return requireRows(await supabase.from('notifications').delete().eq('id', id).select('id'))
}

/** "Limpar lidas": as não lidas ficam. */
export function deleteReadNotifications(userId: string) {
  return supabase.from('notifications').delete().eq('user_id', userId).eq('read', true)
}

export type InviteState = 'pending' | 'accepted' | 'declined'

/**
 * Situação atual dos convites citados nas notificações (o convidado e os
 * membros do workspace podem ler). O que o RLS esconder fica sem situação.
 */
export async function fetchInviteStates(ids: readonly string[]): Promise<Record<string, InviteState>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const { data, error } = await supabase.from('finance_workspace_invites').select('id, status').in('id', unique)
  if (error || !data) return {}
  const out: Record<string, InviteState> = {}
  for (const row of data) {
    if (row.status === 'pending' || row.status === 'accepted' || row.status === 'declined') out[row.id] = row.status
  }
  return out
}

/** As RPCs revalidam tudo (convite pendente, destinatário, um workspace por pessoa). */
export function acceptWorkspaceInvite(inviteId: string) {
  return supabase.rpc('accept_workspace_invite', { p_invite_id: inviteId })
}

export function declineWorkspaceInvite(inviteId: string) {
  return supabase.rpc('decline_workspace_invite', { p_invite_id: inviteId })
}

/**
 * Realtime das notificações do usuário: novas (INSERT) e lidas em outra aba
 * (UPDATE). Exclusões em outra aba aparecem no próximo carregamento.
 */
export function subscribeNotifications(
  userId: string,
  handlers: { onInsert: (n: AppNotification) => void; onUpdate: (n: AppNotification) => void },
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      payload => handlers.onInsert(payload.new as AppNotification),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      payload => handlers.onUpdate(payload.new as AppNotification),
    )
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

import type { AppNotification } from '../types'

// REL-004: a lista de notificações na tela. O load inicial traz as 50 mais
// recentes, e o realtime vai somando: sem teto, a lista crescia a sessão
// inteira; sem checar o id, uma notificação que chegasse pelos dois caminhos
// (o INSERT entre o select e a inscrição) aparecia duas vezes.
export const NOTIFICATIONS_LIMIT = 50

/** Nova notificação do realtime no topo: ignora id repetido e corta no limite. */
export function prependNotification(list: AppNotification[], incoming: AppNotification): AppNotification[] {
  if (list.some(n => n.id === incoming.id)) return list
  return [incoming, ...list].slice(0, NOTIFICATIONS_LIMIT)
}

/**
 * REL-010: UPDATE do realtime (ex.: marcada como lida em outra aba). Troca os
 * campos da notificação que já está na lista; id desconhecido é ignorado (a
 * lista mostra só as mais recentes).
 */
export function applyNotificationUpdate(list: AppNotification[], updated: AppNotification): AppNotification[] {
  let changed = false
  const next = list.map(n => {
    if (n.id !== updated.id) return n
    changed = true
    return { ...n, ...updated }
  })
  return changed ? next : list
}

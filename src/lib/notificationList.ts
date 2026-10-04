import type { AppNotification } from '../types'

// REL-004: a lista de notificações na tela. O load inicial traz uma página
// (NOTIF-001: "carregar mais" busca as seguintes) e o realtime vai somando: sem
// teto, a lista crescia a sessão inteira; sem checar o id, uma notificação que
// chegasse pelos dois caminhos (o INSERT entre o select e a inscrição)
// aparecia duas vezes.
export const NOTIFICATIONS_MAX = 500

/** Nova notificação do realtime no topo: ignora id repetido e corta no teto. */
export function prependNotification(list: AppNotification[], incoming: AppNotification): AppNotification[] {
  if (list.some(n => n.id === incoming.id)) return list
  return [incoming, ...list].slice(0, NOTIFICATIONS_MAX)
}

/**
 * Página seguinte no fim da lista, sem repetir as que o realtime já trouxe.
 * Sem teto: é a pessoa quem pede mais (o teto vale para o que chega sozinho).
 */
export function appendNotifications(list: AppNotification[], page: AppNotification[]): AppNotification[] {
  const seen = new Set(list.map(n => n.id))
  const fresh = page.filter(n => !seen.has(n.id))
  return fresh.length === 0 ? list : [...list, ...fresh]
}

/** Volta itens removidos (exclusão desfeita), na ordem de criação. */
export function restoreNotifications(list: AppNotification[], removed: AppNotification[]): AppNotification[] {
  const seen = new Set(list.map(n => n.id))
  const back = removed.filter(n => !seen.has(n.id))
  if (back.length === 0) return list
  return [...list, ...back].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))
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

import { LOCAL_KEYS } from './localKeys'
import { NOTIFICATION_CATEGORIES } from './notificationKinds'
import type { NotificationCategory } from './notificationKinds'

// NOTIF-001: quais categorias de notificação NÃO mostram o aviso ao chegar.
// Fica neste aparelho (localStorage, apagado no logout): é só o aviso; a
// notificação continua na central. No perfil exigiria coluna nova em `profiles`,
// que vive de grants por coluna, e mexer no get_my_profile, por pouco ganho.

export interface NotificationPrefs {
  muted: NotificationCategory[]
}

const isCategory = (value: unknown): value is NotificationCategory =>
  typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)

export function readNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(LOCAL_KEYS.notificationPrefs)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    const muted = parsed && typeof parsed === 'object' && 'muted' in parsed && Array.isArray(parsed.muted) ? parsed.muted.filter(isCategory) : []
    return { muted }
  } catch {
    return { muted: [] }
  }
}

export function writeNotificationPrefs(prefs: NotificationPrefs): void {
  try {
    localStorage.setItem(LOCAL_KEYS.notificationPrefs, JSON.stringify({ muted: prefs.muted.filter(isCategory) }))
  } catch {
    // Sem storage (modo privado restrito): a escolha vale só nesta visita.
  }
}

export function isCategoryMuted(category: NotificationCategory): boolean {
  return readNotificationPrefs().muted.includes(category)
}

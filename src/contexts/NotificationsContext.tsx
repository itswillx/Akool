import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { mapWriteError, requireRows, revertFields, runOptimistic, type WriteError } from '../lib/optimistic'
import { NOTIFICATIONS_LIMIT, applyNotificationUpdate, prependNotification } from '../lib/notificationList'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { useLanguage } from '../i18n/LanguageContext'
import type { AppNotification } from '../types'

interface NotificationsContextType {
  notifications: AppNotification[]
  unreadCount: number
  loading: boolean
  markAsRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  reload: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()
  const { t } = useLanguage()

  // O estado atual para os snapshots do rollback, e o aviso por ref para os
  // callbacks não mudarem de identidade quando o idioma troca.
  const notificationsRef = useRef(notifications)
  useEffect(() => { notificationsRef.current = notifications }, [notifications])
  const notifyRef = useRef({ t, showToast })
  useEffect(() => { notifyRef.current = { t, showToast } }, [t, showToast])
  const reverted = useCallback((error: WriteError) => {
    notifyRef.current.showToast('error', mapWriteError(error, notifyRef.current.t, 'toast_error_reverted'))
  }, [])

  const load = useCallback(async () => {
    const userId = user?.id
    if (!userId) { setNotifications([]); setLoading(false); return }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(NOTIFICATIONS_LIMIT)
    setNotifications(data ?? [])
    setLoading(false)
  }, [user?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    const channel = supabase
      .channel('notifications_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification
          setNotifications(prev => prependNotification(prev, n))
        }
      )
      // REL-010: "lida" em outra aba (ou no celular) reflete aqui. DELETE não é
      // assinado: o app não apaga notificação.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification
          setNotifications(prev => applyNotificationUpdate(prev, n))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications])

  // REL-004: marca na tela na hora e desfaz se o banco recusar (antes, a
  // falha sumia e a notificação voltava como não lida no próximo load).
  const markAsRead = useCallback(async (id: string) => {
    const current = notificationsRef.current.find(n => n.id === id)
    if (!current || current.read) return
    await runOptimistic({
      apply: () => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n)),
      write: async () => requireRows(await supabase.from('notifications').update({ read: true }).eq('id', id).select('id')),
      revert: () => setNotifications(prev => revertFields(prev, id, { read: false }, { onlyIf: n => n.read })),
      onError: reverted,
      label: 'notification read',
    })
  }, [reverted])

  const markAllRead = useCallback(async () => {
    const userId = user?.id
    if (!userId) return
    const unread = new Set(notificationsRef.current.filter(n => !n.read).map(n => n.id))
    if (unread.size === 0) return
    await runOptimistic({
      apply: () => setNotifications(prev => prev.map(n => unread.has(n.id) ? { ...n, read: true } : n)),
      // Sem requireRows: 0 linhas é legítimo se outra aba já marcou tudo.
      write: () => supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false),
      revert: () => setNotifications(prev => prev.map(n => unread.has(n.id) && n.read ? { ...n, read: false } : n)),
      onError: reverted,
      label: 'notifications read all',
    })
  }, [user?.id, reverted])

  const value = useMemo(
    () => ({ notifications, unreadCount, loading, markAsRead, markAllRead, reload: load }),
    [notifications, unreadCount, loading, markAsRead, markAllRead, load],
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}

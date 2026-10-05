import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { mapWriteError, revertFields, runOptimistic, type WriteError } from '../lib/optimistic'
import { NOTIFICATIONS_MAX, appendNotifications, applyNotificationUpdate, prependNotification, restoreNotifications } from '../lib/notificationList'
import {
  NOTIFICATIONS_PAGE,
  countUnreadNotifications,
  deleteNotification,
  deleteReadNotifications,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
  subscribeNotifications,
} from '../lib/data/notifications'
import { emitAppEvent } from '../lib/appEvents'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { useLanguage } from '../i18n/LanguageContext'
import type { AppNotification } from '../types'

// As notificações do usuário (NOTIF-001): páginas de 30 com "carregar mais",
// contagem real de não lidas (inclusive as ainda não carregadas), lida/não
// lida, excluir e limpar lidas, todas otimistas com reversão (REL-004), e o
// aviso quando uma notificação nova chega pelo realtime. O acesso ao banco
// está em src/lib/data/notifications.ts; a interface, em
// src/components/notifications/.

interface NotificationsContextType {
  notifications: AppNotification[]
  /** Não lidas no total, não só entre as carregadas. */
  unreadCount: number
  loading: boolean
  /** A primeira página não carregou (a central oferece "tentar de novo"). */
  error: boolean
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => Promise<void>
  reload: () => Promise<void>
  setRead: (id: string, read: boolean) => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (id: string) => Promise<void>
  clearRead: () => Promise<void>
  /** Com a central aberta, notificação nova não gera aviso (ela já aparece na lista). */
  setCenterOpen: (open: boolean) => void
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // Não lidas que ainda não foram carregadas (fora das páginas na tela).
  const [hiddenUnread, setHiddenUnread] = useState(0)
  const { showToast } = useToast()
  const { t, lang } = useLanguage()

  // O estado atual para os snapshots do rollback, e o aviso por ref para os
  // callbacks não mudarem de identidade quando o idioma troca.
  const notificationsRef = useRef(notifications)
  useEffect(() => { notificationsRef.current = notifications }, [notifications])
  const notifyRef = useRef({ t, lang, showToast })
  useEffect(() => { notifyRef.current = { t, lang, showToast } }, [t, lang, showToast])
  const hiddenUnreadRef = useRef(hiddenUnread)
  useEffect(() => { hiddenUnreadRef.current = hiddenUnread }, [hiddenUnread])
  const centerOpenRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const reverted = useCallback((writeError: WriteError) => {
    notifyRef.current.showToast('error', mapWriteError(writeError, notifyRef.current.t, 'toast_error_reverted'))
  }, [])

  const load = useCallback(async () => {
    if (!userId) {
      setNotifications([])
      setHiddenUnread(0)
      setLoading(false)
      return
    }
    const [page, count] = await Promise.all([listNotifications(userId), countUnreadNotifications(userId)])
    if (page.error) {
      setError(true)
      setLoading(false)
      return
    }
    const rows = page.data ?? []
    const loadedUnread = rows.filter(n => !n.read).length
    setNotifications(rows)
    setHasMore(rows.length === NOTIFICATIONS_PAGE)
    setHiddenUnread(count.error || count.count == null ? 0 : Math.max(0, count.count - loadedUnread))
    setError(false)
    setLoading(false)
  }, [userId])

  useEffect(() => { void load() }, [load])

  const loadMore = useCallback(async () => {
    const last = notificationsRef.current.at(-1)
    if (!userId || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    // Lista vazia (tudo excluído ou limpo): recomeça da primeira página.
    const page = await listNotifications(userId, last ? { created_at: last.created_at, id: last.id } : undefined)
    loadingMoreRef.current = false
    setLoadingMore(false)
    if (page.error) {
      notifyRef.current.showToast('error', notifyRef.current.t('notif_load_error'))
      return
    }
    const rows = page.data ?? []
    setNotifications(prev => appendNotifications(prev, rows))
    setHasMore(rows.length === NOTIFICATIONS_PAGE)
    setHiddenUnread(hidden => Math.max(0, hidden - rows.filter(n => !n.read).length))
  }, [userId])

  // Notificação nova: aviso no canto com "Ver", se a aba está à vista, a
  // central fechada e a categoria não foi silenciada nas preferências. O
  // registro dos tipos (textos, categorias) vem sob demanda: fica fora do
  // chunk de entrada, que todo boot baixa.
  const announce = useCallback((n: AppNotification) => {
    if (n.read || centerOpenRef.current || document.visibilityState !== 'visible') return
    void Promise.all([import('../lib/notificationKinds'), import('../lib/notificationPrefs')])
      .then(([kinds, prefs]) => {
        if (prefs.isCategoryMuted(kinds.notificationCategory(n))) return
        const { t: tr, lang: language, showToast: show } = notifyRef.current
        show('info', kinds.notificationText(n, tr, language).title, {
          dedupeKey: `notif:${n.id}`,
          action: { label: tr('notif_view'), onClick: () => emitAppEvent('notification_open', { id: n.id }) },
        })
      })
      .catch(() => {})
  }, [])

  // Lida em outra aba (ou no celular) uma notificação que não está carregada:
  // a contagem das escondidas vem de novo do servidor (uma vez por rajada,
  // "marcar todas" lá gera um UPDATE por linha).
  const recountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRecount = useCallback(() => {
    if (!userId) return
    if (recountTimerRef.current) clearTimeout(recountTimerRef.current)
    recountTimerRef.current = setTimeout(() => {
      recountTimerRef.current = null
      void countUnreadNotifications(userId).then(({ count, error: countError }) => {
        if (countError || count == null) return
        const loaded = notificationsRef.current.filter(n => !n.read).length
        setHiddenUnread(Math.max(0, count - loaded))
      })
    }, 400)
  }, [userId])
  useEffect(() => () => { if (recountTimerRef.current) clearTimeout(recountTimerRef.current) }, [])

  useEffect(() => {
    if (!userId) return
    return subscribeNotifications(userId, {
      onInsert: n => {
        const list = notificationsRef.current
        const isNew = !list.some(item => item.id === n.id)
        // No teto, a mais antiga sai da lista: volta a ser "carregar mais".
        const dropped = isNew && list.length >= NOTIFICATIONS_MAX ? list[list.length - 1] : undefined
        if (dropped) {
          setHasMore(true)
          if (!dropped.read) setHiddenUnread(hidden => hidden + 1)
        }
        setNotifications(prev => prependNotification(prev, n))
        if (isNew) announce(n)
      },
      // REL-010: "lida" em outra aba (ou no celular) reflete aqui.
      onUpdate: n => {
        if (!notificationsRef.current.some(item => item.id === n.id)) scheduleRecount()
        setNotifications(prev => applyNotificationUpdate(prev, n))
      },
    })
  }, [userId, announce, scheduleRecount])

  const loadedUnread = useMemo(() => notifications.filter(n => !n.read).length, [notifications])
  const unreadCount = loadedUnread + hiddenUnread

  // REL-004: marca na tela na hora e desfaz se o banco recusar.
  const setRead = useCallback(async (id: string, read: boolean) => {
    const current = notificationsRef.current.find(n => n.id === id)
    if (!current || current.read === read) return
    await runOptimistic({
      apply: () => setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read } : n))),
      write: () => setNotificationRead(id, read),
      revert: () => setNotifications(prev => revertFields(prev, id, { read: !read }, { onlyIf: n => n.read === read })),
      onError: reverted,
      label: 'notification read',
    })
  }, [reverted])

  const markAsRead = useCallback((id: string) => setRead(id, true), [setRead])

  const markAllRead = useCallback(async () => {
    if (!userId) return
    const unread = new Set(notificationsRef.current.filter(n => !n.read).map(n => n.id))
    const hiddenBefore = hiddenUnreadRef.current
    await runOptimistic({
      apply: () => {
        setNotifications(prev => prev.map(n => (unread.has(n.id) ? { ...n, read: true } : n)))
        setHiddenUnread(0)
      },
      // Sem requireRows: 0 linhas é legítimo se outra aba já marcou tudo.
      write: () => markAllNotificationsRead(userId),
      revert: () => {
        setNotifications(prev => prev.map(n => (unread.has(n.id) && n.read ? { ...n, read: false } : n)))
        setHiddenUnread(hiddenBefore)
      },
      onError: reverted,
      label: 'notifications read all',
    })
  }, [userId, reverted])

  const remove = useCallback(async (id: string) => {
    const current = notificationsRef.current.find(n => n.id === id)
    if (!current) return
    await runOptimistic({
      apply: () => setNotifications(prev => prev.filter(n => n.id !== id)),
      write: () => deleteNotification(id),
      revert: () => setNotifications(prev => restoreNotifications(prev, [current])),
      onError: reverted,
      label: 'notification delete',
    })
  }, [reverted])

  const clearRead = useCallback(async () => {
    if (!userId) return
    const read = notificationsRef.current.filter(n => n.read)
    const remaining = notificationsRef.current.length - read.length
    const ok = await runOptimistic({
      apply: () => setNotifications(prev => prev.filter(n => !n.read)),
      write: () => deleteReadNotifications(userId),
      revert: () => setNotifications(prev => restoreNotifications(prev, read)),
      onError: reverted,
      label: 'notifications clear read',
    })
    // Tudo o que estava carregado era lido: busca a primeira página de novo
    // (as mais antigas, que não estavam na tela, podem ter não lidas).
    if (ok && remaining === 0) void load()
  }, [userId, reverted, load])

  const setCenterOpen = useCallback((open: boolean) => { centerOpenRef.current = open }, [])

  const value = useMemo(
    () => ({
      notifications, unreadCount, loading, error, hasMore, loadingMore,
      loadMore, reload: load, setRead, markAsRead, markAllRead, remove, clearRead, setCenterOpen,
    }),
    [notifications, unreadCount, loading, error, hasMore, loadingMore, loadMore, load, setRead, markAsRead, markAllRead, remove, clearRead, setCenterOpen],
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

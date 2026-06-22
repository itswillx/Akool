import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
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

  const load = useCallback(async () => {
    if (!user) { setNotifications([]); setLoading(false); return }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setNotifications((data as AppNotification[]) ?? [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('notifications_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as AppNotification
          setNotifications(prev => [n, ...prev])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  const unreadCount = notifications.filter(n => !n.read).length

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }, [])

  const markAllRead = useCallback(async () => {
    if (!user) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [user])

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, loading, markAsRead, markAllRead, reload: load }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}

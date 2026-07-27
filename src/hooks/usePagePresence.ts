import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export interface PresenceUser {
  user_id: string
  email: string
  display_name: string | null
  last_seen_at: string
  avatar_emoji?: string | null
  avatar_color?: string | null
  avatar_url?: string | null
}

const HEARTBEAT_INTERVAL = 15000
const PRESENCE_TTL_MS = 45000

export function usePagePresence(pageId: string | undefined) {
  const { user } = useAuth()
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const upsertPresence = useCallback(async () => {
    if (!user || !pageId) return
    await supabase
      .from('page_presence')
      .upsert(
        { page_id: pageId, user_id: user.id, last_seen_at: new Date().toISOString() },
        { onConflict: 'page_id,user_id' }
      )
  }, [user, pageId])

  const fetchPresence = useCallback(async () => {
    if (!user || !pageId) return
    const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString()
    const { data } = await supabase
      .from('page_presence')
      .select('user_id, last_seen_at, profiles!page_presence_user_id_profiles_fkey(email, display_name, avatar_emoji, avatar_color, avatar_url)')
      .eq('page_id', pageId)
      .gte('last_seen_at', cutoff)
      .neq('user_id', user.id)

    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setActiveUsers((data as any[]).map((row) => {
        const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
        return {
          user_id: row.user_id as string,
          last_seen_at: row.last_seen_at as string,
          email: (prof?.email ?? '') as string,
          display_name: (prof?.display_name ?? null) as string | null,
          avatar_emoji: (prof?.avatar_emoji ?? null) as string | null,
          avatar_color: (prof?.avatar_color ?? null) as string | null,
          avatar_url: (prof?.avatar_url ?? null) as string | null,
        }
      }))
    }
  }, [user, pageId])

  const tick = useCallback(async () => {
    await upsertPresence()
    await fetchPresence()
  }, [upsertPresence, fetchPresence])

  useEffect(() => {
    if (!user || !pageId) return

    tick()
    intervalRef.current = setInterval(tick, HEARTBEAT_INTERVAL)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      supabase
        .from('page_presence')
        .delete()
        .eq('page_id', pageId)
        .eq('user_id', user.id)
    }
  }, [user, pageId, tick])

  return activeUsers
}

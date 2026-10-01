import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { ProfileBadge } from '../types'

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
const NO_USERS: PresenceUser[] = []
const noop = () => {}

type PresenceRow = {
  user_id: string
  last_seen_at: string
  profiles: Pick<ProfileBadge, 'email' | 'display_name' | 'avatar_emoji' | 'avatar_color' | 'avatar_url'> | null
}

function toPresenceUser({ user_id, last_seen_at, profiles: prof }: PresenceRow): PresenceUser {
  return {
    user_id,
    last_seen_at,
    email: prof?.email ?? '',
    display_name: prof?.display_name ?? null,
    avatar_emoji: prof?.avatar_emoji ?? null,
    avatar_color: prof?.avatar_color ?? null,
    avatar_url: prof?.avatar_url ?? null,
  }
}

/**
 * Quem mais está na página. PERF-008: só com `active` (página compartilhada,
 * ver usePageShared) há requisições; com a aba oculta o heartbeat para e a
 * linha sai do banco, e volta com a aba visível.
 */
export function usePagePresence(pageId: string | undefined, active: boolean) {
  const { user } = useAuth()
  const userId = user?.id
  const [seen, setSeen] = useState<{ pageId: string; users: PresenceUser[] } | null>(null)

  useEffect(() => {
    if (!userId || !pageId || !active) return
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null
    // Há linha nossa no banco (upsert desde o último delete)?
    let present = false

    const tick = async () => {
      present = true
      // Heartbeat best-effort: o próximo tick tenta de novo. REL-004: a falha
      // fica no console em vez de sumir.
      const { error: heartbeatError } = await supabase
        .from('page_presence')
        .upsert(
          { page_id: pageId, user_id: userId, last_seen_at: new Date().toISOString() },
          { onConflict: 'page_id,user_id' }
        )
      if (heartbeatError) console.warn('[presence] heartbeat failed', heartbeatError)
      // Parou no meio (aba oculta, saiu da página): não precisa da lista.
      if (disposed || !timer) return
      const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString()
      const { data } = await supabase
        .from('page_presence')
        .select('user_id, last_seen_at, profiles!page_presence_user_id_profiles_fkey(email, display_name, avatar_emoji, avatar_color, avatar_url)')
        .eq('page_id', pageId)
        .gte('last_seen_at', cutoff)
        .neq('user_id', userId)
      if (data && !disposed) setSeen({ pageId, users: data.map(toPresenceUser) })
    }
    const beat = () => { tick().catch(noop) }

    const start = () => {
      if (timer) return
      timer = setInterval(beat, HEARTBEAT_INTERVAL)
      beat()
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const leave = () => {
      if (!present) return
      present = false
      // O supabase-js só envia a query quando alguém chama .then(): sem isso
      // o delete nunca saía, e a linha ficava até expirar no TTL.
      supabase.from('page_presence').delete().eq('page_id', pageId).eq('user_id', userId).then(noop, noop)
    }
    const onVisibility = () => {
      if (document.hidden) { stop(); leave() } else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    // Fechar a aba ou navegar: best-effort (a linha expira no TTL de todo jeito).
    window.addEventListener('pagehide', leave)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', leave)
      stop()
      leave()
    }
  }, [userId, pageId, active])

  if (!active || !pageId || seen?.pageId !== pageId) return NO_USERS
  return seen.users
}

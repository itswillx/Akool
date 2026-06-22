import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

type ContentTable = 'note_contents' | 'drawing_contents'

interface UseCollaborativeContentResult {
  remoteContent: unknown | null
  remoteUpdatedAt: string | null
}

export function useCollaborativeContent(
  pageId: string,
  table: ContentTable,
  enabled: boolean
): UseCollaborativeContentResult {
  const [remoteContent, setRemoteContent] = useState<unknown | null>(null)
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null)

  const contentField = table === 'note_contents' ? 'content' : 'elements'

  const fetchInitial = useCallback(async () => {
    const { data } = await supabase
      .from(table)
      .select(`${contentField}, updated_at`)
      .eq('page_id', pageId)
      .single()

    if (data) {
      setRemoteContent((data as Record<string, unknown>)[contentField])
      setRemoteUpdatedAt(data.updated_at as string)
    }
  }, [pageId, table, contentField])

  useEffect(() => {
    if (!enabled) return

    fetchInitial()

    const channel = supabase
      .channel(`${table}:${pageId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `page_id=eq.${pageId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          if (row && row[contentField] !== undefined) {
            setRemoteContent(row[contentField])
            setRemoteUpdatedAt(row.updated_at as string)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled, pageId, table, contentField, fetchInitial])

  return { remoteContent, remoteUpdatedAt }
}

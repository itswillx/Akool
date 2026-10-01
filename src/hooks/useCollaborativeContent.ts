import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchPageContent, type ContentTable } from '../lib/data/pages'

interface UseCollaborativeContentResult {
  remoteContent: unknown
  remoteUpdatedAt: string | null
}

export function useCollaborativeContent(
  pageId: string,
  table: ContentTable,
  enabled: boolean
): UseCollaborativeContentResult {
  const [remoteContent, setRemoteContent] = useState<unknown>(null)
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null)

  const contentField = table === 'note_contents' ? 'content' : 'elements'

  const fetchInitial = useCallback(async () => {
    const { data } = await fetchPageContent(table, pageId)
    if (data) {
      setRemoteContent(data.value)
      setRemoteUpdatedAt(data.updatedAt)
    }
  }, [pageId, table])

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

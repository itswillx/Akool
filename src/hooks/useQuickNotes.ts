import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { QuickNote, QuickNoteColor, QuickNoteLinkedItem } from '../types'

type QuickNotePatch = Partial<Pick<QuickNote, 'content' | 'color' | 'linked_items'>>

function normalize(row: QuickNote): QuickNote {
  return { ...row, linked_items: (row.linked_items ?? []) as QuickNoteLinkedItem[] }
}

export function useQuickNotes(userId: string | undefined) {
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    supabase
      .from('quick_notes').select('*').eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setNotes(((data as QuickNote[]) ?? []).map(normalize))
        setLoading(false)
      })
  }, [userId])

  const createNote = useCallback(async (input: { content: string; color: QuickNoteColor }) => {
    if (!userId) return
    const { data, error } = await supabase
      .from('quick_notes')
      .insert({ user_id: userId, content: input.content, color: input.color })
      .select('*').single()
    if (!error && data) setNotes(prev => [normalize(data as QuickNote), ...prev])
  }, [userId])

  const updateNote = useCallback(async (id: string, patch: QuickNotePatch) => {
    const updated_at = new Date().toISOString()
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...patch, updated_at } : n)))
    await supabase.from('quick_notes').update({ ...patch, updated_at }).eq('id', id)
  }, [])

  const deleteNote = useCallback(async (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id))
    await supabase.from('quick_notes').delete().eq('id', id)
  }, [])

  return { notes, loading, createNote, updateNote, deleteNote }
}

import { supabase } from '../supabase'
import type { WriteError } from '../optimistic'
import type { QuickNote, QuickNoteColor } from '../../types'

// API-003: consultas das notas rápidas num lugar só. O hook (useQuickNotes) e o
// reenvio dos rascunhos offline (offlineSync) gravam pelo mesmo caminho. O
// updated_at é sempre do servidor (gatilho quick_notes_updated_at): o app
// nunca o envia, só o usa como versão.

export type QuickNotePatch = Partial<Pick<QuickNote, 'content' | 'color' | 'linked_items'>>

const PATCH_KEYS = ['content', 'color', 'linked_items'] as const

export function normalizeQuickNote(row: QuickNote): QuickNote {
  return { ...row, linked_items: row.linked_items ?? [] }
}

/**
 * Os campos de um rascunho guardado. Rascunhos de antes do API-003 traziam o
 * updated_at do relógio do aparelho junto: ele fica de fora.
 */
export function quickDraftPatch(value: unknown): QuickNotePatch {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(PATCH_KEYS.filter(key => key in source).map(key => [key, source[key]]))
}

/** Os campos de `patch` já estão assim em `row`? */
export function patchMatches(row: QuickNotePatch, patch: QuickNotePatch): boolean {
  return (Object.keys(patch) as (keyof QuickNotePatch)[]).every(key =>
    JSON.stringify(row[key] ?? null) === JSON.stringify(patch[key] ?? null))
}

export function listQuickNotes(userId: string) {
  return supabase.from('quick_notes').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
}

export function insertQuickNote(userId: string, input: { content: string; color: QuickNoteColor }) {
  return supabase.from('quick_notes').insert({ user_id: userId, content: input.content, color: input.color }).select('*').single()
}

export function deleteQuickNote(id: string) {
  return supabase.from('quick_notes').delete().eq('id', id).select('id')
}

export type QuickNoteSave =
  | { status: 'saved'; at: string }
  | { status: 'conflict'; current: QuickNote }
  | { status: 'gone' }
  | { status: 'error'; error: WriteError }

/**
 * Grava `patch` só se a nota ainda estiver na versão `expected` (o updated_at
 * que o servidor devolveu por último). Com zero linhas, relê a nota:
 * - não existe mais → `gone`;
 * - já tem exatamente esses campos (reenvio duplicado) → `saved`;
 * - outra versão → `conflict`, com a nota como está no servidor.
 */
export async function saveQuickNote(id: string, patch: QuickNotePatch, expected: string): Promise<QuickNoteSave> {
  const { data, error } = await supabase.from('quick_notes').update(patch).eq('id', id).eq('updated_at', expected).select('id, updated_at')
  if (error) return { status: 'error', error }
  if (data.length > 0) return { status: 'saved', at: data[0].updated_at }

  const { data: row, error: readError } = await supabase.from('quick_notes').select('*').eq('id', id).maybeSingle()
  if (readError) return { status: 'error', error: readError }
  if (!row) return { status: 'gone' }
  const current = normalizeQuickNote(row)
  return patchMatches(current, patch) ? { status: 'saved', at: current.updated_at } : { status: 'conflict', current }
}

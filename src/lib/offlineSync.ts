import { supabase } from './supabase'
import { asVersionedClient, isContentOpen, saveVersionedContent } from './contentPersistence'
import { deleteDraft, listDrafts, type Draft, type DraftTable } from './offlineStore'
import { requireRows } from './optimistic'
import type { TableUpdate } from '../types/db'

// REL-012: reenvia os rascunhos guardados sem conexão. Carrega sob demanda
// (`import()`), no `online` e logo depois do login. Páginas abertas ficam
// com o próprio editor (ele faz o flush); um conflito (alguém salvou depois)
// fica guardado para a página mostrar o aviso quando abrir.

export interface FlushReport { sent: number; kept: number }

export async function flushDrafts(userId: string, only?: DraftTable): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, kept: 0 }
  for (const draft of await listDrafts(userId)) {
    if (only && draft.table !== only) continue
    if (draft.table !== 'quick_notes' && isContentOpen(draft.table, draft.id)) { report.kept++; continue }
    const ok = draft.table === 'quick_notes' ? await sendQuickNote(draft) : await sendContent(draft)
    if (ok) {
      await deleteDraft(draft.key)
      report.sent++
    } else {
      report.kept++
    }
  }
  return report
}

/** Nota: o rascunho é o `content`; desenho: a linha inteira (elements, app_state, files). */
async function sendContent(draft: Draft): Promise<boolean> {
  if (draft.table === 'quick_notes') return false
  const values = draft.table === 'note_contents'
    ? { content: draft.value }
    : (draft.value as Record<string, unknown>)
  const result = await saveVersionedContent(asVersionedClient(supabase), { table: draft.table, pageId: draft.id, values, expected: draft.version })
  return result.ok
}

async function sendQuickNote(draft: Draft): Promise<boolean> {
  const patch = draft.value as TableUpdate<'quick_notes'>
  const result = requireRows(await supabase.from('quick_notes').update(patch).eq('id', draft.id).select('id'))
  return !result.error
}

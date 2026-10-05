import { supabase } from './supabase'
import { asVersionedClient, isContentOpen, saveVersionedContent } from './contentPersistence'
import { quickDraftPatch, saveQuickNote } from './data/quickNotes'
import { deleteDraft, listDrafts, type Draft, type DraftTable } from './offlineStore'
import type { QuickNote } from '../types'

// REL-012: reenvia os rascunhos guardados sem conexão. Carrega sob demanda
// (`import()`), no `online` e logo depois do login. Páginas abertas ficam
// com o próprio editor (ele faz o flush); um conflito (alguém salvou depois)
// fica guardado para a página mostrar o aviso quando abrir.
// API-003: quick notes também gravam sobre a versão em que a edição foi feita;
// o conflito fica guardado para a tela de notas rápidas mostrar.

/**
 * - `sent`: gravou (rascunho apagado);
 * - `kept`: não deu agora (rede, página aberta, outro envio em andamento);
 * - `conflict`: alguém salvou depois (rascunho guardado para o aviso);
 * - `dropped`: a nota não existe mais (rascunho apagado).
 */
export type FlushStatus = 'sent' | 'kept' | 'conflict' | 'dropped'

export interface FlushItem {
  key: string
  table: DraftTable
  id: string
  status: FlushStatus
  /** `sent` de quick note: a versão nova. */
  at?: string
  /** `conflict` de quick note: a nota como está no servidor (sem ela, o rascunho é antigo e não tem versão). */
  current?: QuickNote
}

export interface FlushReport { sent: number; kept: number; dropped: number; results: FlushItem[] }

type Outcome = Pick<FlushItem, 'status' | 'at' | 'current'>

// O App (login e reconexão) e a tela de notas rápidas disparam o reenvio ao
// mesmo tempo: um rascunho só sai uma vez.
const inFlight = new Set<string>()

export async function flushDrafts(userId: string, only?: DraftTable): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, kept: 0, dropped: 0, results: [] }
  for (const draft of await listDrafts(userId)) {
    if (only && draft.table !== only) continue
    let outcome: Outcome = { status: 'kept' }
    const busy = inFlight.has(draft.key) || (draft.table !== 'quick_notes' && isContentOpen(draft.table, draft.id))
    if (!busy) {
      inFlight.add(draft.key)
      try {
        outcome = draft.table === 'quick_notes' ? await sendQuickNote(draft) : { status: (await sendContent(draft)) ? 'sent' : 'kept' }
        if (outcome.status === 'sent' || outcome.status === 'dropped') await deleteDraft(draft.key)
      } finally {
        inFlight.delete(draft.key)
      }
    }
    if (outcome.status === 'sent') report.sent++
    else if (outcome.status === 'dropped') report.dropped++
    else report.kept++
    report.results.push({ key: draft.key, table: draft.table, id: draft.id, ...outcome })
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

/** Rascunho antigo, sem versão, nunca vai às cegas: vira conflito para a pessoa escolher. */
async function sendQuickNote(draft: Draft): Promise<Outcome> {
  if (draft.version === null) return { status: 'conflict' }
  const result = await saveQuickNote(draft.id, quickDraftPatch(draft.value), draft.version)
  switch (result.status) {
    case 'saved': return { status: 'sent', at: result.at }
    case 'gone': return { status: 'dropped' }
    case 'conflict': return { status: 'conflict', current: result.current }
    default: return { status: 'kept' }
  }
}

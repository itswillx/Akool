import type { SupabaseClient } from '@supabase/supabase-js'
// API-027: o plano (colunas por tópico, linhas, limites e rótulos) é puro e mora
// em supabase/functions/_domain/importPlan.ts, que a API também usa. Aqui fica a
// gravação pelo supabase-js. O planTopicColumns continua saindo daqui: a tela,
// a CLI e o mock do ImportCardsModal.test.tsx importam deste arquivo.
import { importIssueText, planCardRows, type TopicColumnPlan } from '../../supabase/functions/_domain/importPlan'
import type { ParsedBacklogCard } from './backlogMarkdownParser'

export { planTopicColumns, type TopicColumnPlan } from '../../supabase/functions/_domain/importPlan'

const BATCH_SIZE = 20

export interface EnsureTopicColumnsResult {
  columnByTopic: Record<string, string>
  created: number
  error?: string
}

export async function ensureTopicColumns(
  supabase: SupabaseClient,
  boardId: string,
  plan: TopicColumnPlan[],
): Promise<EnsureTopicColumnsResult> {
  const columnByTopic: Record<string, string> = {}
  const missing: TopicColumnPlan[] = []

  for (const p of plan) {
    if (p.columnId) columnByTopic[p.topic] = p.columnId
    else missing.push(p)
  }

  if (missing.length === 0) return { columnByTopic, created: 0 }

  const { data, error } = await supabase
    .from('project_columns')
    .insert(missing.map(p => ({ board_id: boardId, name: p.name, color: p.color, sort_order: p.sortOrder })))
    .select('id, name')

  if (error) return { columnByTopic, created: 0, error: error.message }

  const idByName = new Map(((data ?? []) as { id: string; name: string }[]).map(r => [r.name, r.id]))
  for (const p of missing) {
    const id = idByName.get(p.name)
    if (id) columnByTopic[p.topic] = id
  }

  return { columnByTopic, created: idByName.size }
}

export interface ImportCardsResult {
  created: number
  skipped: number
  /** IDs pulados porque um card com o mesmo "ID —" já está no quadro (UX-009). */
  skippedIds: string[]
  errors: string[]
}

export async function importParsedCards(
  supabase: SupabaseClient,
  boardId: string,
  columnId: string | null,
  cards: ParsedBacklogCard[],
  options: { skipDuplicates?: boolean; columnByTopic?: Record<string, string> } = {},
): Promise<ImportCardsResult> {
  const { data: existingRows, error: existingError } = await supabase
    .from('project_cards')
    .select('title, column_id, sort_order')
    .eq('board_id', boardId)

  if (existingError) {
    return { created: 0, skipped: 0, skippedIds: [], errors: [existingError.message] }
  }

  const plan = planCardRows({
    boardId,
    fallbackColumnId: columnId,
    cards,
    existing: existingRows ?? [],
    columnByTopic: options.columnByTopic,
    skipDuplicates: options.skipDuplicates,
  })
  const { skippedIds } = plan
  if (plan.issues.length > 0) {
    return { created: 0, skipped: skippedIds.length, skippedIds, errors: plan.issues.map(importIssueText) }
  }

  const errors: string[] = []
  let created = 0
  for (let i = 0; i < plan.rows.length; i += BATCH_SIZE) {
    const chunk = plan.rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('project_cards').insert(chunk)
    if (error) {
      errors.push(error.message)
      break
    }
    created += chunk.length
  }

  return { created, skipped: skippedIds.length, skippedIds, errors }
}

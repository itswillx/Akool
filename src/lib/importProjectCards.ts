import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedBacklogCard } from './backlogMarkdownParser'
import type { ProjectColumn } from '../types'
import { normalizeSearch } from './graph'

const BATCH_SIZE = 20

// Mesmas cores de BOARD_COLORS (ProjectsPanel), em ciclo pela ordem do tópico no arquivo.
const TOPIC_COLUMN_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']

function titleMatchesExternalId(title: string, externalId: string): boolean {
  return title.startsWith(`${externalId} —`) || title.startsWith(`${externalId} -`)
}

export interface TopicColumnPlan {
  topic: string
  name: string
  color: string
  /** Coluna existente com o mesmo nome (sem acento/caixa); null = será criada. */
  columnId: string | null
  sortOrder: number
}

/**
 * Uma coluna por `## Tópico:` do backlog, na ordem do arquivo. Reaproveita
 * colunas com o mesmo nome para o reimport não duplicar; as novas entram
 * depois das existentes.
 */
export function planTopicColumns(
  topics: string[],
  existingColumns: Pick<ProjectColumn, 'id' | 'name' | 'sort_order'>[],
): TopicColumnPlan[] {
  const byName = new Map(existingColumns.map(c => [normalizeSearch(c.name), c]))
  let nextOrder = existingColumns.length ? Math.max(...existingColumns.map(c => c.sort_order)) + 1 : 0

  return topics.map((topic, i) => {
    const existing = byName.get(normalizeSearch(topic))
    return {
      topic,
      name: existing?.name ?? topic,
      color: TOPIC_COLUMN_COLORS[i % TOPIC_COLUMN_COLORS.length],
      columnId: existing?.id ?? null,
      sortOrder: existing?.sort_order ?? nextOrder++,
    }
  })
}

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
  const skipDuplicates = options.skipDuplicates ?? true
  const columnByTopic = options.columnByTopic ?? {}
  const errors: string[] = []
  const skippedIds: string[] = []
  let created = 0

  const columnFor = (card: ParsedBacklogCard) => (card.topic ? columnByTopic[card.topic] : undefined) ?? columnId

  const { data: existingRows, error: existingError } = await supabase
    .from('project_cards')
    .select('title, column_id, sort_order')
    .eq('board_id', boardId)

  if (existingError) {
    return { created: 0, skipped: 0, skippedIds, errors: [existingError.message] }
  }

  const existing = (existingRows ?? []) as { title: string; column_id: string; sort_order: number }[]
  const existingTitles = existing.map(r => r.title)
  const nextOrder = new Map<string, number>()
  for (const r of existing) {
    nextOrder.set(r.column_id, Math.max(nextOrder.get(r.column_id) ?? 0, r.sort_order + 1))
  }

  const toInsert: { card: ParsedBacklogCard; columnId: string }[] = []

  for (const card of cards) {
    if (skipDuplicates && existingTitles.some(t => titleMatchesExternalId(t, card.externalId))) {
      skippedIds.push(card.externalId)
      continue
    }
    const target = columnFor(card)
    if (!target) {
      errors.push(`${card.externalId}: sem coluna de destino`)
      continue
    }
    toInsert.push({ card, columnId: target })
  }

  if (errors.length > 0) return { created: 0, skipped: skippedIds.length, skippedIds, errors }

  const rows = toInsert.map(({ card, columnId: target }) => {
    const order = nextOrder.get(target) ?? 0
    nextOrder.set(target, order + 1)
    return {
      board_id: boardId,
      column_id: target,
      title: card.fullTitle,
      description: card.description,
      priority: card.priority,
      due_date: null,
      assignee_user_id: null,
      labels: card.labels,
      linked_page_id: null,
      completed: false,
      checklist: card.checklist,
      attachments: [],
      sort_order: order,
      updated_at: new Date().toISOString(),
    }
  })

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('project_cards').insert(chunk)
    if (error) {
      errors.push(error.message)
      break
    }
    created += chunk.length
  }

  return { created, skipped: skippedIds.length, skippedIds, errors }
}

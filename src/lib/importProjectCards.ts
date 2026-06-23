import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedBacklogCard } from './backlogMarkdownParser'

const BATCH_SIZE = 20

function titleMatchesExternalId(title: string, externalId: string): boolean {
  return title.startsWith(`${externalId} —`) || title.startsWith(`${externalId} -`)
}

export interface ImportCardsResult {
  created: number
  skipped: number
  errors: string[]
}

export async function importParsedCards(
  supabase: SupabaseClient,
  boardId: string,
  columnId: string,
  cards: ParsedBacklogCard[],
  options: { skipDuplicates?: boolean } = {},
): Promise<ImportCardsResult> {
  const skipDuplicates = options.skipDuplicates ?? true
  const errors: string[] = []
  let created = 0
  let skipped = 0

  const { data: existingRows, error: existingError } = await supabase
    .from('project_cards')
    .select('title')
    .eq('board_id', boardId)

  if (existingError) {
    return { created: 0, skipped: 0, errors: [existingError.message] }
  }

  const existingTitles = (existingRows ?? []).map(r => r.title as string)

  const { data: colCards, error: sortError } = await supabase
    .from('project_cards')
    .select('sort_order')
    .eq('column_id', columnId)
    .order('sort_order', { ascending: false })
    .limit(1)

  if (sortError) {
    return { created: 0, skipped: 0, errors: [sortError.message] }
  }

  let nextOrder = (colCards?.[0]?.sort_order ?? -1) + 1
  const toInsert: ParsedBacklogCard[] = []

  for (const card of cards) {
    if (skipDuplicates && existingTitles.some(t => titleMatchesExternalId(t, card.externalId))) {
      skipped++
      continue
    }
    toInsert.push(card)
  }

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const chunk = toInsert.slice(i, i + BATCH_SIZE)
    const rows = chunk.map((card, idx) => ({
      board_id: boardId,
      column_id: columnId,
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
      sort_order: nextOrder + idx,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await supabase.from('project_cards').insert(rows)
    if (error) {
      errors.push(error.message)
      break
    }
    created += chunk.length
    nextOrder += chunk.length
  }

  return { created, skipped, errors }
}

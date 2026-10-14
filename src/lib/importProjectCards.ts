import type { SupabaseClient } from '@supabase/supabase-js'
// API-027: o plano (colunas por tópico, linhas, limites e rótulos) é puro e mora
// em supabase/functions/_domain/importPlan.ts, que a API também usa. Aqui fica a
// gravação pelo supabase-js. O planTopicColumns continua saindo daqui: a tela,
// a CLI e o mock do ImportCardsModal.test.tsx importam deste arquivo.
import { tPtBR, type DomainTFor } from '../../supabase/functions/_domain/i18n.pt-BR'
import {
  importIssueText, insertBatches, oldestFirst, planCardRows, type ImportIssueKey, type ImportWarning, type TopicColumnPlan,
} from '../../supabase/functions/_domain/importPlan'
import type { Database } from '../types/db'
import type { ParsedBacklogCard } from './backlogMarkdownParser'
import { fetchAllRows } from './fetchAllRows'

export {
  importIssueText,
  importWarningText,
  oldestFirst,
  planCardRows,
  planTopicColumns,
  type ImportWarning,
  type TopicColumnPlan,
} from '../../supabase/functions/_domain/importPlan'

const BATCH_SIZE = 20

export interface EnsureTopicColumnsResult {
  columnByTopic: Record<string, string>
  created: number
  error?: string
}

export async function ensureTopicColumns(
  supabase: SupabaseClient<Database>,
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
  /** API-033: dependências que ficaram de fora (importWarningText dá o texto). */
  warnings: ImportWarning[]
}

export interface ImportCardsOptions {
  skipDuplicates?: boolean
  columnByTopic?: Record<string, string>
  /** O idioma dos problemas em `errors` (importIssueText): a tela passa o `t` dela; padrão, o tPtBR (CLI). */
  t?: DomainTFor<ImportIssueKey>
}

/**
 * Grava os cards no quadro. API-033: lê o quadro inteiro (REL-003, páginas de
 * 1000), põe do mais antigo para o mais novo com o oldestFirst, como a prévia
 * do ImportCardsModal, e insere por níveis de dependência (insertBatches). Se
 * um lote falha, os anteriores ficam, e cada card gravado já tem as
 * dependências gravadas: uma nova tentativa com "pular duplicados" grava o resto.
 */
export async function importParsedCards(
  supabase: SupabaseClient<Database>,
  boardId: string,
  columnId: string | null,
  cards: ParsedBacklogCard[],
  options: ImportCardsOptions = {},
): Promise<ImportCardsResult> {
  // O order deixa as páginas estáveis; quem decide qual card vale é o oldestFirst.
  const existing = await fetchAllRows((from, to) => supabase
    .from('project_cards')
    .select('id, title, column_id, sort_order, depends_on, created_at')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))

  if (existing.error) {
    return { created: 0, skipped: 0, skippedIds: [], errors: [existing.error.message], warnings: [] }
  }

  const plan = planCardRows({
    boardId,
    fallbackColumnId: columnId,
    cards,
    existing: oldestFirst(existing.data),
    columnByTopic: options.columnByTopic,
    skipDuplicates: options.skipDuplicates,
    newId: () => crypto.randomUUID(),
  })
  const { skippedIds, warnings } = plan
  if (plan.issues.length > 0) {
    const t = options.t ?? tPtBR
    return { created: 0, skipped: skippedIds.length, skippedIds, errors: plan.issues.map(issue => importIssueText(issue, t)), warnings }
  }

  const errors: string[] = []
  let created = 0
  for (const chunk of insertBatches(plan.rows, BATCH_SIZE)) {
    const { error } = await supabase.from('project_cards').insert(chunk)
    if (error) {
      errors.push(error.message)
      break
    }
    created += chunk.length
  }

  return { created, skipped: skippedIds.length, skippedIds, errors, warnings }
}

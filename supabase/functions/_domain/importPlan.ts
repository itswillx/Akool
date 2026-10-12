// API-027: o plano da importação de backlog, puro: colunas por tópico, linhas
// de project_cards, limites e rótulos. Quem grava é src/lib/importProjectCards.ts
// (supabase-js) e, no API-055, o handler da API (na transação). A forma de
// ImportCardRow e de planCardRows ainda não é contrato: o API-033 vai precisar
// do id das linhas novas antes do insert (depends_on dentro da mesma importação).

import type { BacklogIssue, ParsedBacklogCard } from './backlogMarkdownParser.ts'
import { CARD_LABELS_MAX, normalizeCardLabels } from './cardLabels.ts'
import { CHECKLIST_MAX_ITEMS, CHECKLIST_MAX_TEXT } from './cardLimits.ts'
import type { DomainTFor } from './i18n.pt-BR.ts'
import type { ProjectCardPriority, ProjectChecklistItem } from './projectTypes.ts'
import { normalizeSearch } from './text.ts'

// Mesmas cores de BOARD_COLORS (ProjectsPanel), em ciclo pela ordem do tópico no arquivo.
export const TOPIC_COLUMN_COLORS: readonly string[] = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']

/** As chaves dos avisos do parser (UX-011), uma por BacklogIssueCode. */
export type BacklogIssueKey = `projects_import_issue_${BacklogIssue['code']}`

/** O aviso do parser no texto da tela de importação, para o dry_run da API sair igual. */
export function backlogIssueText(issue: BacklogIssue, t: DomainTFor<BacklogIssueKey>): string {
  return t(`projects_import_issue_${issue.code}`, { id: issue.cardId ?? '', detail: issue.detail ?? '' })
}

/** Por que um card do arquivo não pode entrar: com algum, nada é gravado. */
export type ImportIssueCode = 'no_column' | 'checklist_too_many' | 'checklist_text_too_long'

export interface ImportIssue {
  code: ImportIssueCode
  cardId: string
}

const ISSUE_TEXT: Record<ImportIssueCode, string> = {
  no_column: 'sem coluna de destino',
  checklist_too_many: `mais de ${CHECKLIST_MAX_ITEMS} subtarefas`,
  checklist_text_too_long: `subtarefa com mais de ${CHECKLIST_MAX_TEXT} caracteres`,
}

/** O texto de sempre (tela e CLI): `A-001: mais de 500 subtarefas`. */
export function importIssueText(issue: ImportIssue): string {
  return `${issue.cardId}: ${ISSUE_TEXT[issue.code]}`
}

/** Um card fora do limite derrubaria o lote inteiro no servidor: ele vira erro antes. */
function checklistLimitProblem(checklist: readonly ProjectChecklistItem[]): ImportIssueCode | null {
  if (checklist.length > CHECKLIST_MAX_ITEMS) return 'checklist_too_many'
  if (checklist.some(item => [...item.text].length > CHECKLIST_MAX_TEXT)) return 'checklist_text_too_long'
  return null
}

/**
 * Rótulos no formato do servidor. Acima de 30, os que o importador gera (tema
 * e esforço, que o parser põe no fim) vêm primeiro, para não serem os cortados.
 */
export function importLabels(card: Pick<ParsedBacklogCard, 'labels' | 'topic'>): string[] {
  if (card.labels.length <= CARD_LABELS_MAX) return normalizeCardLabels(card.labels)
  const generated = card.labels.filter(l => l.startsWith('esforço:') || (card.topic && l === card.topic.trim().toLowerCase()))
  return normalizeCardLabels([...generated, ...card.labels.filter(l => !generated.includes(l))])
}

/** O card do quadro já é o do arquivo: o título começa com "ID —" (UX-009). */
export function titleMatchesExternalId(title: string, externalId: string): boolean {
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
  topics: readonly string[],
  existingColumns: readonly { id: string; name: string; sort_order: number }[],
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

/** A linha de project_cards que a importação insere (o updated_at é do servidor). */
export interface ImportCardRow {
  board_id: string
  column_id: string
  title: string
  description: string
  priority: ProjectCardPriority
  due_date: null
  assignee_user_id: null
  labels: string[]
  linked_page_id: null
  completed: false
  checklist: ProjectChecklistItem[]
  attachments: []
  sort_order: number
}

export interface CardRowsPlan {
  /** Na ordem do arquivo; vazio quando há issues. */
  rows: ImportCardRow[]
  /** IDs pulados porque um card com o mesmo "ID —" já está no quadro (UX-009). */
  skippedIds: string[]
  /** Com alguma, nada deve ser gravado. */
  issues: ImportIssue[]
}

/**
 * As linhas a inserir, na ordem do arquivo. O sort_order de cada coluna
 * continua depois do maior que ela já tem, para os importados ficarem na ordem
 * do arquivo. `existing` são os cards do quadro (título, coluna e ordem).
 */
export function planCardRows(input: {
  boardId: string
  /** A coluna do card sem tópico (ou com tópico sem coluna). */
  fallbackColumnId: string | null
  cards: readonly ParsedBacklogCard[]
  existing: readonly { title: string; column_id: string; sort_order: number }[]
  columnByTopic?: Readonly<Record<string, string>>
  skipDuplicates?: boolean
}): CardRowsPlan {
  const { boardId, fallbackColumnId, cards, existing } = input
  const skipDuplicates = input.skipDuplicates ?? true
  const columnByTopic = input.columnByTopic ?? {}
  const skippedIds: string[] = []
  const issues: ImportIssue[] = []

  const nextOrder = new Map<string, number>()
  for (const r of existing) nextOrder.set(r.column_id, Math.max(nextOrder.get(r.column_id) ?? 0, r.sort_order + 1))

  const toInsert: { card: ParsedBacklogCard; columnId: string }[] = []
  for (const card of cards) {
    if (skipDuplicates && existing.some(r => titleMatchesExternalId(r.title, card.externalId))) {
      skippedIds.push(card.externalId)
      continue
    }
    const target = (card.topic ? columnByTopic[card.topic] : undefined) ?? fallbackColumnId
    if (!target) {
      issues.push({ code: 'no_column', cardId: card.externalId })
      continue
    }
    const problem = checklistLimitProblem(card.checklist)
    if (problem) {
      issues.push({ code: problem, cardId: card.externalId })
      continue
    }
    toInsert.push({ card, columnId: target })
  }

  if (issues.length > 0) return { rows: [], skippedIds, issues }

  const rows = toInsert.map(({ card, columnId }): ImportCardRow => {
    const order = nextOrder.get(columnId) ?? 0
    nextOrder.set(columnId, order + 1)
    return {
      board_id: boardId,
      column_id: columnId,
      title: card.fullTitle,
      description: card.description,
      priority: card.priority,
      due_date: null,
      assignee_user_id: null,
      // API-013: o servidor recusa rótulo repetido sem caixa, longo ou além
      // de 30; aqui eles saem já no formato. O updated_at é do servidor.
      labels: importLabels(card),
      linked_page_id: null,
      completed: false,
      checklist: card.checklist,
      attachments: [],
      sort_order: order,
    }
  })
  return { rows, skippedIds, issues }
}

// API-027: o plano da importação de backlog, puro: colunas por tópico, linhas
// de project_cards, limites e rótulos. Quem grava é src/lib/importProjectCards.ts
// (supabase-js), na tela e na CLI (import:cards).
// API-033: ImportCardRow é contrato. O id de cada linha nova sai daqui (newId),
// para o depends_on apontar para cards da mesma importação, e insertBatches
// grava por níveis: o gatilho do API-013 recusa a dependência que ainda não
// existe, inclusive a que vem depois no mesmo INSERT.

import type { BacklogIssue, ParsedBacklogCard } from './backlogMarkdownParser.ts'
import { CARD_LABELS_MAX, normalizeCardLabels } from './cardLabels.ts'
import { CHECKLIST_MAX_ITEMS, CHECKLIST_MAX_TEXT, DEPENDS_ON_MAX } from './cardLimits.ts'
import type { DomainTFor } from './i18n.pt-BR.ts'
import type { ProjectCardPriority, ProjectChecklistItem } from './projectTypes.ts'
import { normalizeSearch } from './text.ts'

// Mesmas cores de BOARD_COLORS (ProjectsPanel), em ciclo pela ordem do tópico no arquivo.
export const TOPIC_COLUMN_COLORS: readonly string[] = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']

/** As chaves dos avisos do parser (UX-011), uma por BacklogIssueCode. */
export type BacklogIssueKey = `projects_import_issue_${BacklogIssue['code']}`

/** O aviso do parser no texto da tela de importação. */
export function backlogIssueText(issue: BacklogIssue, t: DomainTFor<BacklogIssueKey>): string {
  return t(`projects_import_issue_${issue.code}`, { id: issue.cardId ?? '', detail: issue.detail ?? '' })
}

/** Por que um card do arquivo não pode entrar: com algum, nada é gravado. */
export type ImportIssueCode =
  | 'no_column' | 'checklist_too_many' | 'checklist_text_too_long'
  | 'dependency_cycle' | 'depends_on_too_many'

export interface ImportIssue {
  code: ImportIssueCode
  cardId: string
  /** dependency_cycle: o caminho, `AB-001 → AB-002 → AB-001` (→ = depende de). */
  detail?: string
}

/** As chaves dos problemas que impedem a importação, uma por ImportIssueCode. */
export type ImportIssueKey = `projects_import_error_${ImportIssueCode}`

/** O limite que o texto da issue cita ({max}). */
const ISSUE_MAX: Readonly<Partial<Record<ImportIssueCode, number>>> = {
  checklist_too_many: CHECKLIST_MAX_ITEMS,
  checklist_text_too_long: CHECKLIST_MAX_TEXT,
  depends_on_too_many: DEPENDS_ON_MAX,
}

/**
 * O problema no idioma do `t` (`A-001: mais de 500 subtarefas`). A tela passa
 * o `t` dela; a CLI, o tPtBR.
 */
export function importIssueText(issue: ImportIssue, t: DomainTFor<ImportIssueKey>): string {
  return t(`projects_import_error_${issue.code}`, { id: issue.cardId, detail: issue.detail ?? '', max: ISSUE_MAX[issue.code] ?? '' })
}

/** API-033: dependência que ficou de fora. Não impede gravar. */
export type ImportWarningCode = 'dependency_not_found' | 'dependency_not_applied'

export interface ImportWarning {
  code: ImportWarningCode
  /** O card que declara o `Depende de`. */
  cardId: string
  /** dependency_not_found: o ID; dependency_not_applied: os IDs, separados por vírgula. */
  detail: string
}

/** As chaves dos avisos de dependência, uma por ImportWarningCode. */
export type ImportWarningKey = `projects_import_warning_${ImportWarningCode}`

/** O aviso de dependência no texto da tela de importação (a CLI usa o tPtBR). */
export function importWarningText(warning: ImportWarning, t: DomainTFor<ImportWarningKey>): string {
  return t(`projects_import_warning_${warning.code}`, { id: warning.cardId, detail: warning.detail })
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
  /** API-033: gerado antes do insert, para o depends_on de outra linha nova apontar para ele. */
  id: string
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
  /** Ids de cards: das linhas novas ou do quadro. */
  depends_on: string[]
  sort_order: number
}

export interface CardRowsPlan {
  /** Na ordem do arquivo; vazio quando há issues. Para gravar, use insertBatches. */
  rows: ImportCardRow[]
  /** IDs pulados porque um card com o mesmo "ID —" já está no quadro (UX-009). */
  skippedIds: string[]
  /** Com alguma, nada deve ser gravado. */
  issues: ImportIssue[]
  /** API-033: dependências que ficaram de fora. Saem também quando há issues (a prévia mostra). */
  warnings: ImportWarning[]
}

/**
 * Uma cópia dos cards do quadro do mais antigo para o mais novo: created_at e,
 * no empate (os cards de uma importação saem da mesma transação), o id. É a
 * ordem que o planCardRows pede, e a prévia e a gravação passam por aqui para
 * escolherem o mesmo card de cada ID externo. Compara os textos com < e >, como
 * o `order by created_at, id` do Postgres: o uuid ordena byte a byte, e o
 * created_at do PostgREST vem sempre em UTC (+00:00), em que a ordem do texto é
 * a do instante. O Date.parse perderia os microssegundos, e o localeCompare
 * segue o idioma, não os bytes.
 */
export function oldestFirst<T extends { id: string; created_at: string }>(cards: readonly T[]): T[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return [...cards].sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
}

/** O card do quadro, como o plano precisa dele. */
export interface ExistingCard {
  id: string
  title: string
  column_id: string
  sort_order: number
  /** Quando vem, o aviso dependency_not_applied só cita a dependência que falta nele. */
  depends_on?: readonly string[]
}

/**
 * O card do quadro de cada ID externo ("ID —" ou "ID -" no começo do título,
 * como titleMatchesExternalId): o 1º da lista, que o caller manda do mais
 * antigo para o mais novo (oldestFirst).
 */
function boardCardsByExternalId(existing: readonly ExistingCard[]): Map<string, ExistingCard> {
  const byId = new Map<string, ExistingCard>()
  for (const card of existing) {
    // O ID externo não tem espaço: é o começo do título até o 1º espaço.
    const key = card.title.slice(0, card.title.indexOf(' '))
    if (key && titleMatchesExternalId(card.title, key) && !byId.has(key)) byId.set(key, card)
  }
  return byId
}

/**
 * O nível de cada linha: 0 sem dependência entre as linhas, senão 1 + o maior
 * nível das dependências (Kahn). -1 na linha que está num ciclo ou depende de
 * um. `deps[i]` são os índices de que a linha i depende, sem repetir.
 */
function dependencyLevels(deps: readonly (readonly number[])[]): number[] {
  const level = deps.map(() => -1)
  const pending = deps.map(d => d.length)
  const dependents: number[][] = deps.map(() => [])
  deps.forEach((d, i) => { for (const j of d) dependents[j].push(i) })
  const queue: number[] = []
  deps.forEach((d, i) => { if (d.length === 0) { level[i] = 0; queue.push(i) } })
  for (let k = 0; k < queue.length; k++) {
    for (const i of dependents[queue[k]]) {
      // O nível só sai quando todas as dependências já têm o seu: a linha de
      // um ciclo fica com -1 mesmo dependendo também de linhas com nível.
      if (--pending[i] > 0) continue
      level[i] = deps[i].reduce((max, d) => Math.max(max, level[d]), -1) + 1
      queue.push(i)
    }
  }
  return level
}

/**
 * Um ciclo por caminhada entre as linhas sem nível, cada um começando na linha
 * que vem antes no arquivo. Toda linha sem nível depende de outra sem nível,
 * então seguir a 1ª dependência sem nível sempre fecha um ciclo.
 */
function dependencyCycles(deps: readonly (readonly number[])[], level: readonly number[]): number[][] {
  const walk = deps.map(() => -1)
  const cycles: number[][] = []
  for (let s = 0; s < deps.length; s++) {
    if (level[s] >= 0 || walk[s] >= 0) continue
    const path: number[] = []
    let x = s
    while (walk[x] < 0) {
      walk[x] = s
      path.push(x)
      for (const d of deps[x]) {
        if (level[d] < 0) {
          x = d
          break
        }
      }
    }
    if (walk[x] !== s) continue
    const cycle = path.slice(path.indexOf(x))
    const first = cycle.indexOf(cycle.reduce((min, i) => Math.min(min, i)))
    cycles.push([...cycle.slice(first), ...cycle.slice(0, first)])
  }
  return cycles
}

/**
 * As linhas a inserir, na ordem do arquivo. O sort_order de cada coluna
 * continua depois do maior que ela já tem, para os importados ficarem na ordem
 * do arquivo. `existing` são os cards do quadro, do mais antigo para o mais
 * novo (oldestFirst): o 1º de cada ID externo é o que vale para pular e para
 * as dependências.
 *
 * API-033: `Depende de` resolve primeiro no arquivo (a linha nova) e depois no
 * quadro; o que não acha vira o aviso dependency_not_found, sem a aresta. O
 * card pulado não muda (dependency_not_applied). Ciclo entre as linhas novas e
 * mais de DEPENDS_ON_MAX dependências são issues.
 */
export function planCardRows(input: {
  boardId: string
  /** A coluna do card sem tópico (ou com tópico sem coluna). */
  fallbackColumnId: string | null
  cards: readonly ParsedBacklogCard[]
  existing: readonly ExistingCard[]
  columnByTopic?: Readonly<Record<string, string>>
  skipDuplicates?: boolean
  /** O id de cada linha nova, na ordem do arquivo (padrão: crypto.randomUUID). */
  newId?: () => string
}): CardRowsPlan {
  const { boardId, fallbackColumnId, cards, existing } = input
  const skipDuplicates = input.skipDuplicates ?? true
  const columnByTopic = input.columnByTopic ?? {}
  const newId = input.newId ?? (() => crypto.randomUUID())
  const skippedIds: string[] = []
  const issues: ImportIssue[] = []
  const warnings: ImportWarning[] = []

  const nextOrder = new Map<string, number>()
  for (const r of existing) nextOrder.set(r.column_id, Math.max(nextOrder.get(r.column_id) ?? 0, r.sort_order + 1))
  const onBoard = boardCardsByExternalId(existing)

  const skipped: { card: ParsedBacklogCard; board: ExistingCard }[] = []
  // A coluna '' nunca vira linha: o card sem coluna é issue, e com issue não há linhas.
  const toInsert: { card: ParsedBacklogCard; columnId: string }[] = []
  for (const card of cards) {
    const board = skipDuplicates ? onBoard.get(card.externalId) : undefined
    if (board) {
      skippedIds.push(card.externalId)
      skipped.push({ card, board })
      continue
    }
    const target = (card.topic ? columnByTopic[card.topic] : undefined) ?? fallbackColumnId
    const problem = target ? checklistLimitProblem(card.checklist) : 'no_column'
    if (problem) issues.push({ code: problem, cardId: card.externalId })
    toInsert.push({ card, columnId: target ?? '' })
  }

  // Cada dependência: o índice da linha nova ou o id do card do quadro.
  const fileIndex = new Map(toInsert.map(({ card }, i): [string, number] => [card.externalId, i]))
  const targets = toInsert.map(({ card }) => {
    const out = new Set<number | string>()
    for (const ext of new Set(card.dependsOn)) {
      const target = fileIndex.get(ext) ?? onBoard.get(ext)?.id
      if (target === undefined) warnings.push({ code: 'dependency_not_found', cardId: card.externalId, detail: ext })
      else out.add(target)
    }
    if (out.size > DEPENDS_ON_MAX) issues.push({ code: 'depends_on_too_many', cardId: card.externalId })
    return [...out]
  })

  // O card pulado não muda: avisa a dependência que ele não tem no quadro (sem
  // o depends_on dele, todas). A que resolve para uma linha nova nunca está lá.
  for (const { card, board } of skipped) {
    const has = board.depends_on ? new Set(board.depends_on) : null
    const missing = [...new Set(card.dependsOn)].filter(ext => {
      const id = fileIndex.has(ext) ? undefined : onBoard.get(ext)?.id
      return !has || id === undefined || !has.has(id)
    })
    if (missing.length > 0) warnings.push({ code: 'dependency_not_applied', cardId: card.externalId, detail: missing.join(', ') })
  }

  const deps = targets.map(t => t.filter((d): d is number => typeof d === 'number'))
  for (const cycle of dependencyCycles(deps, dependencyLevels(deps))) {
    const path = [...cycle, cycle[0]].map(i => toInsert[i].card.externalId)
    issues.push({ code: 'dependency_cycle', cardId: path[0], detail: path.join(' → ') })
  }

  if (issues.length > 0) return { rows: [], skippedIds, issues, warnings }

  const ids = toInsert.map(() => newId())
  const rows = toInsert.map(({ card, columnId }, i): ImportCardRow => {
    const order = nextOrder.get(columnId) ?? 0
    nextOrder.set(columnId, order + 1)
    return {
      id: ids[i],
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
      depends_on: targets[i].map(d => (typeof d === 'number' ? ids[d] : d)),
      sort_order: order,
    }
  })
  return { rows, skippedIds, issues, warnings }
}

/**
 * As linhas em lotes de até `size`, na ordem de gravar: por nível de
 * dependência entre elas (0 = não depende de outra linha nova) e, no nível, na
 * ordem do arquivo. Toda dependência de um lote já foi gravada numa instrução
 * anterior, como o gatilho do API-013 exige. Sem dependências entre as linhas,
 * são os pedaços de sempre. Os ids têm de ser distintos e sem ciclo (o
 * planCardRows garante); senão lança.
 */
export function insertBatches(rows: readonly ImportCardRow[], size: number): ImportCardRow[][] {
  if (!(size >= 1)) throw new RangeError(`insertBatches: lote de ${size}`)
  const index = new Map(rows.map((row, i): [string, number] => [row.id, i]))
  if (index.size !== rows.length) throw new Error('insertBatches: id repetido entre as linhas')
  const level = dependencyLevels(rows.map(row => [...new Set(row.depends_on.flatMap(d => index.get(d) ?? []))]))
  if (level.some(l => l < 0)) throw new Error('insertBatches: dependência em ciclo entre as linhas')
  const byLevel: ImportCardRow[][] = []
  rows.forEach((row, i) => { (byLevel[level[i]] ??= []).push(row) })
  const batches: ImportCardRow[][] = []
  for (const group of byLevel) {
    for (let i = 0; i < group.length; i += size) batches.push(group.slice(i, i + size))
  }
  return batches
}

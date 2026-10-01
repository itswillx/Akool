import type { ProjectCard, ProjectCardChecklistItem, ProjectCardPriority, ProjectColumn } from '../types'

// Fila de desenvolvimento (public.project_card_queue + RPCs cq_*). A regra vive
// no SQL; aqui ficam só o espelho da ordenação para a prévia do app, os selos
// do kanban e a formatação usada pela CLI `npm run cards`.

/**
 * `review`: a IA terminou e o card espera a validação do usuário (coluna
 * Validação). `blocked`: espera itens do usuário (coluna "Aguardando você").
 */
export type CardQueueStatus = 'queued' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled'

/**
 * Fluxo de todo card: Avaliação → Plano (aprovado pelo usuário) → Desenvolvimento.
 * `aprovado`: plano aprovado esperando a vez de ser desenvolvido (lote).
 */
export type CardQueuePhase = 'avaliacao' | 'plano' | 'aprovado' | 'desenvolvimento'

/** Linha de public.project_card_queue, lida direto pelo app (RLS). */
export interface CardQueueRow {
  id: string
  card_id: string
  position: number
  status: CardQueueStatus
  phase?: CardQueuePhase | null
}

/** Item devolvido por cq_list. */
export interface CardQueueItem extends CardQueueRow {
  source: 'app' | 'api'
  created_at: string
  started_at: string | null
  finished_at: string | null
  note: string | null
  external_id: string | null
  title: string
  priority: ProjectCardPriority
  column: string
  labels: string[]
  /** Itens da checklist do usuário ainda abertos (card aguardando você). */
  user_pending?: number
}

/** Card completo devolvido por cq_card, cq_next, cq_check e cq_complete. */
export interface ApiCard {
  id: string
  board_id: string
  external_id: string | null
  title: string
  column_id: string
  column: string
  priority: ProjectCardPriority
  labels: string[]
  completed: boolean
  description: string
  checklist: ProjectCardChecklistItem[]
  queue: { id: string; status: CardQueueStatus; phase?: CardQueuePhase | null; position: number; started_at: string | null; finished_at: string | null; note: string | null } | null
}

export const PRIORITY_RANK: Record<ProjectCardPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
export const PRIORITY_CODE: Record<ProjectCardPriority, 'P0' | 'P1' | 'P2' | 'P3'> = {
  urgent: 'P0', high: 'P1', medium: 'P2', low: 'P3',
}

/** Desempate dentro da mesma prioridade (espelha private.cq_effort_rank): S antes de M e L. */
export function effortRank(labels: readonly string[] | null | undefined): number {
  if (labels?.includes('esforço:s')) return 0
  if (labels?.includes('esforço:l')) return 2
  return 1
}

/**
 * Cards cuja última passagem pela fila terminou bloqueada: esperam ação do
 * usuário e não voltam por filtro (só recolocados por id), como no cq_enqueue.
 */
export function blockedCardIds(items: readonly Pick<CardQueueItem, 'card_id' | 'status' | 'created_at'>[]): Set<string> {
  const latest = new Map<string, Pick<CardQueueItem, 'status' | 'created_at'>>()
  for (const item of items) {
    const prev = latest.get(item.card_id)
    if (!prev || item.created_at > prev.created_at) latest.set(item.card_id, item)
  }
  return new Set([...latest].filter(([, item]) => item.status === 'blocked').map(([id]) => id))
}

const EXTERNAL_ID_RE = /^([A-Z]{2,5}-\d{3})(?=\s|$)/

export function externalIdFromTitle(title: string): string | null {
  return title.match(EXTERNAL_ID_RE)?.[1] ?? null
}

export interface QueueFilter {
  cardIds: string[]
  columnIds: string[]
  priorities: ProjectCardPriority[]
  labels: string[]
}

export function emptyQueueFilter(): QueueFilter {
  return { cardIds: [], columnIds: [], priorities: [], labels: [] }
}

export function isEmptyQueueFilter(f: QueueFilter): boolean {
  return f.cardIds.length === 0 && f.columnIds.length === 0 && f.priorities.length === 0 && f.labels.length === 0
}

/**
 * Mesma seleção e ordem de public.cq_enqueue: cards explícitos OU cards que
 * batem com todos os filtros informados; só abertos e fora da fila ativa;
 * ordem por prioridade, coluna e posição no quadro.
 */
export function previewQueueOrder(
  cards: ProjectCard[],
  columns: Pick<ProjectColumn, 'id' | 'sort_order'>[],
  filter: QueueFilter,
  activeCardIds: ReadonlySet<string>,
  blockedIds: ReadonlySet<string> = new Set(),
): ProjectCard[] {
  if (isEmptyQueueFilter(filter)) return []
  const colOrder = new Map(columns.map(c => [c.id, c.sort_order]))
  const filtered = filter.columnIds.length > 0 || filter.priorities.length > 0 || filter.labels.length > 0

  return cards
    .filter(c => !c.completed && !activeCardIds.has(c.id))
    .filter(c =>
      filter.cardIds.includes(c.id) ||
      (filtered && !blockedIds.has(c.id) &&
        (filter.columnIds.length === 0 || filter.columnIds.includes(c.column_id)) &&
        (filter.priorities.length === 0 || filter.priorities.includes(c.priority)) &&
        (filter.labels.length === 0 || (c.labels ?? []).some(l => filter.labels.includes(l)))),
    )
    .sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      effortRank(a.labels) - effortRank(b.labels) ||
      (colOrder.get(a.column_id) ?? 0) - (colOrder.get(b.column_id) ?? 0) ||
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at),
    )
}

export type QueueBadge =
  | { kind: 'working'; phase: CardQueuePhase | null }
  | { kind: 'queued'; rank: number }
  | { kind: 'review' }
  | { kind: 'waiting' }

/**
 * Selo por card: fase do card em andamento, validação pendente, aguardando o
 * usuário ou a vez na fila (1 = próximo).
 */
export function queueBadges(rows: CardQueueRow[]): Map<string, QueueBadge> {
  const badges = new Map<string, QueueBadge>()
  rows.filter(r => r.status === 'in_progress').forEach(r => badges.set(r.card_id, { kind: 'working', phase: r.phase ?? null }))
  rows.filter(r => r.status === 'review').forEach(r => badges.set(r.card_id, { kind: 'review' }))
  rows.filter(r => r.status === 'blocked').forEach(r => badges.set(r.card_id, { kind: 'waiting' }))
  rows
    .filter(r => r.status === 'queued')
    .sort((a, b) => a.position - b.position)
    .forEach((r, i) => badges.set(r.card_id, { kind: 'queued', rank: i + 1 }))
  return badges
}

// ─── Formatação para a CLI ───────────────────────────────────────────────────

const STATUS_LABEL: Record<CardQueueStatus, string> = {
  queued: 'na fila',
  in_progress: 'em andamento',
  review: 'em validação',
  done: 'concluído',
  blocked: 'aguardando você',
  cancelled: 'cancelado',
}

const PHASE_LABEL: Record<CardQueuePhase, string> = {
  avaliacao: 'avaliação',
  plano: 'plano (aguardando aprovação)',
  aprovado: 'plano aprovado',
  desenvolvimento: 'desenvolvimento',
}

export function formatCardMarkdown(card: ApiCard): string {
  const lines = [
    `# ${card.title}`,
    '',
    `- **Card:** ${card.external_id ?? card.id} (\`${card.id}\`)`,
    `- **Coluna:** ${card.column} · **Prioridade:** ${PRIORITY_CODE[card.priority]} (${card.priority})${card.completed ? ' · **concluído**' : ''}`,
  ]
  if (card.labels.length > 0) lines.push(`- **Labels:** ${card.labels.join(', ')}`)
  if (card.queue) {
    const phase = card.queue.status === 'in_progress' && card.queue.phase ? ` · fase: ${PHASE_LABEL[card.queue.phase]}` : ''
    lines.push(`- **Fila:** ${STATUS_LABEL[card.queue.status]}${phase}${card.queue.started_at ? ` desde ${card.queue.started_at}` : ''}`)
  }
  if (card.description.trim()) lines.push('', card.description.trim())
  if (card.checklist.length > 0) {
    lines.push('', '## Subtarefas', '')
    card.checklist.forEach((item, i) => {
      lines.push(`${i + 1}. [${item.completed ? 'x' : ' '}] ${item.text}${item.owner === 'user' ? ' _(você)_' : ''}`)
    })
  }
  return lines.join('\n')
}

export function formatQueueLines(items: CardQueueItem[]): string[] {
  if (items.length === 0) return ['Fila vazia.']
  let rank = 0
  return items.map(item => {
    const pos = item.status === 'queued' ? `#${++rank}` : item.status === 'in_progress' ? '▶' : '·'
    const note = item.note && (item.status === 'blocked' || item.status === 'review' || item.status === 'done') ? ` — ${item.note.split('\n')[0]}` : ''
    const phase = item.status === 'in_progress' && item.phase ? ` · ${PHASE_LABEL[item.phase]}` : ''
    const pending = item.status === 'blocked' && item.user_pending ? ` · ${item.user_pending} item(ns) seu(s)` : ''
    return `${pos.padEnd(4)} ${STATUS_LABEL[item.status].padEnd(15)} ${PRIORITY_CODE[item.priority]}  ${item.title}  [${item.column}]${phase}${pending}${note}`
  })
}

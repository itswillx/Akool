import { addDays, diffDays, isOverdue, mondayOf } from './isoDate.ts'
import { PROJECT_PRIORITIES, type ProjectCardPriority } from './projectTypes.ts'

// Pure aggregations for the Projects "Overview" dashboard. UI-agnostic: they
// return counts keyed by id/priority/bucket; the view maps colors, labels and
// i18n. API-027: moram em _domain (a API usa nas estatísticas do quadro), e
// `today` é obrigatório: no servidor não há relógio do aparelho. O app passa
// pelos wrappers de src/lib/projectStats.ts, que preenchem o dia de hoje.

/** O que as estatísticas leem de um card (ProjectCard de src/types satisfaz). */
export interface StatsCard {
  column_id: string
  priority: ProjectCardPriority
  due_date: string | null
  completed: boolean
  assignee_user_id: string | null
  created_at: string | null
}

// QA-004: a ordem vive em projectTypes.ts; o nome antigo continua para quem importa daqui.
export const PRIORITY_ORDER: readonly ProjectCardPriority[] = PROJECT_PRIORITIES

// Sunday (end) of the week containing `today`.
function weekEndISO(today: string): string {
  return addDays(mondayOf(today), 6)
}

// ─── summary KPIs ─────────────────────────────────────────────────────────────

export interface OverviewSummary {
  total: number
  completed: number
  open: number
  completionPct: number
  overdue: number
  dueThisWeekOpen: number
  unassigned: number
}

export function overviewSummary(cards: readonly StatsCard[], today: string): OverviewSummary {
  const total = cards.length
  const completed = cards.filter(c => c.completed).length
  const weekEnd = weekEndISO(today)
  const overdue = cards.filter(c => isOverdue(c, today)).length
  // Open cards due from today through the end of this week.
  const dueThisWeekOpen = cards.filter(c => !c.completed && c.due_date && c.due_date >= today && c.due_date <= weekEnd).length
  const unassigned = cards.filter(c => !c.assignee_user_id).length
  return {
    total,
    completed,
    open: total - completed,
    completionPct: total ? Math.round((completed / total) * 100) : 0,
    overdue,
    dueThisWeekOpen,
    unassigned,
  }
}

// ─── breakdowns ───────────────────────────────────────────────────────────────

export function countByColumnId(cards: readonly StatsCard[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cards) out[c.column_id] = (out[c.column_id] ?? 0) + 1
  return out
}

export function countByPriority(cards: readonly StatsCard[]): Record<ProjectCardPriority, number> {
  const out: Record<ProjectCardPriority, number> = { urgent: 0, high: 0, medium: 0, low: 0 }
  for (const c of cards) out[c.priority] = (out[c.priority] ?? 0) + 1
  return out
}

// Counts per assignee (null = unassigned), sorted by count desc.
export function countByAssignee(cards: readonly StatsCard[]): Array<{ id: string | null; count: number }> {
  const map = new Map<string | null, number>()
  for (const c of cards) {
    const key = c.assignee_user_id ?? null
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
}

export interface DueBuckets {
  overdue: number
  today: number
  week: number
  later: number
  none: number
}

// Distribution of OPEN (not completed) cards by their deadline. Completed cards
// are excluded since their deadline is no longer pending.
export function dueBuckets(cards: readonly StatsCard[], today: string): DueBuckets {
  const weekEnd = weekEndISO(today)
  const out: DueBuckets = { overdue: 0, today: 0, week: 0, later: 0, none: 0 }
  for (const c of cards) {
    if (c.completed) continue
    const d = c.due_date
    if (!d) out.none++
    else if (d < today) out.overdue++
    else if (d === today) out.today++
    else if (d <= weekEnd) out.week++
    else out.later++
  }
  return out
}

/**
 * Cards created per week over the last `weeks` weeks (oldest → newest).
 *
 * API-027: `dayOf` dá o dia de calendário ('YYYY-MM-DD') do `created_at` no
 * fuso de quem vê. O banco devolve o instante em UTC, e o dia UTC vira às 21h
 * em Brasília: o card criado no domingo à noite caía na semana seguinte, ou
 * sumia do gráfico se ela ainda não existia. O app passa o dia do aparelho
 * (localDateKey); a API, `(created_at at time zone $tz)::date` do SQL. O índice
 * da semana sai de diffDays (UTC), sem a hora a menos do início do horário de
 * verão, que jogava o card da segunda-feira na semana anterior.
 */
export function createdPerWeek(
  cards: readonly StatsCard[],
  weeks: number,
  today: string,
  dayOf: (createdAt: string) => string,
): Array<{ weekStart: string; count: number }> {
  const currentMonday = mondayOf(today)
  const buckets: Array<{ weekStart: string; count: number }> = []
  for (let i = weeks - 1; i >= 0; i--) buckets.push({ weekStart: addDays(currentMonday, -7 * i), count: 0 })
  const firstStart = buckets[0].weekStart
  const lastEnd = addDays(buckets[buckets.length - 1].weekStart, 6)
  for (const c of cards) {
    if (!c.created_at) continue
    const cd = dayOf(c.created_at)
    if (cd < firstStart || cd > lastEnd) continue
    // Bucket index by whole weeks since the first Monday.
    const idx = Math.floor(diffDays(firstStart, cd) / 7)
    if (idx >= 0 && idx < buckets.length) buckets[idx].count++
  }
  return buckets
}

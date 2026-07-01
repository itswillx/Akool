import type { ProjectCard, ProjectCardPriority } from '../types'
import { todayStr, isOverdue } from './projectCardFilters'

// Pure aggregations for the Projects "Overview" dashboard. UI-agnostic: they
// return counts keyed by id/priority/bucket; the view maps colors, labels and
// i18n. Kept here (not in the component) so they can be unit-tested.

export const PRIORITY_ORDER: ProjectCardPriority[] = ['urgent', 'high', 'medium', 'low']

// ─── date helpers (ISO yyyy-mm-dd math, local-time, no TZ surprises) ──────────

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return todayStr(d)
}

// Monday (start) of the week containing `iso`.
function mondayISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const day = d.getDay() // 0=Sun..6=Sat
  return addDaysISO(iso, day === 0 ? -6 : 1 - day)
}

// Sunday (end) of the week containing `today`.
function weekEndISO(today: string): string {
  return addDaysISO(mondayISO(today), 6)
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

export function overviewSummary(cards: ProjectCard[], today = todayStr()): OverviewSummary {
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

export function countByColumnId(cards: ProjectCard[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cards) out[c.column_id] = (out[c.column_id] ?? 0) + 1
  return out
}

export function countByPriority(cards: ProjectCard[]): Record<ProjectCardPriority, number> {
  const out: Record<ProjectCardPriority, number> = { urgent: 0, high: 0, medium: 0, low: 0 }
  for (const c of cards) out[c.priority] = (out[c.priority] ?? 0) + 1
  return out
}

// Counts per assignee (null = unassigned), sorted by count desc.
export function countByAssignee(cards: ProjectCard[]): Array<{ id: string | null; count: number }> {
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
export function dueBuckets(cards: ProjectCard[], today = todayStr()): DueBuckets {
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

// Cards created per week over the last `weeks` weeks (oldest → newest).
export function createdPerWeek(cards: ProjectCard[], weeks = 8, today = todayStr()): Array<{ weekStart: string; count: number }> {
  const currentMonday = mondayISO(today)
  const buckets: Array<{ weekStart: string; count: number }> = []
  for (let i = weeks - 1; i >= 0; i--) buckets.push({ weekStart: addDaysISO(currentMonday, -7 * i), count: 0 })
  const firstStart = buckets[0].weekStart
  const lastEnd = addDaysISO(buckets[buckets.length - 1].weekStart, 6)
  for (const c of cards) {
    if (!c.created_at) continue
    const cd = c.created_at.slice(0, 10)
    if (cd < firstStart || cd > lastEnd) continue
    // Bucket index by whole weeks since the first Monday.
    const idx = Math.floor((new Date(`${cd}T00:00:00`).getTime() - new Date(`${firstStart}T00:00:00`).getTime()) / (7 * 86400000))
    if (idx >= 0 && idx < buckets.length) buckets[idx].count++
  }
  return buckets
}

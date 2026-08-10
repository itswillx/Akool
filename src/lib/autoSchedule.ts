import type { ProjectCard, ProjectColumn } from '../types'
import { addDays, diffDays } from './ganttLayout'
import { todayStr } from './projectCardFilters'
import { PRIORITY_ORDER } from './projectStats'

// Auto-scheduler for the "Gerar cronograma" action. Two modes, chosen per
// call by whether a targetDeadline is given:
//
// - No targetDeadline ("fill gaps"): only fills in start_date/due_date for
//   cards that have no due_date yet, chaining them (via depends_on) in
//   priority order within each column. Cards that already have a due_date
//   are never modified, but still anchor the column's cursor so newly
//   -scheduled cards start after them. This is the safe default — it never
//   overwrites a date you (or a previous run) already set.
//
// - With targetDeadline ("replan to deadline"): every open (non-completed)
//   card in the column is rescheduled from scratch to fit the deadline,
//   INCLUDING cards that already have a due_date — the whole point of
//   giving a deadline is to replan around it. Durations are always allocated
//   proportionally to each card's weight (estimated_days) across the whole
//   window from today to the deadline, so the column's last card always
//   lands exactly on the deadline — stretching cards out when there's slack,
//   compressing them when there isn't. If even 1 day per card doesn't fit
//   before the deadline, every card still gets at least 1 day and the
//   column runs past the deadline — reported via `overflowDays`.
//
// Either way, columns are scheduled independently (categories run in
// parallel) and completed cards are excluded entirely.

export const DEFAULT_ESTIMATED_DAYS = 1

export interface SchedulePatch {
  cardId: string
  start_date: string
  due_date: string
  depends_on: string[]
}

export interface AutoScheduleResult {
  patches: SchedulePatch[]
  overflowDays: number
}

/** Cumulative proportional allocation: boundaries[i] = day offset (1-based) where item i ends. */
function allocateBoundaries(weights: number[], totalDays: number): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const boundaries: number[] = []
  let prev = 0
  let cum = 0
  for (const w of weights) {
    cum += w
    let b = Math.round((totalDays * cum) / totalWeight)
    if (b < prev + 1) b = prev + 1
    boundaries.push(b)
    prev = b
  }
  return boundaries
}

function mergeDependsOn(card: ProjectCard, predecessorId: string | null): string[] {
  return predecessorId
    ? Array.from(new Set([...(card.depends_on ?? []), predecessorId]))
    : (card.depends_on ?? [])
}

export function buildAutoSchedule(
  cards: ProjectCard[],
  columns: ProjectColumn[],
  today = todayStr(),
  targetDeadline?: string | null,
): AutoScheduleResult {
  const patches: SchedulePatch[] = []
  let overflowDays = 0

  const byColumn = new Map<string, ProjectCard[]>()
  for (const c of cards) {
    if (c.completed) continue
    const arr = byColumn.get(c.column_id) ?? []
    arr.push(c)
    byColumn.set(c.column_id, arr)
  }

  for (const column of columns) {
    const columnCards = byColumn.get(column.id) ?? []
    if (columnCards.length === 0) continue

    const ordered = [...columnCards].sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority)
      const pb = PRIORITY_ORDER.indexOf(b.priority)
      return pa !== pb ? pa - pb : (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })

    if (targetDeadline) {
      // Replan mode: every open card in the column is rescheduled, even ones
      // that already have a due_date — there are no "fixed" cards here.
      // Always allocate proportionally across the full window so the last
      // card lands exactly on the deadline, whether that means stretching
      // (plenty of slack) or compressing (doesn't fit at raw durations).
      const weights = ordered.map(c => Math.max(1, c.estimated_days ?? DEFAULT_ESTIMATED_DAYS))
      const availableDays = diffDays(today, targetDeadline) + 1
      const effectiveAvailable = Math.max(availableDays, ordered.length)
      const boundaries = allocateBoundaries(weights, effectiveAvailable)
      if (effectiveAvailable > availableDays) {
        overflowDays = Math.max(overflowDays, effectiveAvailable - availableDays)
      }

      let lastCardId: string | null = null
      let prevBoundary = 0
      ordered.forEach((card, i) => {
        const start = addDays(today, prevBoundary)
        const due = addDays(start, boundaries[i] - prevBoundary - 1)
        const dependsOn = mergeDependsOn(card, lastCardId)

        patches.push({ cardId: card.id, start_date: start, due_date: due, depends_on: dependsOn })

        prevBoundary = boundaries[i]
        lastCardId = card.id
      })
      continue
    }

    // Fill-gaps mode (no deadline): only schedule cards without a due_date;
    // cards with one are left untouched but still anchor the cursor.
    let cursor = today
    let lastCardId: string | null = null

    for (const card of ordered) {
      if (card.due_date) {
        if (diffDays(cursor, card.due_date) >= 0) cursor = addDays(card.due_date, 1)
        lastCardId = card.id
        continue
      }

      const duration = Math.max(1, card.estimated_days ?? DEFAULT_ESTIMATED_DAYS)
      const start = cursor
      const due = addDays(start, duration - 1)
      const dependsOn = mergeDependsOn(card, lastCardId)

      patches.push({ cardId: card.id, start_date: start, due_date: due, depends_on: dependsOn })
      cursor = addDays(due, 1)
      lastCardId = card.id
    }
  }

  return { patches, overflowDays }
}

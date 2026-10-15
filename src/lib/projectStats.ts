import {
  createdPerWeek as createdPerWeekOn,
  dueBuckets as dueBucketsOn,
  overviewSummary as overviewSummaryOn,
  type DueBuckets,
  type OverviewSummary,
  type StatsCard,
} from '../../supabase/functions/_domain/projectStats'
import { localDateKey } from './localDate'
import { todayStr } from './projectCardFilters'

// Pure aggregations for the Projects "Overview" dashboard.
// API-027: moram em supabase/functions/_domain/projectStats.ts, onde `today` é
// obrigatório. Aqui ficam os wrappers do app, com o dia de hoje e o dia de
// criação no fuso do aparelho (REL-007).

export {
  countByAssignee, countByColumnId, countByPriority, PRIORITY_ORDER,
} from '../../supabase/functions/_domain/projectStats'
export type { DueBuckets, OverviewSummary, StatsCard }

/** Dia de calendário do `created_at` (instante em UTC do banco) no fuso do aparelho. */
export const createdDayLocal = (createdAt: string): string => localDateKey(new Date(createdAt))

export function overviewSummary(cards: readonly StatsCard[], today = todayStr()): OverviewSummary {
  return overviewSummaryOn(cards, today)
}

export function dueBuckets(cards: readonly StatsCard[], today = todayStr()): DueBuckets {
  return dueBucketsOn(cards, today)
}

export function createdPerWeek(
  cards: readonly StatsCard[],
  weeks = 8,
  today = todayStr(),
  dayOf: (createdAt: string) => string = createdDayLocal,
): Array<{ weekStart: string; count: number }> {
  return createdPerWeekOn(cards, weeks, today, dayOf)
}

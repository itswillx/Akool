import {
  buildAutoSchedule as buildAutoScheduleOn,
  type AutoScheduleResult,
  type ScheduleCard,
} from '../../supabase/functions/_domain/autoSchedule'
import { todayStr } from './projectCardFilters'

// Auto-scheduler for the "Gerar cronograma" action.
// API-027: o algoritmo mora em supabase/functions/_domain/autoSchedule.ts, onde
// `today` é obrigatório. Aqui o padrão é o dia de hoje do aparelho (REL-007).

export { DEFAULT_ESTIMATED_DAYS, type AutoScheduleResult, type SchedulePatch, type ScheduleCard } from '../../supabase/functions/_domain/autoSchedule'

export function buildAutoSchedule(
  cards: readonly ScheduleCard[],
  columns: readonly { id: string }[],
  today = todayStr(),
  targetDeadline?: string | null,
): AutoScheduleResult {
  return buildAutoScheduleOn(cards, columns, today, targetDeadline)
}

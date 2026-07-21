import type { StudyCard } from '../types'
import { cardProgress, localDateISO } from './studyProgress'

// Schedule math for the study module. Everything operates on local
// 'YYYY-MM-DD' strings via the (y, m-1, d) Date constructor — never
// new Date('YYYY-MM-DD'), whose UTC parsing shifts the day in UTC-3.

export type DurationUnit = 'days' | 'weeks' | 'months'

function parts(dateISO: string): [number, number, number] {
  const [y, m, d] = dateISO.split('-').map(Number)
  return [y, m, d]
}

function addDays(dateISO: string, days: number): string {
  const [y, m, d] = parts(dateISO)
  return localDateISO(new Date(y, m - 1, d + days))
}

// today + qty units. Months clamp to the target month's last day
// (Jan 31 + 1 month → Feb 28/29, never Mar 3). Invalid/non-positive qty
// returns the input unchanged (total function; callers also guard).
export function addDuration(todayISO: string, qty: number, unit: DurationUnit): string {
  const n = Math.floor(qty)
  if (!Number.isFinite(n) || n <= 0) return todayISO
  if (unit === 'days') return addDays(todayISO, n)
  if (unit === 'weeks') return addDays(todayISO, n * 7)
  const [y, m, d] = parts(todayISO)
  const monthIndex = (m - 1) + n
  const lastDay = new Date(y, monthIndex + 1, 0).getDate()
  return localDateISO(new Date(y, monthIndex, Math.min(d, lastDay)))
}

// Evenly spaced due dates from start to target for `count` cards, the LAST
// one landing exactly on the target. With more cards than days, duplicate
// dates are expected. Target on/before start → every card due on the target.
export function distributeDueDates(startISO: string, targetISO: string, count: number): string[] {
  if (count <= 0) return []
  if (targetISO <= startISO) return Array<string>(count).fill(targetISO)
  const [sy, sm, sd] = parts(startISO)
  const [ty, tm, td] = parts(targetISO)
  const totalDays = Math.round(
    (new Date(ty, tm - 1, td).getTime() - new Date(sy, sm - 1, sd).getTime()) / 86_400_000,
  )
  const dates: string[] = []
  for (let i = 1; i <= count; i++) {
    dates.push(addDays(startISO, Math.round((i * totalDays) / count)))
  }
  return dates
}

// A card is overdue when its due date passed and the card is not complete.
// "Complete" here requires at least one checkpoint, all done — an empty
// past-due card still demands attention. NOTE: intentionally different from
// studyProgress.isCardComplete (roadmap progression), where an empty card
// counts as complete so it never blocks the trail.
export function isCardOverdue(
  card: Pick<StudyCard, 'due_date' | 'checkpoints'>,
  todayISO: string = localDateISO(),
): boolean {
  if (!card.due_date || card.due_date >= todayISO) return false
  const progress = cardProgress(card)
  return !(progress.total > 0 && progress.done === progress.total)
}

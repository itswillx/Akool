import type { StudyCard, StudyLog, StudyTopic, StudyTopicStatus } from '../types'
import { isQuizCorrect, isQuizPassed } from './studyQuiz'

// The slice of a card that progress math needs — quiz answers count toward
// the bar alongside checkpoints.
type ProgressCard = Pick<StudyCard, 'checkpoints' | 'quiz'>

export interface StudyProgress {
  done: number
  total: number
  pct: number
}

function progressOf(cards: ProgressCard[]): StudyProgress {
  let done = 0
  let total = 0
  for (const card of cards) {
    total += card.checkpoints.length + card.quiz.length
    for (const item of card.checkpoints) if (item.completed) done++
    for (const question of card.quiz) if (isQuizCorrect(question)) done++
  }
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export function cardProgress(card: ProgressCard): StudyProgress {
  return progressOf([card])
}

export function topicProgress(cards: ProgressCard[]): StudyProgress {
  return progressOf(cards)
}

// ─── Roadmap step progression ────────────────────────────────────────────────

export type StudyStepState = 'completed' | 'current' | 'locked'

// A card with no checkpoints and no quiz counts as COMPLETE for roadmap
// progression (nothing actionable inside it must not block the trail
// forever). With a quiz, completion also requires passing it (all questions
// answered, >= QUIZ_PASS_PCT correct) — so a step can show as completed while
// its progress bar sits below 100% (passed with 70-99%; "retry wrong ones"
// closes the gap). NOTE: intentionally different from
// studySchedule.isCardOverdue, which treats an empty past-due card as
// incomplete — overdue is an attention signal, progression is navigation.
export function isCardComplete(card: ProgressCard): boolean {
  return card.checkpoints.every(p => p.completed) && isQuizPassed(card.quiz)
}

// Index of the first non-complete card ("current step"); -1 when every card
// is complete or there are no cards.
export function currentStepIndex(cards: ProgressCard[]): number {
  return cards.findIndex(card => !isCardComplete(card))
}

// Completed wins even after the current index, so out-of-order completion
// still shows green; everything else past the current step is locked.
export function stepState(index: number, cards: ProgressCard[]): StudyStepState {
  if (isCardComplete(cards[index])) return 'completed'
  return index === currentStepIndex(cards) ? 'current' : 'locked'
}

// Local calendar date as 'YYYY-MM-DD'. Target dates are compared as plain
// strings against this — never via new Date('YYYY-MM-DD'), which parses as
// UTC midnight and shifts the day in UTC-3.
export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isTopicOverdue(
  topic: Pick<StudyTopic, 'target_date' | 'status'>,
  todayISO: string = localDateISO(),
): boolean {
  return !!topic.target_date && topic.status !== 'completed' && topic.target_date < todayISO
}

// Sort rank used by the topics list and planning views: active studies first,
// then the queue, paused, and finally completed ones.
export const STATUS_RANK: Record<StudyTopicStatus, number> = {
  studying: 0,
  planned: 1,
  paused: 2,
  completed: 3,
}

export function sortTopics(topics: StudyTopic[]): StudyTopic[] {
  return [...topics].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updated_at.localeCompare(a.updated_at),
  )
}

export function countByStatus(topics: Pick<StudyTopic, 'status'>[]): Record<StudyTopicStatus, number> {
  const counts: Record<StudyTopicStatus, number> = { planned: 0, studying: 0, paused: 0, completed: 0 }
  for (const t of topics) counts[t.status]++
  return counts
}

export interface AreaProgress {
  area: string
  topics: number
  done: number
  total: number
  pct: number
}

export function progressByArea(
  topics: Pick<StudyTopic, 'id' | 'area'>[],
  cardsByTopic: Record<string, ProgressCard[]>,
): AreaProgress[] {
  const map = new Map<string, { topics: number; done: number; total: number }>()
  for (const topic of topics) {
    const area = topic.area.trim()
    const p = topicProgress(cardsByTopic[topic.id] ?? [])
    const cur = map.get(area) ?? { topics: 0, done: 0, total: 0 }
    cur.topics += 1
    cur.done += p.done
    cur.total += p.total
    map.set(area, cur)
  }
  return [...map.entries()]
    .map(([area, v]) => ({
      area,
      topics: v.topics,
      done: v.done,
      total: v.total,
      pct: v.total === 0 ? 0 : Math.round((v.done / v.total) * 100),
    }))
    .sort((a, b) => b.total - a.total || a.area.localeCompare(b.area))
}

export interface DayActivity {
  date: string
  count: number
}

// Diary entries per local calendar day for the trailing `days` window
// (oldest first, today last). Missing days are filled with zero.
export function logsPerDay(
  logs: Pick<StudyLog, 'created_at'>[],
  days: number,
  todayISO: string = localDateISO(),
): DayActivity[] {
  const counts = new Map<string, number>()
  for (const log of logs) {
    const key = localDateISO(new Date(log.created_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const [y, m, d] = todayISO.split('-').map(Number)
  const out: DayActivity[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = localDateISO(new Date(y, m - 1, d - i))
    out.push({ date, count: counts.get(date) ?? 0 })
  }
  return out
}

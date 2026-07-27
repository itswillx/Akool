import { describe, expect, it } from 'vitest'
import {
  cardProgress,
  countByStatus,
  currentStepIndex,
  isCardComplete,
  isTopicOverdue,
  localDateISO,
  logsPerDay,
  progressByArea,
  sortTopics,
  stepState,
  topicProgress,
} from './studyProgress'
import type { StudyCheckpoint, StudyQuizBooleanQuestion, StudyTopic } from '../types'

function cp(completed: boolean): StudyCheckpoint {
  return { id: crypto.randomUUID(), text: 'x', completed }
}

// Legacy-shaped boolean question (no `kind`), answered right or wrong via `ok`.
function qz(ok: boolean | null): StudyQuizBooleanQuestion {
  return {
    id: crypto.randomUUID(),
    statement: 'x',
    answer: 'certo',
    userAnswer: ok === null ? null : ok ? 'certo' : 'errado',
  }
}

describe('cardProgress / topicProgress', () => {
  it('returns 0% for empty checkpoint lists', () => {
    expect(cardProgress({ checkpoints: [], quiz: [] })).toEqual({ done: 0, total: 0, pct: 0 })
    expect(topicProgress([])).toEqual({ done: 0, total: 0, pct: 0 })
  })

  it('rounds percentages (1/3 → 33)', () => {
    const p = cardProgress({ checkpoints: [cp(true), cp(false), cp(false)], quiz: [] })
    expect(p).toEqual({ done: 1, total: 3, pct: 33 })
  })

  it('counts correct quiz answers toward the bar alongside checkpoints', () => {
    const p = cardProgress({ checkpoints: [cp(true)], quiz: [qz(true), qz(false), qz(null)] })
    expect(p).toEqual({ done: 2, total: 4, pct: 50 })
  })

  it('aggregates across cards', () => {
    const p = topicProgress([
      { checkpoints: [cp(true), cp(true)], quiz: [] },
      { checkpoints: [cp(false), cp(true)], quiz: [qz(true)] },
    ])
    expect(p).toEqual({ done: 4, total: 5, pct: 80 })
  })
})

describe('roadmap step progression', () => {
  const done = { checkpoints: [cp(true), cp(true)], quiz: [] }
  const open = { checkpoints: [cp(true), cp(false)], quiz: [] }
  const empty = { checkpoints: [], quiz: [] }

  it('treats empty-checkpoint cards as complete (never blocks the trail)', () => {
    expect(isCardComplete(empty)).toBe(true)
    expect(isCardComplete(done)).toBe(true)
    expect(isCardComplete(open)).toBe(false)
  })

  it('requires a passed quiz (all answered, >= 70% right) to complete a card', () => {
    const cps = [cp(true)]
    // Unanswered question → incomplete even with checkpoints done.
    expect(isCardComplete({ checkpoints: cps, quiz: [qz(true), qz(null)] })).toBe(false)
    // 2/3 = 66% → below the bar.
    expect(isCardComplete({ checkpoints: cps, quiz: [qz(true), qz(true), qz(false)] })).toBe(false)
    // 3/3 → passed.
    expect(isCardComplete({ checkpoints: cps, quiz: [qz(true), qz(true), qz(true)] })).toBe(true)
    // No quiz → checkpoints alone decide (legacy/manual cards).
    expect(isCardComplete({ checkpoints: cps, quiz: [] })).toBe(true)
  })

  it('finds the first non-complete card as the current step', () => {
    expect(currentStepIndex([done, open, open])).toBe(1)
    expect(currentStepIndex([done, empty, done])).toBe(-1)
    expect(currentStepIndex([])).toBe(-1)
  })

  it('derives step states with completed winning after the current index', () => {
    const cards = [done, open, done, open]
    expect(stepState(0, cards)).toBe('completed')
    expect(stepState(1, cards)).toBe('current')
    expect(stepState(2, cards)).toBe('completed')
    expect(stepState(3, cards)).toBe('locked')
  })
})

describe('isTopicOverdue', () => {
  it('is overdue only before completion and strictly past the target', () => {
    expect(isTopicOverdue({ target_date: '2026-07-19', status: 'studying' }, '2026-07-20')).toBe(true)
    expect(isTopicOverdue({ target_date: '2026-07-20', status: 'studying' }, '2026-07-20')).toBe(false)
    expect(isTopicOverdue({ target_date: '2026-07-19', status: 'completed' }, '2026-07-20')).toBe(false)
    expect(isTopicOverdue({ target_date: null, status: 'studying' }, '2026-07-20')).toBe(false)
  })

  it('localDateISO formats local dates as YYYY-MM-DD', () => {
    expect(localDateISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

function topic(partial: Partial<StudyTopic>): StudyTopic {
  return {
    id: partial.id ?? crypto.randomUUID(),
    user_id: 'u',
    title: 't',
    area: '',
    level: '',
    objective: '',
    status: 'planned',
    target_date: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...partial,
  }
}

describe('sortTopics / countByStatus', () => {
  it('orders studying < planned < paused < completed, then recent first', () => {
    const list = [
      topic({ id: 'done', status: 'completed' }),
      topic({ id: 'old-studying', status: 'studying', updated_at: '2026-07-02T00:00:00Z' }),
      topic({ id: 'paused', status: 'paused' }),
      topic({ id: 'new-studying', status: 'studying', updated_at: '2026-07-10T00:00:00Z' }),
      topic({ id: 'queued', status: 'planned' }),
    ]
    expect(sortTopics(list).map(t => t.id)).toEqual(['new-studying', 'old-studying', 'queued', 'paused', 'done'])
  })

  it('counts topics by status', () => {
    const counts = countByStatus([
      topic({ status: 'studying' }),
      topic({ status: 'studying' }),
      topic({ status: 'completed' }),
    ])
    expect(counts).toEqual({ planned: 0, studying: 2, paused: 0, completed: 1 })
  })
})

describe('progressByArea', () => {
  it('groups checkpoint progress by trimmed area', () => {
    const a = topic({ id: 'a', area: 'Frontend' })
    const b = topic({ id: 'b', area: ' Frontend ' })
    const c = topic({ id: 'c', area: '' })
    const rows = progressByArea([a, b, c], {
      a: [{ checkpoints: [cp(true), cp(false)], quiz: [] }],
      b: [{ checkpoints: [cp(true)], quiz: [] }],
      c: [{ checkpoints: [cp(false)], quiz: [] }],
    })
    expect(rows).toHaveLength(2)
    const frontend = rows.find(r => r.area === 'Frontend')
    expect(frontend).toEqual({ area: 'Frontend', topics: 2, done: 2, total: 3, pct: 67 })
    expect(rows.find(r => r.area === '')).toEqual({ area: '', topics: 1, done: 0, total: 1, pct: 0 })
  })
})

describe('logsPerDay', () => {
  it('fills the trailing window with zeroes and counts by local day', () => {
    const days = logsPerDay(
      [
        { created_at: new Date(2026, 6, 20, 9, 0, 0).toISOString() },
        { created_at: new Date(2026, 6, 20, 22, 0, 0).toISOString() },
        { created_at: new Date(2026, 6, 18, 12, 0, 0).toISOString() },
      ],
      3,
      '2026-07-20',
    )
    expect(days).toEqual([
      { date: '2026-07-18', count: 1 },
      { date: '2026-07-19', count: 0 },
      { date: '2026-07-20', count: 2 },
    ])
  })
})

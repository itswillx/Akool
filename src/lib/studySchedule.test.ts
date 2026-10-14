import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import harness from '../../supabase/checks/api024-study-rpcs.sql?raw'
import migration024 from '../../supabase/migrations/20261011120000_api024_study_rpcs.sql?raw'
import { addDuration, distributeDueDates, isCardOverdue } from './studySchedule'
import type { StudyCheckpoint } from '../types'

function cp(completed: boolean): StudyCheckpoint {
  return { id: crypto.randomUUID(), text: 'x', completed }
}

describe('addDuration', () => {
  it('adds days with month rollover', () => {
    expect(addDuration('2026-07-20', 10, 'days')).toBe('2026-07-30')
    expect(addDuration('2026-07-25', 10, 'days')).toBe('2026-08-04')
  })

  it('adds weeks', () => {
    expect(addDuration('2026-07-20', 4, 'weeks')).toBe('2026-08-17')
  })

  it('adds months keeping the day when it fits', () => {
    expect(addDuration('2026-07-20', 1, 'months')).toBe('2026-08-20')
  })

  it('clamps to the last day of shorter target months', () => {
    expect(addDuration('2026-01-31', 1, 'months')).toBe('2026-02-28')
    expect(addDuration('2024-01-31', 1, 'months')).toBe('2024-02-29')
    expect(addDuration('2026-08-31', 1, 'months')).toBe('2026-09-30')
  })

  it('rolls over the year for month additions', () => {
    expect(addDuration('2026-11-15', 3, 'months')).toBe('2027-02-15')
  })

  it('returns the input for zero, negative or NaN quantities', () => {
    expect(addDuration('2026-07-20', 0, 'days')).toBe('2026-07-20')
    expect(addDuration('2026-07-20', -2, 'weeks')).toBe('2026-07-20')
    expect(addDuration('2026-07-20', NaN, 'months')).toBe('2026-07-20')
  })
})

describe('distributeDueDates', () => {
  it('spaces dates evenly with the last card on the target', () => {
    expect(distributeDueDates('2026-07-20', '2026-08-17', 4)).toEqual([
      '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17',
    ])
  })

  it('rounds intermediate offsets and always ends on the target', () => {
    expect(distributeDueDates('2026-07-20', '2026-07-30', 3)).toEqual([
      '2026-07-23', '2026-07-27', '2026-07-30',
    ])
  })

  it('handles count 1 and count 0', () => {
    expect(distributeDueDates('2026-07-20', '2026-08-17', 1)).toEqual(['2026-08-17'])
    expect(distributeDueDates('2026-07-20', '2026-08-17', 0)).toEqual([])
  })

  it('puts every card on the target when it is not after the start', () => {
    expect(distributeDueDates('2026-07-20', '2026-07-20', 3)).toEqual(['2026-07-20', '2026-07-20', '2026-07-20'])
    expect(distributeDueDates('2026-07-20', '2026-07-10', 2)).toEqual(['2026-07-10', '2026-07-10'])
  })

  it('produces non-decreasing dates with duplicates when cards exceed days', () => {
    const dates = distributeDueDates('2026-07-20', '2026-07-22', 5)
    expect(dates).toHaveLength(5)
    expect(dates[4]).toBe('2026-07-22')
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true)
    }
    expect(new Set(dates).size).toBeLessThan(5)
  })
})

// API-024: o study_reschedule repete o distributeDueDates no servidor. Os
// vetores relativos do harness (supabase/checks/api024-study-rpcs.sql, `vec`:
// [meta - hoje, n cards, prazo de cada card - hoje]) rodam contra a RPC no
// staging e aqui contra a função do app: mudar um lado sem o outro quebra.

type RelativeVector = [span: number, count: number, offsets: number[]]

function harnessVectors(): RelativeVector[] {
  const marker = "vec jsonb := '"
  const start = harness.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  return JSON.parse(harness.slice(start + marker.length, harness.indexOf("';", start))) as RelativeVector[]
}

// Aritmética em UTC: independe do fuso de quem roda o teste.
function plusDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000)
}

describe('distributeDueDates × study_reschedule (vetores do harness do API-024)', () => {
  const vectors = harnessVectors()

  it('de 40 a 70 vetores, com meta no passado e em hoje, n = 1 e n = 100', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(40)
    expect(vectors.length).toBeLessThanOrEqual(70)
    expect(vectors.some(([span]) => span < 0)).toBe(true)
    expect(vectors.some(([span]) => span === 0)).toBe(true)
    expect(vectors.some(([, count]) => count === 1)).toBe(true)
    expect(vectors.some(([, count]) => count === 100)).toBe(true)
    for (const [, count, offsets] of vectors) expect(offsets).toHaveLength(count)
  })

  // Virada de mês, ano bissexto, horário de verão dos EUA e virada de ano. O
  // fuso fica fixo em Nova York: no CI (UTC) e em São Paulo (sem horário de
  // verão desde 2019) todo dia tem 24 h, e um Math.floor no lugar do
  // Math.round do totalDays passaria. O stubEnv grava no process.env, e o Node
  // relê o TZ; o pool do vitest é forks (padrão do vitest 4, sem pool no
  // vite.config.ts), então a troca vale só para este arquivo.
  describe('no fuso de Nova York', () => {
    beforeAll(() => {
      vi.stubEnv('TZ', 'America/New_York')
      // Pré-condição: o fuso valeu, 8/3/2026 tem 23 h e 1/11/2026 tem 25 h.
      const hours = (y: number, m: number, d: number) => (new Date(y, m - 1, d + 1).getTime() - new Date(y, m - 1, d).getTime()) / 3_600_000
      expect([hours(2026, 3, 8), hours(2026, 11, 1)]).toEqual([23, 25])
    })
    afterAll(() => { vi.unstubAllEnvs() })

    it.each(['2026-07-20', '2026-02-27', '2028-02-27', '2026-03-08', '2026-11-01', '2026-12-31'])('a partir de %s', start => {
      for (const [span, count, offsets] of vectors) {
        const dates = distributeDueDates(start, plusDays(start, span), count)
        expect(dates.map(date => daysBetween(start, date)), `${span} ${count}`).toEqual(offsets)
      }
    })
  })

  it('a conta inteira do SQL, (2*i*span + n) / (2*n), é o Math.round do app', () => {
    expect(migration024).toContain('v_today + ((2 * o.i * (v_target - v_today) + o.n) / (2 * o.n))::integer')
    expect(migration024).toContain('case when v_target <= v_today then v_target')
    for (const [span, count, offsets] of vectors) {
      const sql = Array.from({ length: count }, (_, k) => (span <= 0 ? span : Math.floor((2 * (k + 1) * span + count) / (2 * count))))
      expect(sql, `${span} ${count}`).toEqual(offsets)
    }
  })
})

describe('isCardOverdue', () => {
  it('is overdue only past due with unfinished checkpoints', () => {
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [cp(false)], quiz: [] }, '2026-07-20')).toBe(true)
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [cp(true), cp(true)], quiz: [] }, '2026-07-20')).toBe(false)
    expect(isCardOverdue({ due_date: '2026-07-20', checkpoints: [cp(false)], quiz: [] }, '2026-07-20')).toBe(false)
    expect(isCardOverdue({ due_date: null, checkpoints: [cp(false)], quiz: [] }, '2026-07-20')).toBe(false)
  })

  it('treats an empty past-due card as overdue', () => {
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [], quiz: [] }, '2026-07-20')).toBe(true)
  })

  it('counts unanswered or wrong quiz questions as unfinished work', () => {
    const quiz = [{ id: 'q1', statement: 'x', answer: 'certo' as const, userAnswer: null }]
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [cp(true)], quiz }, '2026-07-20')).toBe(true)
    const rightQuiz = [{ ...quiz[0], userAnswer: 'certo' as const }]
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [cp(true)], quiz: rightQuiz }, '2026-07-20')).toBe(false)
  })
})

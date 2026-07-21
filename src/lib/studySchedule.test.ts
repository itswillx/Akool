import { describe, expect, it } from 'vitest'
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

describe('isCardOverdue', () => {
  it('is overdue only past due with unfinished checkpoints', () => {
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [cp(false)] }, '2026-07-20')).toBe(true)
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [cp(true), cp(true)] }, '2026-07-20')).toBe(false)
    expect(isCardOverdue({ due_date: '2026-07-20', checkpoints: [cp(false)] }, '2026-07-20')).toBe(false)
    expect(isCardOverdue({ due_date: null, checkpoints: [cp(false)] }, '2026-07-20')).toBe(false)
  })

  it('treats an empty past-due card as overdue', () => {
    expect(isCardOverdue({ due_date: '2026-07-19', checkpoints: [] }, '2026-07-20')).toBe(true)
  })
})

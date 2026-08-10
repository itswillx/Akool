import { describe, expect, it } from 'vitest'
import type { ProjectCard, ProjectCardPriority } from '../types'
import {
  overviewSummary,
  countByColumnId,
  countByPriority,
  countByAssignee,
  dueBuckets,
  createdPerWeek,
} from './projectStats'

const TODAY = '2025-06-18' // Wednesday; week is Mon 2025-06-16 .. Sun 2025-06-22

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: Math.random().toString(36).slice(2),
    board_id: 'b1', column_id: 'c1', title: 't', description: '',
    priority: 'medium', start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null,
    labels: [], linked_page_id: null, parent_card_id: null, depends_on: [],
    completed: false, checklist: [], attachments: [], links: [],
    sort_order: 0, created_at: `${TODAY}T10:00:00Z`, updated_at: `${TODAY}T10:00:00Z`,
    ...overrides,
  }
}

describe('overviewSummary', () => {
  const cards = [
    card({ completed: true, assignee_user_id: 'u1' }),
    card({ due_date: '2025-06-10' }),               // overdue (open, past)
    card({ due_date: '2025-06-18', assignee_user_id: 'u1' }), // due today (this week, open)
    card({ due_date: '2025-06-22' }),               // due this week (open)
    card({ due_date: '2025-07-01' }),               // later
    card({}),                                        // no date, unassigned
  ]
  const s = overviewSummary(cards, TODAY)
  it('counts totals and completion', () => {
    expect(s.total).toBe(6)
    expect(s.completed).toBe(1)
    expect(s.open).toBe(5)
    expect(s.completionPct).toBe(17) // round(1/6*100)
  })
  it('counts overdue, due-this-week (open) and unassigned', () => {
    expect(s.overdue).toBe(1)
    expect(s.dueThisWeekOpen).toBe(2) // 06-18 and 06-22
    expect(s.unassigned).toBe(4)
  })
  it('handles empty input', () => {
    const e = overviewSummary([], TODAY)
    expect(e.total).toBe(0)
    expect(e.completionPct).toBe(0)
  })
})

describe('countByColumnId / countByPriority', () => {
  it('counts per column', () => {
    const r = countByColumnId([card({ column_id: 'a' }), card({ column_id: 'a' }), card({ column_id: 'b' })])
    expect(r).toEqual({ a: 2, b: 1 })
  })
  it('always returns all four priority keys', () => {
    const r = countByPriority([card({ priority: 'urgent' }), card({ priority: 'urgent' }), card({ priority: 'low' })])
    expect(r).toEqual({ urgent: 2, high: 0, medium: 0, low: 1 } as Record<ProjectCardPriority, number>)
  })
})

describe('countByAssignee', () => {
  it('groups by assignee with null for unassigned, sorted desc', () => {
    const r = countByAssignee([
      card({ assignee_user_id: 'u1' }), card({ assignee_user_id: 'u1' }), card({ assignee_user_id: 'u1' }),
      card({ assignee_user_id: 'u2' }),
      card({}), card({}),
    ])
    expect(r[0]).toEqual({ id: 'u1', count: 3 })
    expect(r).toContainEqual({ id: null, count: 2 })
    expect(r).toContainEqual({ id: 'u2', count: 1 })
  })
})

describe('dueBuckets', () => {
  it('partitions open cards by deadline and excludes completed', () => {
    const r = dueBuckets([
      card({ due_date: '2025-06-10' }),                    // overdue
      card({ due_date: '2025-06-18' }),                    // today
      card({ due_date: '2025-06-21' }),                    // week
      card({ due_date: '2025-08-01' }),                    // later
      card({}),                                             // none
      card({ completed: true, due_date: '2025-06-10' }),   // excluded
    ], TODAY)
    expect(r).toEqual({ overdue: 1, today: 1, week: 1, later: 1, none: 1 })
  })
})

describe('createdPerWeek', () => {
  it('buckets creation dates into the last N weeks', () => {
    const r = createdPerWeek([
      card({ created_at: '2025-06-17T08:00:00Z' }), // week of 06-16
      card({ created_at: '2025-06-10T08:00:00Z' }), // week of 06-09
      card({ created_at: '2025-06-03T08:00:00Z' }), // week of 06-02
      card({ created_at: '2025-05-20T08:00:00Z' }), // before window → ignored
    ], 4, TODAY)
    expect(r.map(b => b.weekStart)).toEqual(['2025-05-26', '2025-06-02', '2025-06-09', '2025-06-16'])
    expect(r.map(b => b.count)).toEqual([0, 1, 1, 1])
  })
})

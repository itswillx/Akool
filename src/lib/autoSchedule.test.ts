import { describe, expect, it } from 'vitest'
import type { ProjectCard, ProjectColumn } from '../types'
import { buildAutoSchedule } from './autoSchedule'

const TODAY = '2025-06-18'

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: Math.random().toString(36).slice(2),
    board_id: 'b1', column_id: 'c1', title: 't', description: '',
    priority: 'medium', start_date: null, due_date: null, estimated_days: 1,
    assignee_user_id: null,
    labels: [], linked_page_id: null, parent_card_id: null, depends_on: [],
    completed: false, checklist: [], attachments: [], links: [],
    sort_order: 0, created_at: `${TODAY}T10:00:00Z`, updated_at: `${TODAY}T10:00:00Z`,
    ...overrides,
  }
}

function column(overrides: Partial<ProjectColumn> = {}): ProjectColumn {
  return {
    id: 'c1', board_id: 'b1', name: 'Col', color: '#000', wip_limit: null,
    sort_order: 0, created_at: `${TODAY}T10:00:00Z`,
    ...overrides,
  }
}

describe('buildAutoSchedule', () => {
  it('chains cards within a column in priority order, urgent first', () => {
    const low = card({ id: 'low', priority: 'low' })
    const urgent = card({ id: 'urgent', priority: 'urgent' })
    const medium = card({ id: 'medium', priority: 'medium' })

    const { patches, overflowDays } = buildAutoSchedule([low, urgent, medium], [column()], TODAY)
    const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))

    expect(overflowDays).toBe(0)
    expect(byId.urgent.start_date).toBe(TODAY)
    expect(byId.urgent.due_date).toBe(TODAY) // 1-day default duration
    expect(byId.urgent.depends_on).toEqual([])
    expect(byId.medium.depends_on).toEqual(['urgent'])
    expect(byId.low.depends_on).toEqual(['medium'])
    // sequential, no overlap: each card starts the day after the previous one's due date
    expect(byId.medium.start_date).toBe(addOneDay(byId.urgent.due_date))
    expect(byId.low.start_date).toBe(addOneDay(byId.medium.due_date))
  })

  it('uses estimated_days to compute due_date', () => {
    const c = card({ id: 'a', estimated_days: 3 })
    const { patches: [patch] } = buildAutoSchedule([c], [column()], TODAY)
    expect(patch.start_date).toBe('2025-06-18')
    expect(patch.due_date).toBe('2025-06-20') // 3-day span inclusive
  })

  it('never modifies a card that already has a due_date, but anchors the cursor on it', () => {
    const fixed = card({ id: 'fixed', priority: 'urgent', due_date: '2025-06-25', start_date: '2025-06-24' })
    const toSchedule = card({ id: 'next', priority: 'high' })

    const { patches } = buildAutoSchedule([fixed, toSchedule], [column()], TODAY)

    expect(patches.find(p => p.cardId === 'fixed')).toBeUndefined()
    const next = patches.find(p => p.cardId === 'next')!
    expect(next.start_date).toBe('2025-06-26') // day after the fixed card's due_date
    expect(next.depends_on).toEqual(['fixed'])
  })

  it('keeps columns independent — no cross-column dependencies', () => {
    const a = card({ id: 'a', column_id: 'colA', priority: 'urgent' })
    const b = card({ id: 'b', column_id: 'colB', priority: 'urgent' })
    const cols = [column({ id: 'colA' }), column({ id: 'colB' })]

    const { patches } = buildAutoSchedule([a, b], cols, TODAY)
    const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))

    expect(byId.a.start_date).toBe(TODAY)
    expect(byId.b.start_date).toBe(TODAY)
    expect(byId.a.depends_on).toEqual([])
    expect(byId.b.depends_on).toEqual([])
  })

  it('defaults missing estimated_days to 1 day', () => {
    const c = { ...card({ id: 'legacy' }), estimated_days: undefined } as unknown as ProjectCard
    const { patches: [patch] } = buildAutoSchedule([c], [column()], TODAY)
    expect(patch.due_date).toBe(patch.start_date)
  })

  it('preserves a pre-existing manual dependency by merging, not replacing', () => {
    const urgent = card({ id: 'urgent', priority: 'urgent' })
    const medium = card({ id: 'medium', priority: 'medium', depends_on: ['manual-dep'] })
    const { patches } = buildAutoSchedule([urgent, medium], [column()], TODAY)
    const mediumPatch = patches.find(p => p.cardId === 'medium')!
    expect(mediumPatch.depends_on).toEqual(expect.arrayContaining(['manual-dep', 'urgent']))
    expect(mediumPatch.depends_on).toHaveLength(2)
  })

  it('excludes completed cards from scheduling entirely', () => {
    const done = card({ id: 'done', completed: true, priority: 'urgent' })
    const open = card({ id: 'open', priority: 'low' })
    const { patches } = buildAutoSchedule([done, open], [column()], TODAY)
    expect(patches.find(p => p.cardId === 'done')).toBeUndefined()
    const openPatch = patches.find(p => p.cardId === 'open')!
    expect(openPatch.start_date).toBe(TODAY) // not pushed back by the completed card
    expect(openPatch.depends_on).toEqual([])
  })

  it('returns no patches for empty input', () => {
    expect(buildAutoSchedule([], [column()], TODAY)).toEqual({ patches: [], overflowDays: 0 })
    expect(buildAutoSchedule([card()], [], TODAY)).toEqual({ patches: [], overflowDays: 0 })
  })

  describe('with a target deadline', () => {
    it('spreads cards across the full window to land exactly on the deadline, even when the raw durations would finish early', () => {
      // 2 cards x 1 raw day, deadline is 10 days out — stretched to fill the
      // whole window instead of finishing after 2 days.
      const a = card({ id: 'a', priority: 'urgent', estimated_days: 1 })
      const b = card({ id: 'b', priority: 'high', estimated_days: 1 })
      const deadline = '2025-06-28'
      const { patches, overflowDays } = buildAutoSchedule([a, b], [column()], TODAY, deadline)

      expect(overflowDays).toBe(0)
      const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))
      expect(byId.a.start_date).toBe(TODAY)
      expect(byId.a.due_date > TODAY).toBe(true) // stretched well past its raw 1-day estimate
      expect(byId.b.start_date).toBe(addOneDay(byId.a.due_date)) // still sequential, no gaps
      expect(byId.b.due_date).toBe(deadline) // last card lands exactly on the deadline
    })

    it('compresses proportionally so the column lands exactly on the deadline', () => {
      // weights 1:3 over a 2-day window (today + tomorrow) instead of the 4 raw days requested.
      const a = card({ id: 'a', priority: 'urgent', estimated_days: 1 })
      const b = card({ id: 'b', priority: 'high', estimated_days: 3 })
      const deadline = addOneDay(TODAY) // only 2 days available (today + tomorrow)
      const { patches, overflowDays } = buildAutoSchedule([a, b], [column()], TODAY, deadline)

      expect(overflowDays).toBe(0)
      const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))
      expect(byId.a.start_date).toBe(TODAY)
      expect(byId.b.due_date).toBe(deadline) // last card lands exactly on the deadline
      expect(byId.b.start_date >= byId.a.due_date).toBe(true) // no overlap
    })

    it('gives every card at least 1 day and reports overflow when the deadline is impossible', () => {
      const a = card({ id: 'a', priority: 'urgent' })
      const b = card({ id: 'b', priority: 'high' })
      const c = card({ id: 'c', priority: 'medium' })
      // Deadline is before today: 0 (or negative) days actually available.
      const { patches, overflowDays } = buildAutoSchedule([a, b, c], [column()], TODAY, '2025-06-10')

      expect(overflowDays).toBeGreaterThan(0)
      expect(patches).toHaveLength(3)
      const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))
      // Each card still gets exactly 1 day, sequential, no overlap.
      expect(byId.a.start_date).toBe(TODAY)
      expect(byId.b.start_date).toBe(addOneDay(byId.a.due_date))
      expect(byId.c.start_date).toBe(addOneDay(byId.b.due_date))
    })

    it('applies the same global deadline independently per column', () => {
      // colA is light (would finish in 1 day) and gets stretched; colB is heavy and needs compression.
      const light = card({ id: 'light', column_id: 'colA', priority: 'urgent', estimated_days: 1 })
      const heavy1 = card({ id: 'heavy1', column_id: 'colB', priority: 'urgent', estimated_days: 5 })
      const heavy2 = card({ id: 'heavy2', column_id: 'colB', priority: 'high', estimated_days: 5 })
      const cols = [column({ id: 'colA' }), column({ id: 'colB' })]
      const deadline = addOneDay(TODAY) // 2-day window

      const { patches, overflowDays } = buildAutoSchedule([light, heavy1, heavy2], cols, TODAY, deadline)
      expect(overflowDays).toBe(0)
      const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))

      expect(byId.light.due_date).toBe(deadline) // stretched to fill the whole window, not just its raw 1-day estimate
      expect(byId.heavy2.due_date).toBe(deadline) // compressed to land exactly on the deadline
    })

    it('replans a card that already has a due_date (e.g. from a previous run) to fit the new deadline', () => {
      const already = card({ id: 'already', priority: 'urgent', due_date: '2025-07-01', start_date: '2025-07-01' })
      const fresh = card({ id: 'fresh', priority: 'high' })
      const deadline = addOneDay(TODAY) // tight window forces a full replan
      const { patches } = buildAutoSchedule([already, fresh], [column()], TODAY, deadline)
      const byId = Object.fromEntries(patches.map(p => [p.cardId, p]))

      expect(byId.already).toBeDefined() // no longer skipped just because it had a date
      expect(byId.already.due_date <= deadline).toBe(true)
      expect(byId.fresh.due_date <= deadline).toBe(true)
    })
  })

  it('leaves a card with a due_date untouched when no target deadline is given', () => {
    const already = card({ id: 'already', priority: 'urgent', due_date: '2025-07-01' })
    const fresh = card({ id: 'fresh', priority: 'high' })
    const { patches } = buildAutoSchedule([already, fresh], [column()], TODAY)
    expect(patches.find(p => p.cardId === 'already')).toBeUndefined()
    expect(patches.find(p => p.cardId === 'fresh')).toBeDefined()
  })
})

function addOneDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + 86_400_000
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

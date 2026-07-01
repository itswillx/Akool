import { describe, expect, it } from 'vitest'
import { buildLinks, linkPath, nodeBar, type GanttNode } from './ganttLayout'
import type { ProjectCard } from '../types'

function makeCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: '1',
    board_id: 'b1',
    column_id: 'c1',
    title: 'Test card',
    description: '',
    priority: 'medium',
    start_date: null,
    due_date: null,
    assignee_user_id: null,
    labels: [],
    linked_page_id: null,
    parent_card_id: null,
    depends_on: [],
    completed: false,
    checklist: [],
    attachments: [],
    links: [],
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('buildLinks', () => {
  it('creates a dep link from depends_on', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', depends_on: ['a'] }),
    ]
    expect(buildLinks(cards)).toEqual([{ from: 'a', to: 'b', kind: 'dep' }])
  })

  it('creates a parent link from parent_card_id', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', parent_card_id: 'a' }),
    ]
    expect(buildLinks(cards)).toEqual([{ from: 'a', to: 'b', kind: 'parent' }])
  })

  it('keeps only the dep link when a pair is both parent and dependency', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', parent_card_id: 'a', depends_on: ['a'] }),
    ]
    expect(buildLinks(cards)).toEqual([{ from: 'a', to: 'b', kind: 'dep' }])
  })

  it('ignores links whose endpoint is missing from the set', () => {
    const cards = [
      makeCard({ id: 'b', depends_on: ['ghost'], parent_card_id: 'ghost' }),
    ]
    expect(buildLinks(cards)).toEqual([])
  })

  it('ignores self references', () => {
    const cards = [makeCard({ id: 'a', depends_on: ['a'], parent_card_id: 'a' })]
    expect(buildLinks(cards)).toEqual([])
  })
})

function node(card: Partial<ProjectCard>, children: GanttNode[] = []): GanttNode {
  return { card: makeCard(card), children }
}

describe('nodeBar', () => {
  it('extends a parent bar to its own start when earlier than the child', () => {
    const tree = node(
      { id: 'p', start_date: '2026-06-28', due_date: '2026-07-01' },
      [node({ id: 'c', start_date: '2026-07-01', due_date: '2026-08-03' })],
    )
    expect(nodeBar(tree)).toEqual({ start: '2026-06-28', end: '2026-08-03', isMilestone: false, progress: 0 })
  })

  it('rolls up across multiple nesting levels (grandparent -> parent -> child)', () => {
    const tree = node(
      { id: 'g', start_date: '2026-06-27' }, // own milestone, no due
      [node(
        { id: 'p', start_date: '2026-06-28', due_date: '2026-07-01' },
        [node({ id: 'c', start_date: '2026-07-01', due_date: '2026-08-03' })],
      )],
    )
    // grandparent extends to its own 27/06 and covers the deepest end 03/08
    expect(nodeBar(tree)).toEqual({ start: '2026-06-27', end: '2026-08-03', isMilestone: false, progress: 0 })
    // the intermediate parent stays staggered at 28/06
    expect(nodeBar(tree.children[0])).toEqual({ start: '2026-06-28', end: '2026-08-03', isMilestone: false, progress: 0 })
  })

  it('falls back to the children span when the parent has no own dates', () => {
    const tree = node(
      { id: 'p' }, // no start/due
      [
        node({ id: 'a', start_date: '2026-07-01', due_date: '2026-07-05' }),
        node({ id: 'b', start_date: '2026-07-10', due_date: '2026-07-12' }),
      ],
    )
    const bar = nodeBar(tree)
    expect(bar?.start).toBe('2026-07-01')
    expect(bar?.end).toBe('2026-07-12')
  })
})

describe('linkPath', () => {
  it('uses a forward elbow when the successor starts well ahead', () => {
    const d = linkPath({ x1: 0, y1: 10, x2: 100, y2: 40, rowH: 38, gap: 9 })
    expect(d).toBe('M 0 10 H 91 V 40 H 100')
  })

  it('routes around (does not go straight back) when bars overlap', () => {
    const d = linkPath({ x1: 100, y1: 10, x2: 40, y2: 48, rowH: 38, gap: 9 })
    // out to the right of x1, down into the row gutter, then back to x2
    expect(d).toBe('M 100 10 H 109 V 29 H 31 V 48 H 40')
  })

  it('routes upward when the successor sits above the predecessor', () => {
    const d = linkPath({ x1: 100, y1: 48, x2: 40, y2: 10, rowH: 38, gap: 9 })
    expect(d).toBe('M 100 48 H 109 V 29 H 31 V 10 H 40')
  })
})

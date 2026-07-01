import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultCardFilters,
  filterProjectCards,
  hasActiveFilters,
  isDueThisWeek,
  isOverdue,
  matchesDuePreset,
  countActiveFilters,
  collectBoardLabels,
  loadCardFilters,
  saveCardFilters,
} from './projectCardFilters'
import type { ProjectCard, ProjectCardPriority } from '../types'

const TODAY = '2025-06-22'

function makeCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: '1',
    board_id: 'b1',
    column_id: 'c1',
    title: 'Test card',
    description: 'Some description',
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

describe('filterProjectCards', () => {
  const cards = [
    makeCard({ id: '1', title: 'SEC-001 urgent task', priority: 'urgent', due_date: '2025-06-20', labels: ['segurança'] }),
    makeCard({ id: '2', title: 'Normal task', priority: 'low', due_date: '2025-06-22', assignee_user_id: 'u1', completed: true }),
    makeCard({ id: '3', title: 'Another', priority: 'high', column_id: 'c2', labels: ['performance'] }),
  ]

  it('returns all cards with default filters', () => {
    expect(filterProjectCards(cards, defaultCardFilters(), TODAY)).toHaveLength(3)
  })

  it('filters by search in title and description', () => {
    const filters = { ...defaultCardFilters(), search: 'sec-001' }
    expect(filterProjectCards(cards, filters, TODAY)).toHaveLength(1)
    expect(filterProjectCards(cards, { ...defaultCardFilters(), search: 'description' }, TODAY)).toHaveLength(3)
  })

  it('filters by priority (OR within)', () => {
    const filters = { ...defaultCardFilters(), priorities: ['urgent', 'high'] as ProjectCardPriority[] }
    const result = filterProjectCards(cards, filters, TODAY)
    expect(result.map(c => c.id)).toEqual(['1', '3'])
  })

  it('filters by labels (OR within)', () => {
    const filters = { ...defaultCardFilters(), labels: ['segurança'] }
    expect(filterProjectCards(cards, filters, TODAY)).toHaveLength(1)
  })

  it('filters by assignee unassigned', () => {
    const filters = { ...defaultCardFilters(), assigneeId: 'unassigned' as const }
    expect(filterProjectCards(cards, filters, TODAY)).toHaveLength(2)
  })

  it('filters by assignee id', () => {
    const filters = { ...defaultCardFilters(), assigneeId: 'u1' }
    expect(filterProjectCards(cards, filters, TODAY)).toHaveLength(1)
  })

  it('filters by column', () => {
    const filters = { ...defaultCardFilters(), columnId: 'c2' }
    expect(filterProjectCards(cards, filters, TODAY)).toHaveLength(1)
  })

  it('filters by completion status', () => {
    expect(filterProjectCards(cards, { ...defaultCardFilters(), completion: 'done' }, TODAY)).toHaveLength(1)
    expect(filterProjectCards(cards, { ...defaultCardFilters(), completion: 'open' }, TODAY)).toHaveLength(2)
  })

  it('combines filters with AND between dimensions', () => {
    const filters = {
      ...defaultCardFilters(),
      priorities: ['urgent'] as ProjectCardPriority[],
      labels: ['performance'],
    }
    expect(filterProjectCards(cards, filters, TODAY)).toHaveLength(0)
  })
})

describe('due date presets', () => {
  it('detects overdue cards', () => {
    const card = makeCard({ due_date: '2025-06-20' })
    expect(isOverdue(card, TODAY)).toBe(true)
    expect(matchesDuePreset(card, 'overdue', TODAY)).toBe(true)
  })

  it('does not mark completed cards as overdue', () => {
    const card = makeCard({ due_date: '2025-06-20', completed: true })
    expect(isOverdue(card, TODAY)).toBe(false)
  })

  it('detects today', () => {
    const card = makeCard({ due_date: TODAY })
    expect(matchesDuePreset(card, 'today', TODAY)).toBe(true)
  })

  it('detects this week (Mon–Sun)', () => {
    const card = makeCard({ due_date: '2025-06-21' })
    expect(isDueThisWeek(card, TODAY)).toBe(true)
  })

  it('handles no_date and has_date', () => {
    const noDate = makeCard({ due_date: null })
    const hasDate = makeCard({ due_date: '2025-06-22' })
    expect(matchesDuePreset(noDate, 'no_date', TODAY)).toBe(true)
    expect(matchesDuePreset(hasDate, 'has_date', TODAY)).toBe(true)
  })
})

describe('hasActiveFilters', () => {
  it('returns false for defaults', () => {
    expect(hasActiveFilters(defaultCardFilters())).toBe(false)
    expect(countActiveFilters(defaultCardFilters())).toBe(0)
  })

  it('counts active filter dimensions', () => {
    const filters = {
      ...defaultCardFilters(),
      search: 'x',
      priorities: ['urgent'] as ProjectCardPriority[],
      duePreset: 'overdue' as const,
    }
    expect(hasActiveFilters(filters)).toBe(true)
    expect(countActiveFilters(filters)).toBe(3)
  })
})

describe('collectBoardLabels', () => {
  it('deduplicates and sorts labels alphabetically', () => {
    const cards = [
      makeCard({ labels: ['zebra', 'alpha'] }),
      makeCard({ labels: ['alpha', 'beta'] }),
      makeCard({ labels: ['beta'] }),
    ]
    expect(collectBoardLabels(cards)).toEqual(['alpha', 'beta', 'zebra'])
  })

  it('returns empty array when no labels', () => {
    expect(collectBoardLabels([makeCard(), makeCard()])).toEqual([])
  })
})

describe('loadCardFilters / saveCardFilters', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
  })

  it('returns defaults when nothing stored', () => {
    expect(loadCardFilters('board-abc')).toEqual(defaultCardFilters())
  })

  it('persists and restores filters', () => {
    const filters = {
      ...defaultCardFilters(),
      search: 'urgent fix',
      priorities: ['urgent'] as ProjectCardPriority[],
      duePreset: 'overdue' as const,
    }
    saveCardFilters('board-abc', filters)
    expect(loadCardFilters('board-abc')).toEqual(filters)
  })

  it('merges partial stored data with defaults', () => {
    store['projects_filters:board-abc'] = JSON.stringify({ search: 'partial' })
    const loaded = loadCardFilters('board-abc')
    expect(loaded.search).toBe('partial')
    expect(loaded.duePreset).toBe('all')
  })

  it('returns defaults on invalid JSON', () => {
    store['projects_filters:board-abc'] = '{not valid json'
    expect(loadCardFilters('board-abc')).toEqual(defaultCardFilters())
  })
})

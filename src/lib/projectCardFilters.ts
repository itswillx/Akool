import type { ProjectCard, ProjectCardPriority } from '../types'

export type DueDatePreset = 'all' | 'overdue' | 'today' | 'this_week' | 'no_date' | 'has_date'
export type CompletionFilter = 'all' | 'open' | 'done'

export type ProjectCardFilters = {
  search: string
  priorities: ProjectCardPriority[]
  duePreset: DueDatePreset
  labels: string[]
  assigneeId: '' | 'unassigned' | string
  columnId: string
  completion: CompletionFilter
}

const FILTERS_KEY_PREFIX = 'projects_filters:'

export function defaultCardFilters(): ProjectCardFilters {
  return {
    search: '',
    priorities: [],
    duePreset: 'all',
    labels: [],
    assigneeId: '',
    columnId: '',
    completion: 'all',
  }
}

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isOverdue(card: ProjectCard, today?: string): boolean {
  const t = today ?? todayStr()
  return !!(card.due_date && !card.completed && card.due_date < t)
}

export function isDueToday(card: ProjectCard, today?: string): boolean {
  const t = today ?? todayStr()
  return !!(card.due_date && card.due_date === t)
}

export function isDueThisWeek(card: ProjectCard, today?: string): boolean {
  if (!card.due_date) return false
  const t = today ?? todayStr()
  const ref = new Date(`${t}T00:00:00`)
  const day = ref.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(ref)
  monday.setDate(ref.getDate() + mondayOffset)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const start = todayStr(monday)
  const end = todayStr(sunday)
  return card.due_date >= start && card.due_date <= end
}

export function matchesDuePreset(card: ProjectCard, preset: DueDatePreset, today?: string): boolean {
  switch (preset) {
    case 'all':
      return true
    case 'overdue':
      return isOverdue(card, today)
    case 'today':
      return isDueToday(card, today)
    case 'this_week':
      return isDueThisWeek(card, today)
    case 'no_date':
      return !card.due_date
    case 'has_date':
      return !!card.due_date
  }
}

export function filterProjectCards(
  cards: ProjectCard[],
  filters: ProjectCardFilters,
  today?: string,
): ProjectCard[] {
  const q = filters.search.trim().toLowerCase()
  return cards.filter(card => {
    if (q) {
      const inTitle = card.title.toLowerCase().includes(q)
      const inDesc = card.description.toLowerCase().includes(q)
      if (!inTitle && !inDesc) return false
    }
    if (filters.priorities.length > 0 && !filters.priorities.includes(card.priority)) return false
    if (!matchesDuePreset(card, filters.duePreset, today)) return false
    if (filters.labels.length > 0 && !filters.labels.some(l => card.labels.includes(l))) return false
    if (filters.assigneeId === 'unassigned') {
      if (card.assignee_user_id) return false
    } else if (filters.assigneeId && card.assignee_user_id !== filters.assigneeId) {
      return false
    }
    if (filters.columnId && card.column_id !== filters.columnId) return false
    if (filters.completion === 'open' && card.completed) return false
    if (filters.completion === 'done' && !card.completed) return false
    return true
  })
}

export function hasActiveFilters(filters: ProjectCardFilters): boolean {
  return countActiveFilters(filters) > 0
}

export function countActiveFilters(filters: ProjectCardFilters): number {
  let n = 0
  if (filters.search.trim()) n++
  if (filters.priorities.length) n++
  if (filters.duePreset !== 'all') n++
  if (filters.labels.length) n++
  if (filters.assigneeId) n++
  if (filters.columnId) n++
  if (filters.completion !== 'all') n++
  return n
}

export function collectBoardLabels(cards: ProjectCard[]): string[] {
  const set = new Set<string>()
  cards.forEach(c => c.labels.forEach(l => set.add(l)))
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function loadCardFilters(boardId: string): ProjectCardFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY_PREFIX + boardId)
    if (!raw) return defaultCardFilters()
    const parsed = JSON.parse(raw) as Partial<ProjectCardFilters>
    return { ...defaultCardFilters(), ...parsed }
  } catch {
    return defaultCardFilters()
  }
}

export function saveCardFilters(boardId: string, filters: ProjectCardFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY_PREFIX + boardId, JSON.stringify(filters))
  } catch { /* ignore */ }
}

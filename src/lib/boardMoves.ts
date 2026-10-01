import { arrayMove } from '@dnd-kit/sortable'
import type { ProjectCard, ProjectColumn } from '../types'

// PERF-004: a matemática de mover cards e colunas no kanban, fora do
// ProjectsPanel para ser testada, e a diferença que vai para o banco. Antes, o
// quadro gravava um UPDATE por card das colunas afetadas (mudado ou não), em
// dezenas de requisições e sem atomicidade.

export const byOrder = (a: ProjectCard, b: ProjectCard) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

export function reindexAllCards(list: ProjectCard[]): ProjectCard[] {
  const byCol = new Map<string, ProjectCard[]>()
  for (const c of list) {
    const col = byCol.get(c.column_id) ?? []
    col.push(c)
    byCol.set(c.column_id, col)
  }
  const result: ProjectCard[] = []
  for (const col of byCol.values()) {
    col.forEach((c, i) => result.push({ ...c, sort_order: i }))
  }
  return result
}

export function resolveColumnId(overId: string, list: ProjectCard[]): string | null {
  if (overId.startsWith('col:')) return overId.slice(4)
  return list.find(c => c.id === overId)?.column_id ?? null
}

export function applyCardMove(prev: ProjectCard[], activeId: string, overId: string): ProjectCard[] | null {
  if (activeId === overId) return null

  const activeCard = prev.find(c => c.id === activeId)
  if (!activeCard) return null

  const activeCol = activeCard.column_id
  const overCol = resolveColumnId(overId, prev)
  if (!overCol) return null

  if (activeCol === overCol && !overId.startsWith('col:')) {
    const colCards = prev.filter(c => c.column_id === activeCol).sort(byOrder)
    const oldIndex = colCards.findIndex(c => c.id === activeId)
    const newIndex = colCards.findIndex(c => c.id === overId)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
    const reordered = arrayMove(colCards, oldIndex, newIndex)
    const others = prev.filter(c => c.column_id !== activeCol)
    return reindexAllCards([...others, ...reordered])
  }

  if (activeCol === overCol && overId.startsWith('col:')) {
    const colCards = prev.filter(c => c.column_id === activeCol).sort(byOrder)
    const oldIndex = colCards.findIndex(c => c.id === activeId)
    if (oldIndex === -1 || oldIndex === colCards.length - 1) return null
    const reordered = arrayMove(colCards, oldIndex, colCards.length - 1)
    const others = prev.filter(c => c.column_id !== activeCol)
    return reindexAllCards([...others, ...reordered])
  }

  const withoutActive = prev.filter(c => c.id !== activeId)
  const moved = { ...activeCard, column_id: overCol }

  if (overId.startsWith('col:')) {
    const others = withoutActive.filter(c => c.column_id !== overCol)
    const targetCol = withoutActive.filter(c => c.column_id === overCol)
    return reindexAllCards([...others, ...targetCol, moved])
  }

  const overIndex = withoutActive.findIndex(c => c.id === overId)
  if (overIndex === -1) return null
  const next = [...withoutActive]
  next.splice(overIndex, 0, moved)
  return reindexAllCards(next)
}

export function moveCardToColumn(prev: ProjectCard[], cardId: string, targetColumnId: string): ProjectCard[] | null {
  const activeCard = prev.find(c => c.id === cardId)
  if (!activeCard || activeCard.column_id === targetColumnId) return null
  const withoutActive = prev.filter(c => c.id !== cardId)
  const moved = { ...activeCard, column_id: targetColumnId }
  const targetCol = withoutActive.filter(c => c.column_id === targetColumnId)
  const others = withoutActive.filter(c => c.column_id !== targetColumnId)
  return reindexAllCards([...others, ...targetCol, moved])
}

export interface CardPlacement {
  id: string
  column_id: string
  sort_order: number
}

/**
 * Os cards cujo lugar (coluna ou ordem) mudou entre `before` e `after`. É o
 * que vai para o banco. `before` precisa ser a foto de antes do drag: o
 * drag-over já mexe no estado no meio do caminho.
 */
export function changedPlacements(
  before: readonly Pick<ProjectCard, 'id' | 'column_id' | 'sort_order'>[],
  after: readonly Pick<ProjectCard, 'id' | 'column_id' | 'sort_order'>[],
): CardPlacement[] {
  const was = new Map(before.map(c => [c.id, c]))
  const out: CardPlacement[] = []
  for (const card of after) {
    const prev = was.get(card.id)
    if (prev && prev.column_id === card.column_id && (prev.sort_order ?? 0) === (card.sort_order ?? 0)) continue
    out.push({ id: card.id, column_id: card.column_id, sort_order: card.sort_order ?? 0 })
  }
  return out
}

/** As colunas cuja ordem mudou. */
export function changedColumnOrder(
  before: readonly Pick<ProjectColumn, 'id' | 'sort_order'>[],
  after: readonly Pick<ProjectColumn, 'id' | 'sort_order'>[],
): { id: string; sort_order: number }[] {
  const was = new Map(before.map(c => [c.id, c.sort_order]))
  return after
    .filter(c => was.get(c.id) !== c.sort_order)
    .map(c => ({ id: c.id, sort_order: c.sort_order }))
}

import { describe, expect, it } from 'vitest'
import { applyCardMove, changedColumnOrder, changedPlacements, moveCardToColumn } from './boardMoves'
import type { ProjectCard } from '../types'

const card = (id: string, column_id: string, sort_order: number) => ({ id, column_id, sort_order }) as ProjectCard

// Duas colunas: A com a0..a4 e B com b0..b4.
const board = () => [
  ...[0, 1, 2, 3, 4].map(i => card(`a${i}`, 'A', i)),
  ...[0, 1, 2, 3, 4].map(i => card(`b${i}`, 'B', i)),
]

const placement = (list: ProjectCard[], id: string) => {
  const c = list.find(x => x.id === id)
  return c && [c.column_id, c.sort_order]
}

describe('changedPlacements (PERF-004)', () => {
  it('reordering inside a column sends only the cards that moved', () => {
    const before = board()
    const after = applyCardMove(before, 'a3', 'a1')!
    const moves = changedPlacements(before, after)
    expect(moves.map(m => m.id).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(placement(after, 'a3')).toEqual(['A', 1])
  })

  it('moving to the end of another column leaves the rest of the target untouched', () => {
    const before = board()
    const after = moveCardToColumn(before, 'a0', 'B')!
    const moves = changedPlacements(before, after)
    // a0 vai para o fim de B; A fecha o buraco (a1..a4 sobem uma posição).
    expect(moves.map(m => m.id).sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    expect(moves.find(m => m.id === 'a0')).toEqual({ id: 'a0', column_id: 'B', sort_order: 5 })
  })

  it('moving the last card of a column to the end of another touches just that card', () => {
    const before = board()
    const after = moveCardToColumn(before, 'a4', 'B')!
    expect(changedPlacements(before, after)).toEqual([{ id: 'a4', column_id: 'B', sort_order: 5 }])
  })

  it('no change, no request', () => {
    const before = board()
    expect(changedPlacements(before, before.map(c => ({ ...c })))).toEqual([])
  })

  it('compares against the snapshot from the drag start, not the drag-over state', () => {
    const snapshot = board()
    // O drag-over já levou a1 para B; o drop o solta no topo de B.
    const duringDrag = applyCardMove(snapshot, 'a1', 'col:B')!
    const dropped = applyCardMove(duringDrag, 'a1', 'b0')!
    const moves = changedPlacements(snapshot, dropped)
    expect(moves.find(m => m.id === 'a1')).toEqual({ id: 'a1', column_id: 'B', sort_order: 0 })
    expect(moves.some(m => m.id === 'a0')).toBe(false)
  })
})

describe('changedColumnOrder', () => {
  it('lists only the columns whose position changed', () => {
    const before = [{ id: 'x', sort_order: 0 }, { id: 'y', sort_order: 1 }, { id: 'z', sort_order: 2 }]
    const after = [{ id: 'y', sort_order: 0 }, { id: 'x', sort_order: 1 }, { id: 'z', sort_order: 2 }]
    expect(changedColumnOrder(before, after)).toEqual([{ id: 'y', sort_order: 0 }, { id: 'x', sort_order: 1 }])
  })
})

import { describe, expect, it } from 'vitest'
import {
  aggregate,
  columnDroppableId,
  filterBySearch,
  groupByColumn,
  neighborColumnId,
  normalizeSearch,
  resolveDropColumnId,
  visibleColumns,
  type BoardColumnDef,
} from './boardModel'

interface Row { id: string; col: string; amount: number; text: string }

const COLS: BoardColumnDef[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B', limit: 1000 },
  { id: 'c', label: 'C', droppable: false },
]

const ROWS: Row[] = [
  { id: '1', col: 'a', amount: 300, text: 'RTX 3060 João' },
  { id: '2', col: 'b', amount: 400, text: 'Café expresso' },
  { id: '3', col: 'b', amount: 700, text: 'Cimento Votoran' },
  { id: '4', col: 'zz', amount: 900, text: 'órfão' },
]

const getId = (r: Row) => r.id
const getCol = (r: Row) => r.col
const getAmount = (r: Row) => r.amount
const getText = (r: Row) => r.text

describe('resolveDropColumnId', () => {
  it('reads the column id straight off a column droppable', () => {
    expect(resolveDropColumnId(columnDroppableId('b'), ROWS, getId, getCol)).toBe('b')
  })

  it('resolves a drop on a card to that card\'s column', () => {
    expect(resolveDropColumnId('3', ROWS, getId, getCol)).toBe('b')
  })

  it('returns null for an unknown id so the caller ignores the drop', () => {
    expect(resolveDropColumnId('nope', ROWS, getId, getCol)).toBeNull()
  })
})

describe('groupByColumn', () => {
  it('keeps declared columns with no items as empty buckets', () => {
    const grouped = groupByColumn(COLS, ROWS, getCol)
    expect(grouped.get('c')).toEqual([])
  })

  it('drops items whose column is not declared', () => {
    // The orphan row ('zz') must not silently land in another column.
    const grouped = groupByColumn(COLS, ROWS, getCol)
    expect([...grouped.values()].flat().map(getId)).toEqual(['1', '2', '3'])
  })
})

describe('aggregate', () => {
  it('sums the amounts and reports the ceiling ratio', () => {
    const agg = aggregate(ROWS.filter(r => r.col === 'b'), 1000, getAmount)
    expect(agg).toEqual({ count: 2, total: 1100, pct: 1.1, over: true })
  })

  it('has no ratio without a ceiling', () => {
    expect(aggregate(ROWS, null, getAmount).pct).toBeNull()
    expect(aggregate(ROWS, 0, getAmount).over).toBe(false)
  })

  it('totals zero when the caller does not expose an amount', () => {
    expect(aggregate(ROWS, null).total).toBe(0)
  })
})

describe('normalizeSearch / filterBySearch', () => {
  it('strips accents and case', () => {
    expect(normalizeSearch('  Café Expresso ')).toBe('cafe expresso')
  })

  it('requires every term, in any order', () => {
    expect(filterBySearch(ROWS, 'joao rtx', getText).map(getId)).toEqual(['1'])
  })

  it('matches an accented row from an unaccented query', () => {
    expect(filterBySearch(ROWS, 'cafe', getText).map(getId)).toEqual(['2'])
  })

  it('returns everything for a blank query or without a text getter', () => {
    expect(filterBySearch(ROWS, '   ', getText)).toHaveLength(4)
    expect(filterBySearch(ROWS, 'rtx')).toHaveLength(4)
  })
})

describe('visibleColumns / neighborColumnId', () => {
  it('hides the columns the user toggled off', () => {
    expect(visibleColumns(COLS, new Set(['b'])).map(c => c.id)).toEqual(['a', 'c'])
  })

  it('steps over non-droppable columns', () => {
    // 'c' cannot receive a drop, so 'b' has no next column.
    expect(neighborColumnId(COLS, new Set(), 'a', 1)).toBe('b')
    expect(neighborColumnId(COLS, new Set(), 'b', 1)).toBeNull()
  })

  it('never targets a hidden column', () => {
    expect(neighborColumnId(COLS, new Set(['b']), 'a', 1)).toBeNull()
  })

  it('returns null at the ends and for an unknown column', () => {
    expect(neighborColumnId(COLS, new Set(), 'a', -1)).toBeNull()
    expect(neighborColumnId(COLS, new Set(), 'zz', 1)).toBeNull()
  })
})

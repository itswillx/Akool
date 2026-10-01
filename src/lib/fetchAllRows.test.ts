import { describe, expect, it } from 'vitest'
import { fetchAllRows, FETCH_PAGE_SIZE } from './fetchAllRows'

// Tabela falsa com o mesmo corte do PostgREST: cada pedido devolve no máximo
// `maxRows` linhas, sem erro, mesmo que o range peça mais.
function fakeTable(total: number, maxRows = FETCH_PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `tx-${i}` }))
  const calls: [number, number][] = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null }
  }
  return { page, calls }
}

describe('fetchAllRows', () => {
  it('reads past the 1000-row cap without repeating rows', async () => {
    const { page, calls } = fakeTable(2500)
    const result = await fetchAllRows(page)
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(2500)
    expect(new Set(result.data?.map(r => r.id)).size).toBe(2500)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('asks one more page when the last one is exactly full, then stops', async () => {
    const { page, calls } = fakeTable(1000)
    const result = await fetchAllRows(page)
    expect(result.data).toHaveLength(1000)
    expect(calls).toHaveLength(2)
  })

  it('makes a single request for a small or empty table', async () => {
    for (const total of [0, 412]) {
      const { page, calls } = fakeTable(total)
      const result = await fetchAllRows(page)
      expect(result.data).toHaveLength(total)
      expect(calls).toHaveLength(1)
    }
  })

  it('returns the error instead of a partial list', async () => {
    const { page } = fakeTable(2500)
    let n = 0
    const failing = async (from: number, to: number) => {
      n += 1
      if (n === 2) return { data: null, error: { message: 'timeout', code: '57014' } }
      return page(from, to)
    }
    const result = await fetchAllRows(failing)
    expect(result).toEqual({ data: null, error: { message: 'timeout', code: '57014' } })
  })
})

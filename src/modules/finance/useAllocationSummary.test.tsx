// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// API-066: o capital parado da Visão geral aplica a regra da Loja (cotação
// não conta). O supabase falso devolve só as colunas pedidas no select, como
// o PostgREST: sem `status` no select, a cotação entraria como comprada.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const db = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {}
  const selects: string[] = []
  return { rows, selects }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        db.selects.push(`${table}:${columns}`)
        const keep = columns.split(',').map(c => c.trim())
        const data = (db.rows[table] ?? []).map(row => Object.fromEntries(keep.map(k => [k, row[k]])))
        return Promise.resolve({ data, error: null })
      },
    }),
  },
}))

import { useAllocationSummary, type AllocationSummary } from './useAllocationSummary'

let root: Root | null = null
let summary: AllocationSummary | null = null

function Probe() {
  const s = useAllocationSummary('u1')
  useEffect(() => { summary = s })
  return null
}

async function render() {
  root = createRoot(document.createElement('div'))
  await act(async () => { root!.render(<Probe />) })
  await act(async () => { await Promise.resolve() })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  summary = null
  db.selects = []
})

describe('useAllocationSummary: capital parado', () => {
  it('compra em cotação não entra (igual à Loja): 2 × 100,00, e não mais 5 × 999,99', async () => {
    db.rows = {
      finance_store_products: [{ id: 'p1', archived: false, name: 'SSD' }],
      finance_store_purchases: [
        { product_id: 'p1', quantity: 2, unit_cost: 10_000, other_costs: 0, status: 'received' },
        { product_id: 'p1', quantity: 5, unit_cost: 99_999, other_costs: 0, status: 'quoting' },
      ],
      finance_store_sale_items: [],
      finance_store_sales: [],
    }
    await render()
    expect(summary?.loading).toBe(false)
    expect(summary?.stockCapital).toBe(20_000)
    expect(db.selects).toContain('finance_store_purchases:product_id,quantity,unit_cost,other_costs,status')
  })

  it('a cotação que vira compra passa a contar no reload', async () => {
    db.rows = {
      finance_store_products: [{ id: 'p1', archived: false }],
      finance_store_purchases: [{ product_id: 'p1', quantity: 3, unit_cost: 1_000, other_costs: 300, status: 'quoting' }],
      finance_store_sale_items: [],
      finance_store_sales: [],
    }
    await render()
    expect(summary?.stockCapital).toBe(0)
    db.rows.finance_store_purchases[0].status = 'purchased'
    await act(async () => { await summary!.reload() })
    expect(summary?.stockCapital).toBe(3 * 1_100)
  })
})

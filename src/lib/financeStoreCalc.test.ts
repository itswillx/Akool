import { describe, expect, it } from 'vitest'
import * as domain from '../../supabase/functions/_domain/financeStoreCalc'
import type { FinanceStoreSale } from '../types'
import * as calc from './financeStoreCalc'
import { customerHistory, saleCreatedDayLocal } from './financeStoreCalc'

// API-028: os cálculos da Loja moram em supabase/functions/_domain/
// financeStoreCalc.ts, com os testes ao lado (e a paridade com o SQL em
// _domain/storeParity.test.ts). Aqui fica o que é do app: os nomes que os
// consumidores importam e o wrapper do customerHistory com o dia local. Os
// fusos ficam em src/lib/storeDomain.test.ts.

const sale = (over: Partial<FinanceStoreSale> = {}): FinanceStoreSale => ({
  id: 's1', user_id: 'u1', workspace_id: null, customer_id: 'k1', status: 'negotiating', channel: 'olx',
  sold_on: null, shipping_method: '', tracking_code: '', expected_delivery_on: null, delivered_on: null,
  shipping_charged: 0, shipping_cost: 0, fees: 0, account_id: null, transaction_id: null,
  notes: '', attachments: [], created_at: '2026-07-01T12:00:00Z', updated_at: '2026-07-01T12:00:00Z', ...over,
})

describe('reexportação', () => {
  it('os nomes que os consumidores importam são as funções do _domain', () => {
    const names = [
      'averageUnitCost', 'customerStats', 'monthAggregates', 'productStock', 'purchaseTotal',
      'saleItemsTotal', 'saleNetReceived', 'saleProfit', 'saleRevenue', 'stockCapital', 'uniqueItemState',
    ] as const
    for (const name of names) expect(calc[name], name).toBe(domain[name])
  })
})

describe('customerHistory no app', () => {
  it('ordena da mais recente para a mais antiga e devolve a linha inteira do app', () => {
    const sales = [
      sale({ id: 'antiga', status: 'delivered', sold_on: '2026-06-01' }),
      sale({ id: 'nova', status: 'sold', sold_on: '2026-07-10' }),
      sale({ id: 'outro-cliente', customer_id: 'k2', sold_on: '2026-07-11' }),
    ]
    const history = customerHistory('k1', sales)
    expect(history.map(s => s.id)).toEqual(['nova', 'antiga'])
    expect(history[0]).toBe(sales[1])
  })

  it('o dia de criação vem de saleCreatedDayLocal (o fuso do aparelho) ou de quem chama', () => {
    const createdAt = '2026-07-20T12:00:00Z'
    expect(saleCreatedDayLocal(createdAt)).toMatch(/^2026-07-(19|20|21)$/)
    const calls: string[] = []
    const dayOf = (c: string) => { calls.push(c); return '2026-07-15' }
    expect(customerHistory('k1', [sale({ id: 'a', created_at: createdAt }), sale({ id: 'b', sold_on: '2026-07-16' })], dayOf).map(s => s.id))
      .toEqual(['b', 'a'])
    // Só a venda sem sold_on passa pelo dia de criação.
    expect(new Set(calls)).toEqual(new Set([createdAt]))
  })
})

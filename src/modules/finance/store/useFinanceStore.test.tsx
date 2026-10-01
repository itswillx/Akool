// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FinanceStoreProduct, FinanceStorePurchase, FinanceStoreSale, FinanceStoreSaleItem } from '../../../types'

// QA-001: carga da Loja e o vínculo com o fluxo de caixa (uma receita por
// venda, uma despesa por compra), com um supabase falso que registra cada
// escrita (tabela, operação, payload e filtros).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string } | null }
type Call = { table: string; op: Op; payload: unknown; filters: string[] }

const db = vi.hoisted(() => {
  const results: Record<string, Res | 'reject'> = {}
  return { results, calls: [] as Call[] }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ remove: () => Promise.resolve({ data: [], error: null }) }) },
    from: (table: string) => {
      const call: Call = { table, op: 'select', payload: undefined, filters: [] }
      const b = {
        select: () => b, order: () => b, single: () => b,
        eq: (column: string, value: unknown) => { call.filters.push(`${column}=${String(value)}`); return b },
        insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return b },
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return b },
        delete: () => { call.op = 'delete'; return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(call)
          const result = db.results[`${table}:${call.op}`] ?? { data: [], error: null }
          const promise = result === 'reject' ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(result)
          return promise.then(resolve, reject)
        },
      }
      return b
    },
  },
}))

import { TRANSACTIONS_CHANGED_EVENT, useFinanceStore } from './useFinanceStore'

const product = (id: string, attachments: unknown = []): FinanceStoreProduct => ({
  id, user_id: 'u1', workspace_id: null, kind: 'unique', name: id, category: 'GPU', condition: 'used',
  serial_number: '', notes: '', target_price: 0, archived: false,
  attachments: attachments as FinanceStoreProduct['attachments'], created_at: '', updated_at: '',
})
const purchase = (id: string, extra: Partial<FinanceStorePurchase> = {}): FinanceStorePurchase => ({
  id, user_id: 'u1', workspace_id: null, product_id: 'p1', supplier_id: null, status: 'purchased',
  quantity: 2, unit_cost: 10_000, other_costs: 1_500, date: '2026-09-01', account_id: 'acc',
  transaction_id: null, notes: '', attachments: [], created_at: '', updated_at: '', ...extra,
})
const sale = (id: string, extra: Partial<FinanceStoreSale> = {}): FinanceStoreSale => ({
  id, user_id: 'u1', workspace_id: null, customer_id: null, status: 'negotiating', channel: 'olx',
  sold_on: null, shipping_method: '', tracking_code: '', expected_delivery_on: null, delivered_on: null,
  shipping_charged: 2_000, shipping_cost: 0, fees: 500, account_id: 'acc', transaction_id: null,
  notes: '', attachments: [], created_at: '', updated_at: '', ...extra,
})
const item = (id: string, saleId: string): FinanceStoreSaleItem => ({
  id, user_id: 'u1', workspace_id: null, sale_id: saleId, product_id: 'p1', product_name: 'GPU',
  quantity: 1, unit_price: 30_000, unit_cost_at_sale: 20_000, created_at: '', updated_at: '',
})

let hook: ReturnType<typeof useFinanceStore>
const capture = (value: ReturnType<typeof useFinanceStore>) => { hook = value }
function Probe() {
  const value = useFinanceStore('u1', null)
  useEffect(() => { capture(value) })
  return null
}

let container: HTMLDivElement
let root: Root
const render = () => act(async () => { root.render(<Probe />) })
const writes = (table: string, op: Op) => db.calls.filter(c => c.table === table && c.op === op)
let txEvents = 0
const onTxChanged = () => { txEvents++ }

beforeEach(() => {
  for (const key of Object.keys(db.results)) delete db.results[key]
  db.calls = []
  txEvents = 0
  window.addEventListener(TRANSACTIONS_CHANGED_EVENT, onTxChanged)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, onTxChanged)
})

describe('useFinanceStore: carga', () => {
  it('carrega tudo e troca anexos nulos por lista vazia', async () => {
    db.results['finance_store_products:select'] = { data: [product('p1', null)], error: null }
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1')], error: null }
    await render()
    expect(hook.loading).toBe(false)
    expect(hook.error).toBeNull()
    expect(hook.products[0].attachments).toEqual([])
    expect(hook.purchases.map(p => p.id)).toEqual(['pu1'])
  })

  it('erro numa tabela aparece em `error` e o resto carrega', async () => {
    db.results['finance_store_products:select'] = { data: [product('p1')], error: null }
    db.results['finance_store_sales:select'] = { data: null, error: { message: 'permission denied' } }
    await render()
    expect(hook.loading).toBe(false)
    expect(hook.error).toBe('permission denied')
    expect(hook.products.map(p => p.id)).toEqual(['p1'])
  })

  it('rede caída não prende em "Carregando"', async () => {
    db.results['finance_suppliers:select'] = 'reject'
    await render()
    expect(hook.loading).toBe(false)
    expect(hook.error).toBe('Failed to fetch')
  })
})

describe('useFinanceStore: compra e despesa vinculada', () => {
  it('compra com lançamento cria a despesa (qtd × custo + frete) e guarda o vínculo', async () => {
    await render()
    db.results['finance_transactions:insert'] = { data: { id: 'tx1' }, error: null }
    db.results['finance_store_purchases:insert'] = { data: purchase('pu1', { transaction_id: 'tx1' }), error: null }
    const p = purchase('x')
    const form = {
      product_id: p.product_id, supplier_id: p.supplier_id, status: p.status, quantity: p.quantity, unit_cost: p.unit_cost,
      other_costs: p.other_costs, date: p.date, account_id: p.account_id, notes: p.notes, attachments: p.attachments,
    }
    await act(async () => { await hook.createPurchase(form, { createTransaction: true, description: 'GPU' }) })
    const [tx] = writes('finance_transactions', 'insert')
    expect(tx.payload).toMatchObject({ type: 'expense', amount: 2 * 10_000 + 1_500, account_id: 'acc', date: '2026-09-01' })
    expect(writes('finance_store_purchases', 'insert')[0].payload).toMatchObject({ transaction_id: 'tx1' })
    expect(hook.purchases[0].transaction_id).toBe('tx1')
    expect(txEvents).toBe(1)
  })

  it('voltar a compra para cotação apaga a despesa e o vínculo', async () => {
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1', { transaction_id: 'tx1' })], error: null }
    await render()
    await act(async () => { await hook.updatePurchase('pu1', { status: 'quoting' }) })
    expect(writes('finance_store_purchases', 'update')[0].payload).toMatchObject({ status: 'quoting', transaction_id: null })
    expect(writes('finance_transactions', 'delete')[0].filters).toEqual(['id=tx1'])
    expect(hook.purchases[0].transaction_id).toBeNull()
  })

  it('mudar o custo de uma compra lançada atualiza o valor da despesa', async () => {
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1', { transaction_id: 'tx1' })], error: null }
    await render()
    await act(async () => { await hook.updatePurchase('pu1', { unit_cost: 12_000 }) })
    expect(writes('finance_transactions', 'update')[0].payload).toEqual({ amount: 2 * 12_000 + 1_500, date: '2026-09-01' })
  })
})

describe('useFinanceStore: venda e receita vinculada', () => {
  it('marcar vendida com lançamento cria a receita líquida (itens + frete cobrado − taxas)', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1')], error: null }
    db.results['finance_store_sale_items:select'] = { data: [item('i1', 's1')], error: null }
    await render()
    db.results['finance_transactions:insert'] = { data: { id: 'tx9' }, error: null }
    await act(async () => { await hook.setSaleStatus('s1', 'sold', { createTransaction: true, date: '2026-09-10' }) })
    expect(writes('finance_transactions', 'insert')[0].payload).toMatchObject({
      type: 'income', amount: 30_000 + 2_000 - 500, date: '2026-09-10',
    })
    expect(hook.sales[0]).toMatchObject({ status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx9' })
  })

  it('cancelar venda lançada apaga a receita', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx9' })], error: null }
    await render()
    await act(async () => { await hook.setSaleStatus('s1', 'cancelled') })
    expect(writes('finance_transactions', 'delete')[0].filters).toEqual(['id=tx9'])
    expect(writes('finance_store_sales', 'update')[0].payload).toMatchObject({ status: 'cancelled', transaction_id: null })
    expect(hook.sales[0].transaction_id).toBeNull()
  })

  it('reabrir para negociação limpa as datas', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { status: 'delivered', sold_on: '2026-09-10', delivered_on: '2026-09-12' })], error: null }
    await render()
    await act(async () => { await hook.setSaleStatus('s1', 'negotiating') })
    expect(hook.sales[0]).toMatchObject({ status: 'negotiating', sold_on: null, delivered_on: null })
  })
})

describe('useFinanceStore: erro de escrita', () => {
  it('update recusado aparece em `error`', async () => {
    db.results['finance_store_products:select'] = { data: [product('p1')], error: null }
    await render()
    db.results['finance_store_products:update'] = { data: null, error: { message: 'permission denied' } }
    await act(async () => { await hook.updateProduct('p1', { name: 'novo' }) })
    expect(hook.error).toBe('permission denied')
  })
})

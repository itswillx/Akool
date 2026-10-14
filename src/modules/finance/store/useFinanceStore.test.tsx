// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FinanceStoreProduct, FinanceStorePurchase, FinanceStoreSale, FinanceStoreSaleItem } from '../../../types'

// QA-001: carga da Loja e o vínculo com o fluxo de caixa (uma receita por
// venda, uma despesa por compra), com um supabase falso que registra cada
// escrita (tabela, operação, payload e filtros) e cada RPC.
//
// API-028: as vendas vão pelas RPCs store_sale_*: o hook não grava mais em
// finance_transactions nem em finance_store_sales/sale_items, manda os
// parâmetros da RPC e adota a venda, os itens e o aviso de receita que voltam.
// A recusa vira um texto traduzido em `error` e a ação devolve false.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string; code?: string } | null }
type Call = { table: string; op: Op; payload: unknown; filters: string[] }

const db = vi.hoisted(() => {
  const results: Record<string, Res | 'reject'> = {}
  const rpcResults: Record<string, Res> = {}
  return { results, calls: [] as Call[], rpcs: [] as [string, unknown][], rpcResults }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ remove: (paths: string[]) => { db.calls.push({ table: 'storage', op: 'delete', payload: paths, filters: [] }); return Promise.resolve({ data: [], error: null }) } }) },
    rpc: (name: string, args: unknown) => {
      db.rpcs.push([name, args])
      return Promise.resolve(db.rpcResults[name] ?? { data: null, error: null })
    },
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
          // O CHECK amount > 0 de finance_transactions, como no banco.
          const amount = (call.payload as { amount?: unknown } | undefined)?.amount
          if (table === 'finance_transactions' && typeof amount === 'number' && amount <= 0) {
            return Promise.resolve({ data: null, error: { code: '23514', message: 'new row for relation "finance_transactions" violates check constraint "finance_transactions_amount_check"' } }).then(resolve, reject)
          }
          const result = db.results[`${table}:${call.op}`] ?? { data: [], error: null }
          const promise = result === 'reject' ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(result)
          return promise.then(resolve, reject)
        },
      }
      return b
    },
  },
}))

import { useFinanceStore } from './useFinanceStore'

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
let noUser = false
const capture = (value: ReturnType<typeof useFinanceStore>) => { hook = value }
function Probe() {
  const value = useFinanceStore(noUser ? undefined : 'u1', null)
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
  for (const key of Object.keys(db.rpcResults)) delete db.rpcResults[key]
  db.calls = []
  db.rpcs = []
  noUser = false
  txEvents = 0
  window.addEventListener('finance_transactions_changed', onTxChanged)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.removeEventListener('finance_transactions_changed', onTxChanged)
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

// #13 da revisão do API-028: com o CHECK de dinheiro >= 0, a compra ou o
// produto com valor negativo é recusado (23514). A despesa lançada antes da
// compra não pode ficar órfã, a edição recusada volta a tela, e o motivo sai
// traduzido.
describe('useFinanceStore: compra e produto recusados pelo banco (API-028)', () => {
  const refused = { data: null, error: { code: '23514', message: 'new row for relation "finance_store_purchases" violates check constraint "finance_store_purchases_money_nonneg"' } }
  const negative = 'Valores em dinheiro não podem ser negativos.'
  const form = () => {
    const p = purchase('x', { other_costs: -200 })
    return {
      product_id: p.product_id, supplier_id: p.supplier_id, status: p.status, quantity: p.quantity, unit_cost: p.unit_cost,
      other_costs: p.other_costs, date: p.date, account_id: p.account_id, notes: p.notes, attachments: p.attachments,
    }
  }

  it('compra recusada com despesa lançada: a despesa é apagada, nada fica na tela e o motivo sai traduzido', async () => {
    await render()
    db.results['finance_transactions:insert'] = { data: { id: 'tx1' }, error: null }
    db.results['finance_store_purchases:insert'] = refused
    let row: FinanceStorePurchase | null = purchase('z')
    await act(async () => { row = await hook.createPurchase(form(), { createTransaction: true, description: 'GPU' }) })
    expect(row).toBeNull()
    expect(writes('finance_transactions', 'insert')).toHaveLength(1)
    expect(writes('finance_transactions', 'delete').map(c => c.filters)).toEqual([['id=tx1']])
    expect(hook.purchases).toEqual([])
    expect(hook.error).toBe(negative)
    // O lançamento e a remoção: Transações recarrega e não mostra a órfã.
    expect(txEvents).toBe(2)
  })

  it('compra recusada sem despesa: nada a desfazer em Finanças', async () => {
    await render()
    db.results['finance_store_purchases:insert'] = refused
    await act(async () => { await hook.createPurchase(form()) })
    expect(db.calls.filter(c => c.table === 'finance_transactions')).toEqual([])
    expect(hook.error).toBe(negative)
  })

  it('edição de compra recusada: devolve false, a tela volta e a despesa vinculada não muda', async () => {
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1', { transaction_id: 'tx1' })], error: null }
    await render()
    db.results['finance_store_purchases:update'] = refused
    let ok = true
    await act(async () => { ok = await hook.updatePurchase('pu1', { other_costs: -200 }) })
    expect(ok).toBe(false)
    expect(hook.purchases[0].other_costs).toBe(1_500)
    expect(db.calls.filter(c => c.table === 'finance_transactions')).toEqual([])
    expect(hook.error).toBe(negative)
  })

  it('produto: criar recusado devolve null; editar recusado devolve false e volta o preço', async () => {
    db.results['finance_store_products:select'] = { data: [product('p1')], error: null }
    await render()
    const productRefused = { data: null, error: { code: '23514', message: 'new row for relation "finance_store_products" violates check constraint "finance_store_products_money_nonneg"' } }
    db.results['finance_store_products:insert'] = productRefused
    db.results['finance_store_products:update'] = productRefused
    const p = product('n')
    let created: FinanceStoreProduct | null = p
    await act(async () => {
      created = await hook.createProduct({ kind: p.kind, name: 'N', category: '', condition: 'used', serial_number: '', notes: '', target_price: -1, attachments: [] })
    })
    expect(created).toBeNull()
    expect(hook.error).toBe(negative)
    let ok = true
    await act(async () => { ok = await hook.updateProduct('p1', { target_price: -1 }) })
    expect(ok).toBe(false)
    expect(hook.products.map(x => [x.id, x.target_price])).toEqual([['p1', 0]])
  })
})

// #11 da 2ª revisão do API-028: a despesa precisa de valor > 0 (CHECK de
// finance_transactions). Compra de total zero não lança despesa, a compra
// lançada não vai a zero, e a recusa da despesa conta como falha, traduzida.
describe('useFinanceStore: despesa de valor zero e despesa recusada', () => {
  const expenseNotPositive = 'A despesa vinculada precisa de valor maior que zero. Para zerar a compra, apague antes a despesa em Transações.'
  const denied = 'Sem permissão para esta ação.'
  const formOf = (p: FinanceStorePurchase) => ({
    product_id: p.product_id, supplier_id: p.supplier_id, status: p.status, quantity: p.quantity, unit_cost: p.unit_cost,
    other_costs: p.other_costs, date: p.date, account_id: p.account_id, notes: p.notes, attachments: p.attachments,
  })

  it('compra nova de total zero com despesa pedida: grava a compra sem despesa', async () => {
    await render()
    db.results['finance_store_purchases:insert'] = { data: purchase('pu1', { unit_cost: 0, other_costs: 0 }), error: null }
    let row: FinanceStorePurchase | null = null
    await act(async () => { row = await hook.createPurchase(formOf(purchase('x', { unit_cost: 0, other_costs: 0 })), { createTransaction: true, description: 'GPU' }) })
    expect(row).toMatchObject({ id: 'pu1' })
    expect(db.calls.filter(c => c.table === 'finance_transactions')).toEqual([])
    expect(writes('finance_store_purchases', 'insert')[0].payload).toMatchObject({ transaction_id: null })
    expect(hook.error).toBeNull()
  })

  it('compra lançada editada para total zero: recusa antes de gravar, com o motivo traduzido', async () => {
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1', { transaction_id: 'tx1' }), purchase('pu2')], error: null }
    await render()
    let ok = true
    await act(async () => { ok = await hook.updatePurchase('pu1', { unit_cost: 0, other_costs: 0 }) })
    expect(ok).toBe(false)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
    expect(hook.purchases[0]).toMatchObject({ unit_cost: 10_000, other_costs: 1_500, transaction_id: 'tx1' })
    expect(hook.error).toBe(expenseNotPositive)
    // Sem despesa vinculada, o custo zero passa (brinde, troca).
    await act(async () => { ok = await hook.updatePurchase('pu2', { unit_cost: 0, other_costs: 0 }) })
    expect(ok).toBe(true)
    expect(writes('finance_store_purchases', 'update').map(c => c.filters)).toEqual([['id=pu2']])
    expect(txEvents).toBe(0)
  })

  // 3ª revisão do lote 06: a compra já com total zero e despesa (gravada
  // antes da trava, ou por escrita direta) ainda muda de fase e de notas; a
  // despesa só recebe a data, nunca o valor zero que o banco recusaria.
  it('compra antiga de total zero com despesa: muda de fase e de notas sem mandar valor à despesa', async () => {
    db.results['finance_store_purchases:select'] = {
      data: [purchase('pu1', { status: 'purchased', unit_cost: 0, other_costs: 0, transaction_id: 'tx1' })], error: null,
    }
    await render()
    let ok = false
    await act(async () => { ok = await hook.updatePurchase('pu1', { status: 'received' }) })
    expect(ok).toBe(true)
    await act(async () => { ok = await hook.updatePurchase('pu1', { notes: 'caixa amassada' }) })
    expect(ok).toBe(true)
    expect(writes('finance_store_purchases', 'update').map(c => c.payload)).toEqual([{ status: 'received' }, { notes: 'caixa amassada' }])
    expect(writes('finance_transactions', 'update').map(c => c.payload)).toEqual([{ date: '2026-09-01' }, { date: '2026-09-01' }])
    expect(hook.purchases[0]).toMatchObject({ status: 'received', notes: 'caixa amassada', transaction_id: 'tx1' })
    expect(hook.error).toBeNull()
    // Dar custo de novo leva o valor à despesa.
    await act(async () => { ok = await hook.updatePurchase('pu1', { unit_cost: 5_000 }) })
    expect(ok).toBe(true)
    expect(writes('finance_transactions', 'update').at(-1)?.payload).toEqual({ amount: 2 * 5_000, date: '2026-09-01' })
  })

  it('despesa recusada no lançamento: a compra não grava e o motivo sai traduzido', async () => {
    await render()
    db.results['finance_transactions:insert'] = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "finance_transactions"' } }
    let row: FinanceStorePurchase | null = purchase('z')
    await act(async () => { row = await hook.createPurchase(formOf(purchase('x')), { createTransaction: true, description: 'GPU' }) })
    expect(row).toBeNull()
    expect(writes('finance_transactions', 'insert')).toHaveLength(1)
    expect(writes('finance_store_purchases', 'insert')).toEqual([])
    expect(hook.purchases).toEqual([])
    expect(hook.error).toBe(denied)
    expect(txEvents).toBe(0)
  })

  it('despesa recusada na edição: devolve false com o motivo traduzido; a compra fica gravada', async () => {
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1', { transaction_id: 'tx1' })], error: null }
    await render()
    for (const [error, text] of [
      [{ code: '42501', message: 'permission denied for table finance_transactions' }, denied],
      [{ code: '23514', message: 'new row for relation "finance_transactions" violates check constraint "finance_transactions_amount_check"' }, expenseNotPositive],
    ] as const) {
      db.results['finance_transactions:update'] = { data: null, error }
      let ok = true
      await act(async () => { ok = await hook.updatePurchase('pu1', { unit_cost: 12_000 }) })
      expect(ok).toBe(false)
      expect(hook.error).toBe(text)
    }
    expect(writes('finance_store_purchases', 'update')).toHaveLength(2)
    expect(hook.purchases[0].unit_cost).toBe(12_000)
    expect(txEvents).toBe(0)
  })
})

describe('useFinanceStore: venda pelas RPCs (API-028)', () => {
  const noDirectSaleWrites = () => {
    expect(db.calls.filter(c => c.op !== 'select' && c.table !== 'storage')).toEqual([])
  }

  it('cria a venda com os itens numa chamada, no workspace do painel, e adota o que volta', async () => {
    await render()
    db.rpcResults.store_sale_create = { data: { sale: sale('s1'), items: [item('i1', 's1')] }, error: null }
    const s = sale('x')
    const form = {
      customer_id: s.customer_id, channel: s.channel, shipping_method: '', tracking_code: '', expected_delivery_on: '',
      shipping_charged: s.shipping_charged, shipping_cost: 0, fees: s.fees, account_id: 'acc', notes: '', attachments: [],
    }
    let created: FinanceStoreSale | null = null
    await act(async () => { created = await hook.createSale(form, [{ product_id: 'p1', quantity: 1, unit_price: 30_000 }]) })
    expect(db.rpcs).toEqual([['store_sale_create', {
      p_sale: { ...form, expected_delivery_on: null, workspace_id: null, items: [{ product_id: 'p1', quantity: 1, unit_price: 30_000 }] },
    }]])
    expect(created).toMatchObject({ id: 's1' })
    expect(hook.sales.map(x => x.id)).toEqual(['s1'])
    expect(hook.saleItems.map(x => x.id)).toEqual(['i1'])
    noDirectSaleWrites()
  })

  it('marcar vendida com receita: a RPC leva data, categoria e descrição; Transações recarrega', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1')], error: null }
    db.results['finance_store_sale_items:select'] = { data: [item('i1', 's1')], error: null }
    await render()
    db.rpcResults.store_sale_set_status = {
      data: { sale: sale('s1', { status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx9' }), transaction: { id: 'tx9' }, transaction_changed: true },
      error: null,
    }
    let ok = false
    await act(async () => { ok = await hook.setSaleStatus('s1', 'sold', { createTransaction: true, date: '2026-09-10', categoryId: 'c1', description: 'Venda: GPU' }) })
    expect(ok).toBe(true)
    expect(db.rpcs[0][0]).toBe('store_sale_set_status')
    expect(db.rpcs[0][1]).toMatchObject({ p_sale: 's1', p_status: 'sold', p_create_income: true, p_sold_on: '2026-09-10', p_category: 'c1', p_description: 'Venda: GPU' })
    expect(hook.sales[0]).toMatchObject({ status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx9' })
    expect(hook.saleItems.map(i => i.id)).toEqual(['i1'])
    expect(txEvents).toBe(1)
    noDirectSaleWrites()
  })

  it('recusa do servidor: devolve false, não mexe na venda e traduz o motivo', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { status: 'delivered', sold_on: '2026-09-10', delivered_on: '2026-09-12' })], error: null }
    await render()
    db.rpcResults.store_sale_set_status = { data: null, error: { code: 'P0001', message: 'Mudança de status não permitida: delivered → negotiating' } }
    let ok = true
    await act(async () => { ok = await hook.setSaleStatus('s1', 'negotiating') })
    expect(ok).toBe(false)
    expect(hook.sales[0]).toMatchObject({ status: 'delivered', delivered_on: '2026-09-12' })
    expect(hook.error).toBe('Essa mudança de status não é permitida: avance ou volte um passo por vez.')
    expect(txEvents).toBe(0)
  })

  it('cancelar: a receita apagada no servidor avisa Transações; nada de DELETE do navegador', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx9' })], error: null }
    await render()
    db.rpcResults.store_sale_set_status = { data: { sale: sale('s1', { status: 'cancelled', sold_on: '2026-09-10' }), transaction: null, transaction_changed: true }, error: null }
    await act(async () => { await hook.setSaleStatus('s1', 'cancelled') })
    expect(hook.sales[0]).toMatchObject({ status: 'cancelled', transaction_id: null })
    expect(txEvents).toBe(1)
    noDirectSaleWrites()
  })

  it('update, itens e receita depois do fato adotam a resposta; sem mudança na receita, Transações não recarrega', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { status: 'sold', sold_on: '2026-09-10' })], error: null }
    db.results['finance_store_sale_items:select'] = { data: [item('i1', 's1'), item('i9', 's9')], error: null }
    await render()
    const two = [item('i1', 's1'), item('i2', 's1')]
    db.rpcResults.store_sale_update = { data: { sale: sale('s1', { status: 'sold', sold_on: '2026-09-11', fees: 900 }), transaction: null, transaction_changed: false }, error: null }
    db.rpcResults.store_sale_items_add = { data: { sale: sale('s1', { status: 'sold' }), items: two, transaction: null, transaction_changed: false }, error: null }
    db.rpcResults.store_sale_items_update = { data: { sale: sale('s1', { status: 'sold' }), items: two, transaction: { id: 'tx' }, transaction_changed: true }, error: null }
    db.rpcResults.store_sale_items_remove = { data: { sale: sale('s1', { status: 'sold' }), items: [item('i2', 's1')], transaction: null, transaction_changed: false }, error: null }
    db.rpcResults.store_sale_generate_income = { data: { sale: sale('s1', { status: 'sold', transaction_id: 'tx' }), transaction: { id: 'tx' }, created: true }, error: null }
    await act(async () => { expect(await hook.updateSale('s1', { fees: 900, sold_on: '2026-09-11' })).toBe(true) })
    expect(hook.sales[0]).toMatchObject({ fees: 900, sold_on: '2026-09-11' })
    expect(txEvents).toBe(0)
    await act(async () => { expect(await hook.addSaleItems('s1', [{ product_id: 'p1', quantity: 1, unit_price: 100 }])).toBe(true) })
    expect(hook.saleItems.map(i => i.id).sort()).toEqual(['i1', 'i2', 'i9'])
    await act(async () => { expect(await hook.updateSaleItem('i2', { unit_price: 200 })).toBe(true) })
    expect(txEvents).toBe(1)
    await act(async () => { expect(await hook.removeSaleItem('i1')).toBe(true) })
    expect(hook.saleItems.map(i => i.id).sort()).toEqual(['i2', 'i9'])
    await act(async () => { expect(await hook.generateSaleIncome('s1', 'Venda: GPU', 'c1')).toBe(true) })
    expect(hook.sales[0].transaction_id).toBe('tx')
    expect(txEvents).toBe(2)
    expect(db.rpcs.map(([name]) => name)).toEqual([
      'store_sale_update', 'store_sale_items_add', 'store_sale_items_update', 'store_sale_items_remove', 'store_sale_generate_income',
    ])
    expect(db.rpcs[4][1]).toEqual({ p_sale: 's1', p_category: 'c1', p_description: 'Venda: GPU' })
    // Lista vazia não chama o servidor.
    await act(async () => { expect(await hook.addSaleItems('s1', [])).toBe(true) })
    expect(db.rpcs).toHaveLength(5)
    noDirectSaleWrites()
  })

  it('erros das RPCs de item e do update viram false com o texto traduzido', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1')], error: null }
    await render()
    db.rpcResults.store_sale_items_add = { data: null, error: { code: 'P0001', message: 'items/0: Estoque insuficiente: GPU tem 0 disponível(is)' } }
    db.rpcResults.store_sale_items_update = { data: null, error: { code: '22023', message: 'items/0: Item único vende 1 unidade: GPU' } }
    db.rpcResults.store_sale_items_remove = { data: null, error: { code: 'P0002', message: 'Item não encontrado' } }
    db.rpcResults.store_sale_update = { data: null, error: { code: '22023', message: 'O líquido da venda ficaria zero ou negativo com a receita lançada: remova a receita antes' } }
    db.rpcResults.store_sale_generate_income = { data: null, error: { code: '22023', message: 'A venda precisa de uma conta para lançar a receita' } }
    await act(async () => { expect(await hook.addSaleItems('s1', [{ product_id: 'p1', quantity: 1 }])).toBe(false) })
    expect(hook.error).toBe('Estoque insuficiente: GPU tem 0 disponível(is).')
    await act(async () => { expect(await hook.updateSaleItem('i1', { quantity: 2 })).toBe(false) })
    expect(hook.error).toBe('Item único vende 1 unidade.')
    await act(async () => { expect(await hook.removeSaleItem('i1')).toBe(false) })
    expect(hook.error).toMatch(/^A venda, o item/)
    await act(async () => { expect(await hook.updateSale('s1', { fees: 1 })).toBe(false) })
    expect(hook.error).toMatch(/^O líquido da venda/)
    await act(async () => { expect(await hook.generateSaleIncome('s1', '')).toBe(false) })
    expect(hook.error).toBe('Defina a conta da venda para lançar a receita.')
    db.rpcResults.store_sale_create = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    let created: FinanceStoreSale | null = sale('z')
    await act(async () => { created = await hook.createSale({ ...sale('z'), attachments: [] }, [{ product_id: 'p1', quantity: 1 }]) })
    expect(created).toBeNull()
    expect(hook.error).toMatch(/^O servidor ainda não tem/)
    expect(hook.sales.map(s => s.id)).toEqual(['s1'])
  })

  it('excluir: o banco primeiro, depois os anexos que a RPC devolve; a receita apagada avisa Transações', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { transaction_id: 'tx9', status: 'sold', sold_on: '2026-09-10' })], error: null }
    db.results['finance_store_sale_items:select'] = { data: [item('i1', 's1')], error: null }
    await render()
    db.rpcResults.store_sale_delete = { data: { sale_id: 's1', transaction_deleted: true, attachments: [{ path: 'u1/nota.pdf' }] }, error: null }
    await act(async () => { expect(await hook.deleteSale('s1')).toBe(true) })
    expect(db.rpcs).toEqual([['store_sale_delete', { p_sale: 's1' }]])
    expect(db.calls.filter(c => c.table === 'storage')).toEqual([{ table: 'storage', op: 'delete', payload: ['u1/nota.pdf'], filters: [] }])
    expect(hook.sales).toEqual([])
    expect(hook.saleItems).toEqual([])
    expect(txEvents).toBe(1)
  })

  it('excluir recusado: a venda e os anexos ficam', async () => {
    db.results['finance_store_sales:select'] = { data: [sale('s1', { attachments: [{ id: 'f', path: 'u1/x.png', name: 'x', mime: 'image/png', size: 1, uploaded_at: '' }] })], error: null }
    await render()
    db.rpcResults.store_sale_delete = { data: null, error: { code: '42501', message: 'A receita vinculada é de outra pessoa: só ela pode apagar' } }
    await act(async () => { expect(await hook.deleteSale('s1')).toBe(false) })
    expect(hook.sales.map(s => s.id)).toEqual(['s1'])
    expect(db.calls.filter(c => c.table === 'storage')).toEqual([])
    expect(hook.error).toBe('A receita vinculada foi lançada por outra pessoa: só ela pode alterá-la ou apagá-la, em Transações. Peça a ela e tente de novo.')
  })

  it('sem usuário, criar venda não chama o servidor', async () => {
    noUser = true
    await render()
    let created: FinanceStoreSale | null = sale('z')
    await act(async () => { created = await hook.createSale({ ...sale('z'), attachments: [] }, []) })
    expect(created).toBeNull()
    expect(db.rpcs).toEqual([])
  })
})

describe('useFinanceStore: updated_at é do servidor (API-028)', () => {
  it('produto, compra e cliente não mandam o relógio do aparelho', async () => {
    db.results['finance_store_products:select'] = { data: [product('p1')], error: null }
    db.results['finance_store_purchases:select'] = { data: [purchase('pu1')], error: null }
    db.results['finance_store_customers:select'] = { data: [{ id: 'k1', name: 'K' }], error: null }
    await render()
    await act(async () => {
      await hook.updateProduct('p1', { name: 'novo' })
      await hook.updatePurchase('pu1', { notes: 'x' })
      await hook.updateCustomer('k1', { name: 'L' })
    })
    const updates = db.calls.filter(c => c.op === 'update')
    expect(updates.map(c => c.table)).toEqual(['finance_store_products', 'finance_store_purchases', 'finance_store_customers'])
    expect(updates.every(c => !('updated_at' in (c.payload as object)))).toBe(true)
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

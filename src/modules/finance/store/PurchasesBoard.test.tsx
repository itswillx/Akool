// @vitest-environment happy-dom
import { createElement, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, userEvent, waitFor } from '../../../test/rtl'
import type { KanbanBoardProps } from '../../../components/board'
import type { FinanceStoreProduct, FinanceStorePurchase } from '../../../types'

// #10 da 2ª revisão do API-028: "Marcar como comprado" no kanban, com "Gerar
// despesa" marcado, não lançava a despesa (o generatePurchaseExpense da closure
// do clique ainda via a compra em 'quoting'), e o modal fechava mesmo com a
// compra recusada. Agora o markPurchased lança a despesa a partir da compra
// que abriu o modal e grava status e vínculo num update só. Com o hook real,
// o PurchasesBoard real e um supabase falso que registra cada escrita.

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string; code?: string } | null }
type Call = { table: string; op: Op; payload: unknown; filters: string[] }

const db = vi.hoisted(() => {
  const results: Record<string, Res> = {}
  const calls: Call[] = []
  return { results, calls }
})
const board = vi.hoisted(() => {
  const state: { onMove?: KanbanBoardProps<FinanceStorePurchase>['onMove'] } = {}
  return state
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ remove: () => Promise.resolve({ data: [], error: null }) }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      const call: Call = { table, op: 'select', payload: undefined, filters: [] }
      const b = {
        select: () => b, order: () => b, single: () => b,
        eq: (column: string, value: unknown) => { call.filters.push(`${column}=${String(value)}`); return b },
        insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return b },
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return b },
        delete: () => { call.op = 'delete'; return b },
        then: (resolve: (v: unknown) => unknown) => {
          db.calls.push(call)
          return Promise.resolve(db.results[`${table}:${call.op}`] ?? { data: [], error: null }).then(resolve)
        },
      }
      return b
    },
  },
}))
vi.mock('../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }),
}))
// No celular, cada card tem o botão "avançar uma etapa".
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => true }))
// O board de verdade, guardando o onMove que o PurchasesBoard lhe passa.
vi.mock('../../../components/board', async importOriginal => {
  const mod = await importOriginal<typeof import('../../../components/board')>()
  return {
    ...mod,
    KanbanBoard: (props: KanbanBoardProps<FinanceStorePurchase>) => {
      board.onMove = props.onMove
      return createElement(mod.KanbanBoard<FinanceStorePurchase>, props)
    },
  }
})

const { useFinanceStore } = await import('./useFinanceStore')
const { PurchasesBoard } = await import('./PurchasesBoard')

const purchase = (over: Partial<FinanceStorePurchase> = {}): FinanceStorePurchase => ({
  id: 'pu1', user_id: 'u1', workspace_id: null, product_id: 'p1', supplier_id: null, status: 'quoting',
  quantity: 2, unit_cost: 10_000, other_costs: 1_500, date: '2026-10-10', account_id: 'acc',
  transaction_id: null, notes: '', attachments: [], created_at: '', updated_at: '', ...over,
})
const product: FinanceStoreProduct = {
  id: 'p1', user_id: 'u1', workspace_id: null, kind: 'stock', name: 'SSD', category: '', condition: 'new',
  serial_number: '', notes: '', target_price: 0, archived: false, attachments: [], created_at: '', updated_at: '',
}

let hook: ReturnType<typeof useFinanceStore>
function Harness() {
  const store = useFinanceStore('u1', null)
  useEffect(() => { hook = store })
  if (store.loading) return null
  return <PurchasesBoard store={store} categories={[]} onEdit={() => {}} />
}

const writes = (table: string, op: Op) => db.calls.filter(c => c.table === table && c.op === op)
let txEvents = 0
const onTxChanged = () => { txEvents++ }

beforeEach(() => {
  for (const key of Object.keys(db.results)) delete db.results[key]
  db.calls = []
  board.onMove = undefined
  txEvents = 0
  window.addEventListener('finance_transactions_changed', onTxChanged)
  try { localStorage.clear() } catch { /* sem storage: o board usa o padrão */ }
})
afterEach(() => { window.removeEventListener('finance_transactions_changed', onTxChanged) })

// Carrega as compras, avança a 1ª (quoting → purchased) e abre o modal.
async function openConfirm(rows: FinanceStorePurchase[]) {
  db.results['finance_store_purchases:select'] = { data: rows, error: null }
  db.results['finance_store_products:select'] = { data: [product], error: null }
  await act(async () => { render(<Harness />) })
  const user = userEvent.setup()
  await user.click((await screen.findAllByTitle('board_move_next'))[0])
  const dialog = await screen.findByRole('dialog')
  const confirm = screen.getAllByRole('button', { name: 'finance_store_purchase_confirm_title' }).at(-1)!
  return { user, dialog, confirm, box: screen.getByRole<HTMLInputElement>('checkbox') }
}

describe('PurchasesBoard: marcar como comprado (markPurchased)', () => {
  it('com "Gerar despesa": uma despesa de qtd × custo + outros, e status e vínculo num update só', async () => {
    db.results['finance_transactions:insert'] = { data: { id: 'tx1' }, error: null }
    const { user, box, confirm } = await openConfirm([purchase()])
    expect(box.checked).toBe(true)
    await user.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes('finance_transactions', 'insert').map(c => c.payload)).toEqual([expect.objectContaining({
      type: 'expense', amount: 2 * 10_000 + 1_500, account_id: 'acc', date: '2026-10-10', description: 'finance_store_tx_purchase_desc',
    })])
    expect(writes('finance_store_purchases', 'update').map(c => [c.payload, c.filters])).toEqual([
      [{ status: 'purchased', transaction_id: 'tx1' }, ['id=pu1']],
    ])
    expect(txEvents).toBe(1)
    expect(hook.purchases[0]).toMatchObject({ status: 'purchased', transaction_id: 'tx1' })
    expect(hook.error).toBeNull()
  })

  it('compra recusada: a despesa recém-lançada é apagada, o modal fica aberto com o motivo e a tela volta', async () => {
    db.results['finance_transactions:insert'] = { data: { id: 'tx1' }, error: null }
    db.results['finance_store_purchases:update'] = { data: null, error: { code: '42501', message: 'permission denied for table finance_store_purchases' } }
    const { user, dialog, confirm } = await openConfirm([purchase()])
    await user.click(confirm)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'finance_store_error_denied')
    expect(dialog.isConnected).toBe(true)
    expect(writes('finance_transactions', 'delete').map(c => c.filters)).toEqual([['id=tx1']])
    expect(hook.purchases[0]).toMatchObject({ status: 'quoting', transaction_id: null })
    // O lançamento e a remoção: Transações recarrega e não mostra a órfã.
    expect(txEvents).toBe(2)
    // Desistir fecha o modal.
    await user.click(screen.getByRole('button', { name: 'finance_cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('despesa recusada: nada é gravado na compra e o modal fica aberto com o motivo', async () => {
    db.results['finance_transactions:insert'] = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
    const { user, confirm } = await openConfirm([purchase()])
    await user.click(confirm)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'finance_store_error_denied')
    expect(writes('finance_store_purchases', 'update')).toEqual([])
    expect(hook.purchases[0].status).toBe('quoting')
    expect(txEvents).toBe(0)
  })

  it('total zero: "Gerar despesa" desligado, com a dica; confirmar só muda a fase', async () => {
    const { user, box, confirm } = await openConfirm([purchase({ unit_cost: 0, other_costs: 0 })])
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(true)
    expect(screen.getByText('finance_store_expense_not_positive_hint')).toBeTruthy()
    await user.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes('finance_transactions', 'insert')).toEqual([])
    expect(writes('finance_store_purchases', 'update').map(c => c.payload)).toEqual([{ status: 'purchased' }])
  })
})

describe('PurchasesBoard: as outras mudanças de fase', () => {
  it('devolvem ao kanban o ok real: recusada, false (o card volta)', async () => {
    db.results['finance_store_purchases:select'] = { data: [purchase({ status: 'purchased' })], error: null }
    await act(async () => { render(<Harness />) })
    const moved = hook.purchases[0]
    db.results['finance_store_purchases:update'] = { data: null, error: { code: '42501', message: 'permission denied' } }
    let ok: unknown
    await act(async () => { ok = await board.onMove!(moved, 'received') })
    expect(ok).toBe(false)
    expect(hook.purchases[0].status).toBe('purchased')
    delete db.results['finance_store_purchases:update']
    await act(async () => { ok = await board.onMove!(moved, 'received') })
    expect(ok).toBe(true)
    expect(hook.purchases[0].status).toBe('received')
  })

  it('compra antiga de total zero com despesa: o card anda, e a despesa recebe só a data', async () => {
    db.results['finance_store_purchases:select'] = {
      data: [purchase({ status: 'purchased', unit_cost: 0, other_costs: 0, transaction_id: 'tx1' })], error: null,
    }
    await act(async () => { render(<Harness />) })
    let ok: unknown
    await act(async () => { ok = await board.onMove!(hook.purchases[0], 'received') })
    expect(ok).toBe(true)
    expect(hook.purchases[0].status).toBe('received')
    expect(writes('finance_transactions', 'update').map(c => c.payload)).toEqual([{ date: '2026-10-10' }])
    expect(hook.error).toBeNull()
  })
})

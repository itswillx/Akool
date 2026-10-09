// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '../../test/rtl'
import type { FinanceRecurring, FinanceRecurringEntry, FinanceTransaction } from '../../types'
import type { useFinanceData } from './useFinanceData'
import type { useFinanceModals } from './useFinanceModals'

// API-016: pagar e pular são uma RPC só (sem as 3 gravações soltas nem a
// reconciliação de gravação parcial); o valor fixo ausente vai nulo (o servidor
// recusa) em vez de 0; salvar um recorrente ativo materializa no servidor e
// mescla o que voltou.

const db = vi.hoisted(() => {
  const calls: unknown[][] = []
  const state = {
    rpc: {} as Record<string, { data: unknown; error: unknown }>,
    save: { data: null as unknown, error: null as unknown },
  }
  return { calls, state, showToast: vi.fn() }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      db.calls.push(['rpc', name, args])
      return Promise.resolve(db.state.rpc[name] ?? { data: null, error: null })
    },
    from: (table: string) => {
      const single = () => Promise.resolve(db.state.save)
      return {
        insert: (values: unknown) => {
          db.calls.push(['insert', table, values])
          return { select: () => ({ single }) }
        },
        update: (values: unknown) => {
          db.calls.push(['update', table, values])
          return { eq: () => ({ select: () => ({ single }) }) }
        },
      }
    },
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'eu' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: db.showToast }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { useFinanceActions } = await import('./useFinanceActions')

const setRecurring = vi.fn()
const setRecurringEntries = vi.fn()
const applyTxUpsert = vi.fn()
const ensureMonthLoaded = vi.fn(() => Promise.resolve())
const applyMaterialized = vi.fn()
const setPayModal = vi.fn()

function renderActions(recurringModalItem: FinanceRecurring | null = null) {
  const data = { partnerProfiles: [], setRecurring, setRecurringEntries, applyTxUpsert, ensureMonthLoaded, applyMaterialized } as unknown as ReturnType<typeof useFinanceData>
  const modals = { recurringModal: { open: true, item: recurringModalItem }, setPayModal } as unknown as ReturnType<typeof useFinanceModals>
  return renderHook(() => useFinanceActions({ data, modals })).result.current
}

const rec = (extra: Partial<FinanceRecurring> = {}): FinanceRecurring => ({
  id: 'r1', user_id: 'eu', type: 'expense', description: 'Aluguel', amount: 8000, is_variable: false,
  category_id: 'c1', account_id: 'a1', day_of_month: 10, active: true, total_installments: 3,
  workspace_id: 'ws1', created_at: '2026-01-01T00:00:00Z', ...extra,
})
const entry = (extra: Partial<FinanceRecurringEntry> = {}): FinanceRecurringEntry => ({
  id: 'e1', user_id: 'eu', recurring_id: 'r1', due_date: '2026-10-10', status: 'pending', amount: null,
  transaction_id: null, created_at: '', ...extra,
})
const tx: FinanceTransaction = {
  id: 't1', user_id: 'eu', account_id: 'a1', category_id: 'c1', type: 'expense', amount: 8000, description: 'Aluguel',
  date: '2026-10-10', shared_with_user_id: null, workspace_id: 'ws1', created_at: '',
}

/** Aplica o updater de um setState sobre `prev`. */
function applied<T>(setter: ReturnType<typeof vi.fn>, prev: T[]): T[] {
  const update = setter.mock.calls[0][0] as (p: T[]) => T[]
  return update(prev)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.calls.length = 0
  db.state.rpc = {}
  db.state.save = { data: null, error: null }
})
afterEach(() => { vi.restoreAllMocks() })

describe('doMarkPaid', () => {
  it('uma RPC só: aplica a transação (do workspace), o lançamento e o recorrente encerrado', async () => {
    db.state.rpc.finance_mark_entry_paid = {
      data: { entry: entry({ status: 'paid', amount: 8000, transaction_id: 't1' }), transaction: tx, recurring: rec({ active: false }), already_paid: false },
      error: null,
    }
    await renderActions().doMarkPaid(entry(), rec(), 8000)

    expect(db.calls).toEqual([['rpc', 'finance_mark_entry_paid', { p_entry: 'e1', p_amount_cents: 8000 }]])
    expect(ensureMonthLoaded).toHaveBeenCalledWith('2026-10')
    expect(applyTxUpsert).toHaveBeenCalledWith(tx)
    expect(applied<FinanceRecurringEntry>(setRecurringEntries, [entry()])).toEqual([entry({ status: 'paid', amount: 8000, transaction_id: 't1' })])
    expect(applied<FinanceRecurring>(setRecurring, [rec()])[0].active).toBe(false)
  })

  it('já pago com a transação apagada: atualiza o lançamento e não inventa transação', async () => {
    db.state.rpc.finance_mark_entry_paid = {
      data: { entry: entry({ status: 'paid' }), transaction: null, recurring: rec(), already_paid: true }, error: null,
    }
    await renderActions().doMarkPaid(entry(), rec(), 8000)
    expect(applyTxUpsert).not.toHaveBeenCalled()
    expect(applied<FinanceRecurringEntry>(setRecurringEntries, [entry()])[0].status).toBe('paid')
  })

  it('erro: toast e rethrow, sem mexer no estado nem tentar reconciliar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.state.rpc.finance_mark_entry_paid = { data: null, error: { code: 'P0001', message: 'Lançamento pulado não pode ser pago' } }
    await expect(renderActions().doMarkPaid(entry(), rec(), 8000)).rejects.toMatchObject({ code: 'P0001' })
    expect(db.showToast).toHaveBeenCalledWith('error', 'finance_save_error')
    expect(db.calls).toHaveLength(1)
    expect(setRecurringEntries).not.toHaveBeenCalled()
    expect(applyTxUpsert).not.toHaveBeenCalled()
  })
})

describe('handleMarkPaid', () => {
  it('valor fixo ausente vai sem valor (o servidor recusa), não como 0', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.state.rpc.finance_mark_entry_paid = { data: null, error: { code: '22023', message: 'Informe o valor pago' } }
    renderActions().handleMarkPaid(entry(), rec({ amount: null }))
    await vi.waitFor(() => expect(db.showToast).toHaveBeenCalled())
    expect(db.calls).toEqual([['rpc', 'finance_mark_entry_paid', { p_entry: 'e1' }]])
  })

  it('valor fixo vai em centavos', async () => {
    renderActions().handleMarkPaid(entry(), rec({ amount: 8000 }))
    await vi.waitFor(() => expect(db.calls).toHaveLength(1))
    expect(db.calls[0]).toEqual(['rpc', 'finance_mark_entry_paid', { p_entry: 'e1', p_amount_cents: 8000 }])
  })

  it('variável abre o modal de valor', () => {
    renderActions().handleMarkPaid(entry(), rec({ is_variable: true, amount: null }))
    expect(setPayModal).toHaveBeenCalledWith({ open: true, entry: entry(), rec: rec({ is_variable: true, amount: null }) })
    expect(db.calls).toEqual([])
  })
})

describe('skipEntry', () => {
  it('pula pela RPC e aplica o lançamento e o recorrente (pulada encerra)', async () => {
    db.state.rpc.finance_skip_entry = { data: { entry: entry({ status: 'skipped' }), recurring: rec({ active: false }) }, error: null }
    await renderActions().skipEntry('e1')
    expect(db.calls).toEqual([['rpc', 'finance_skip_entry', { p_entry: 'e1' }]])
    expect(applied<FinanceRecurringEntry>(setRecurringEntries, [entry()])[0].status).toBe('skipped')
    expect(applied<FinanceRecurring>(setRecurring, [rec()])[0].active).toBe(false)
    expect(applyTxUpsert).not.toHaveBeenCalled()
  })

  it('erro: toast e nada muda', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.state.rpc.finance_skip_entry = { data: null, error: { code: 'P0001', message: 'Lançamento já pago' } }
    await renderActions().skipEntry('e1')
    expect(db.showToast).toHaveBeenCalledWith('error', 'finance_save_error')
    expect(setRecurringEntries).not.toHaveBeenCalled()
  })
})

describe('saveRecurring', () => {
  const input = { type: 'expense' as const, description: 'Aluguel', amount: 8000, is_variable: false, category_id: 'c1', account_id: 'a1', day_of_month: 10, active: true, total_installments: null }

  it('recorrente novo: grava, materializa no servidor e mescla o que voltou', async () => {
    db.state.save = { data: rec({ total_installments: null }), error: null }
    db.state.rpc.finance_materialize_recurring = { data: { entries: [entry()], budgets: [] }, error: null }
    await renderActions().saveRecurring(input)

    expect(db.calls.map(c => c.slice(0, 2))).toEqual([['insert', 'finance_recurring'], ['rpc', 'finance_materialize_recurring']])
    const { p_today } = db.calls[1][2] as { p_today: string }
    expect(p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // A data enviada vai junto: a janela aplicada passa a ser a dela.
    expect(applyMaterialized).toHaveBeenCalledWith({ entries: [entry()], budgets: [] }, p_today)
  })

  it('edição que muda o dia: o servidor devolve os pendentes movidos', async () => {
    db.state.save = { data: rec({ day_of_month: 20 }), error: null }
    db.state.rpc.finance_materialize_recurring = { data: { entries: [entry({ due_date: '2026-10-20' })], budgets: [] }, error: null }
    await renderActions(rec()).saveRecurring({ ...input, day_of_month: 20 })
    expect(db.calls[0].slice(0, 2)).toEqual(['update', 'finance_recurring'])
    expect(applyMaterialized).toHaveBeenCalledWith({ entries: [entry({ due_date: '2026-10-20' })], budgets: [] }, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('recorrente pausado também relê a janela (o dia editado move os pendentes dele)', async () => {
    db.state.save = { data: rec({ active: false, day_of_month: 25 }), error: null }
    db.state.rpc.finance_materialize_recurring = { data: { entries: [entry({ due_date: '2026-10-25' })], budgets: [] }, error: null }
    await renderActions(rec({ active: false })).saveRecurring({ ...input, active: false, day_of_month: 25 })
    expect(db.calls.map(c => c[0])).toEqual(['update', 'rpc'])
    expect(applyMaterialized).toHaveBeenCalledWith({ entries: [entry({ due_date: '2026-10-25' })], budgets: [] }, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('falha na materialização só vai para o log: o recorrente já foi salvo', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.state.save = { data: rec(), error: null }
    db.state.rpc.finance_materialize_recurring = { data: null, error: { code: '42501', message: 'not authenticated' } }
    await expect(renderActions().saveRecurring(input)).resolves.toBeUndefined()
    expect(setRecurring).toHaveBeenCalled()
    expect(applyMaterialized).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })
})

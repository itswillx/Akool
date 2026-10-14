// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '../../test/rtl'
import type { FinanceBudget, FinanceRecurring, FinanceRecurringEntry } from '../../types'

// API-016: a carga de Finanças não gera mais lançamento no navegador. Com algum
// recorrente ativo, chama a materialização do servidor (data do aparelho) e
// mescla o que voltou: a janela inteira de lançamentos (a versão do servidor
// vence) e todos os orçamentos dos dois meses que a pessoa enxerga, criados
// agora ou antes: os dela em `budgets`, os do workspace aberto (de qualquer
// membro) em `familyBudgets`. Erro só vai para o log.

const db = vi.hoisted(() => {
  const tables: Record<string, unknown[]> = {}
  const rpc: Record<string, { data: unknown; error: unknown }> = {}
  const calls: unknown[][] = []
  return { tables, rpc, calls }
})

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gte', 'lt', 'lte', 'gt', 'order', 'range', 'limit', 'overrideTypes']) {
      b[m] = () => b
    }
    b.maybeSingle = () => Promise.resolve({ data: table === 'finance_workspace_members' ? { workspace_id: 'ws1', user_id: 'eu' } : null, error: null })
    b.single = () => Promise.resolve({ data: table === 'finance_workspaces' ? { id: 'ws1', name: 'Casa', owner_id: 'eu' } : null, error: null })
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve, reject)
    return b
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: unknown) => {
        db.calls.push([name, args])
        return Promise.resolve(db.rpc[name] ?? { data: null, error: null })
      },
    },
  }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'eu', email: 'eu@example.com' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { useFinanceData } = await import('./useFinanceData')

const rec = (extra: Partial<FinanceRecurring> = {}): FinanceRecurring => ({
  id: 'r1', user_id: 'eu', type: 'expense', description: 'Aluguel', amount: 8000, is_variable: false,
  category_id: 'c1', account_id: null, day_of_month: 20, active: true, total_installments: null,
  workspace_id: null, created_at: '2026-01-01T00:00:00Z', ...extra,
})
const entry = (id: string, due_date: string): FinanceRecurringEntry => ({
  id, user_id: 'eu', recurring_id: 'r1', due_date, status: 'pending', amount: null, transaction_id: null, created_at: '',
})
const budget = (id: string, workspace_id: string | null, user_id = 'eu'): FinanceBudget => ({
  id, user_id, category_id: 'c1', month: '2026-10', amount_limit: 8000, shared_with_user_id: null, workspace_id, created_at: '',
})

beforeEach(() => {
  db.calls.length = 0
  db.rpc = {}
  db.tables = {
    finance_categories: [{ id: 'c1', user_id: 'eu', name: 'Moradia', type: 'expense' }],
    finance_recurring: [rec()],
    finance_recurring_entries: [entry('e0', '2026-10-10')],
  }
})
afterEach(() => { vi.restoreAllMocks() })

async function load() {
  const hook = renderHook(() => useFinanceData())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook.result
}

describe('useFinanceData: materialização no servidor', () => {
  it('com recorrente ativo: chama a RPC com a data do aparelho e mescla lançamentos e orçamentos', async () => {
    db.rpc.finance_materialize_recurring = {
      data: { entries: [entry('e0', '2026-10-20'), entry('e1', '2026-11-20')], budgets: [budget('bp', null), budget('bw', 'ws1')] },
      error: null,
    }
    const result = await load()

    const materialize = db.calls.filter(c => c[0] === 'finance_materialize_recurring')
    expect(materialize).toHaveLength(1)
    expect((materialize[0][1] as { p_today: string }).p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.current.recurringEntries.map(e => `${e.id} ${e.due_date}`)).toEqual(['e0 2026-10-20', 'e1 2026-11-20'])
    expect(result.current.budgets.map(b => b.id)).toEqual(['bp', 'bw'])
    expect(result.current.familyBudgets.map(b => b.id)).toEqual(['bw'])
  })

  it('orçamento que já existia (o cron ou outra aba criou depois do lote 1) entra; o de outro membro, só na família', async () => {
    // O lote 1 leu antes de o orçamento existir; a RPC não criou nada, mas
    // devolve todos os dos meses, inclusive o do workspace em nome de outro
    // membro (o dono do recorrente mais antigo).
    db.rpc.finance_materialize_recurring = {
      data: { entries: [], budgets: [budget('cron', null), budget('outro-membro', 'ws1', 'outro')] },
      error: null,
    }
    const result = await load()
    expect(result.current.budgets.map(b => b.id)).toEqual(['cron'])
    expect(result.current.familyBudgets.map(b => b.id)).toEqual(['outro-membro'])
  })

  it('sem recorrente ativo: não chama a RPC', async () => {
    db.tables.finance_recurring = [rec({ active: false })]
    const result = await load()
    expect(db.calls.filter(c => c[0] === 'finance_materialize_recurring')).toEqual([])
    expect(result.current.recurringEntries.map(e => e.id)).toEqual(['e0'])
  })

  it('erro na RPC só vai para o log: a carga termina com o que já existia', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.rpc.finance_materialize_recurring = { data: null, error: { code: '42501', message: 'not authenticated' } }
    const result = await load()
    expect(result.current.loadError).toBe(false)
    expect(result.current.recurringEntries.map(e => e.id)).toEqual(['e0'])
    expect(log).toHaveBeenCalledWith('[finance] recurring materialize failed', expect.objectContaining({ code: '42501' }))
  })

  it('data nulo (cliente falso, como o smoke): nada muda', async () => {
    const result = await load()
    expect(result.current.recurringEntries.map(e => e.id)).toEqual(['e0'])
    expect(result.current.budgets).toEqual([])
  })

  it('applyMaterialized (depois de salvar um recorrente) mescla nos dois baldes', async () => {
    const result = await load()
    result.current.applyMaterialized({ entries: [entry('e2', '2026-11-20')], budgets: [budget('bw2', 'ws1'), budget('bwo', 'ws1', 'outro')] })
    await waitFor(() => expect(result.current.recurringEntries.map(e => e.id)).toEqual(['e0', 'e2']))
    expect(result.current.budgets.map(b => b.id)).toEqual(['bw2'])
    expect(result.current.familyBudgets.map(b => b.id)).toEqual(['bw2', 'bwo'])
  })

  it('materializedYM: o mês da data da carga (a mesma enviada à RPC); applyMaterialized com a data troca, sem ela não', async () => {
    db.rpc.finance_materialize_recurring = { data: { entries: [], budgets: [] }, error: null }
    const result = await load()
    const { p_today } = db.calls.find(c => c[0] === 'finance_materialize_recurring')![1] as { p_today: string }
    expect(result.current.materializedYM).toBe(p_today.slice(0, 7))

    result.current.applyMaterialized({ entries: [], budgets: [budget('bp', null)] })
    await waitFor(() => expect(result.current.budgets.map(b => b.id)).toEqual(['bp']))
    expect(result.current.materializedYM).toBe(p_today.slice(0, 7))

    result.current.applyMaterialized({ entries: [], budgets: [] }, '2030-12-01')
    await waitFor(() => expect(result.current.materializedYM).toBe('2030-12'))
  })

  it('materializedYM também com a RPC falhando: o estado tem os orçamentos lidos nessa data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50))
    try {
      db.rpc.finance_materialize_recurring = { data: null, error: { code: '08006', message: 'rede' } }
      const result = await load()
      expect(result.current.materializedYM).toBe('2026-10')
    } finally {
      vi.useRealTimers()
    }
  })

  it('chamada duas vezes (outra aba já criou): a segunda devolve os mesmos orçamentos e nada duplica', async () => {
    db.rpc.finance_materialize_recurring = { data: { entries: [], budgets: [budget('bp', null), budget('bw', 'ws1')] }, error: null }
    const result = await load()
    result.current.applyMaterialized({ entries: [], budgets: [budget('bp', null), budget('bw', 'ws1')] })
    await waitFor(() => expect(result.current.budgets.map(b => b.id)).toEqual(['bp', 'bw']))
    expect(result.current.familyBudgets.map(b => b.id)).toEqual(['bw'])
  })
})

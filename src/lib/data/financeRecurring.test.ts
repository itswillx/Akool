import { beforeEach, describe, expect, it, vi } from 'vitest'

// API-016: as três RPCs dos recorrentes. Os parâmetros que o banco espera, o
// retorno lido de forma tolerante (data nulo, como o smoke, vira vazio) e o
// erro repassado sem dado parcial.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as unknown[][] }))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      db.calls.push([name, args])
      return Promise.resolve(db.queue.shift() ?? { data: null, error: null })
    },
  },
}))

const {
  deviceToday, markRecurringEntryPaid, materializeRecurring, parseEntryResult, parseMaterialized, skipRecurringEntry,
} = await import('./financeRecurring')

const entry = { id: 'e1', user_id: 'eu', recurring_id: 'r1', due_date: '2026-10-10', status: 'paid', amount: 8000, transaction_id: 't1', created_at: '' }
const budget = (id: string, category_id: string | null) => ({ id, user_id: 'eu', category_id, month: '2026-10', amount_limit: 8000, shared_with_user_id: null, workspace_id: 'ws1', created_at: '' })
const tx = { id: 't1', user_id: 'eu', type: 'expense', amount: 8000, date: '2026-10-10', workspace_id: 'ws1' }
const recurring = { id: 'r1', active: false }

beforeEach(() => {
  db.queue = []
  db.calls = []
})

describe('deviceToday', () => {
  it('a data local do aparelho, não a UTC', () => {
    expect(deviceToday(new Date(2026, 9, 31, 23, 30))).toBe('2026-10-31')
    expect(deviceToday(new Date(2027, 0, 5, 0, 10))).toBe('2027-01-05')
  })
})

describe('parseMaterialized', () => {
  it('lançamentos e orçamentos; orçamento sem categoria e linha sem id ficam de fora', () => {
    const parsed = parseMaterialized({ entries: [entry, { x: 1 }, null], budgets: [budget('b1', 'c1'), budget('b2', null)], created: 1 })
    expect(parsed.entries.map(e => e.id)).toEqual(['e1'])
    expect(parsed.budgets.map(b => b.id)).toEqual(['b1'])
  })

  it('data nulo ou fora da forma vira vazio', () => {
    expect(parseMaterialized(null)).toEqual({ entries: [], budgets: [] })
    expect(parseMaterialized({ entries: 'x' })).toEqual({ entries: [], budgets: [] })
  })
})

describe('parseEntryResult', () => {
  it('já pago com a transação apagada: transação nula', () => {
    expect(parseEntryResult({ entry, transaction: null, recurring, already_paid: true })).toEqual({
      entry, transaction: null, recurring, alreadyPaid: true,
    })
  })

  it('data nulo: nada para aplicar', () => {
    expect(parseEntryResult(null)).toEqual({ entry: null, transaction: null, recurring: null, alreadyPaid: false })
  })
})

describe('materializeRecurring', () => {
  it('manda a data do aparelho e devolve a janela', async () => {
    db.queue = [{ data: { entries: [entry], budgets: [budget('b1', 'c1')] }, error: null }]
    const { data, error } = await materializeRecurring('2026-10-07')
    expect(db.calls).toEqual([['finance_materialize_recurring', { p_today: '2026-10-07' }]])
    expect(error).toBeNull()
    expect(data?.entries).toHaveLength(1)
    expect(data?.budgets).toHaveLength(1)
  })

  it('sem data, usa a de hoje do aparelho', async () => {
    await materializeRecurring()
    expect(db.calls[0][1]).toEqual({ p_today: deviceToday() })
  })

  it('com o mês visto, manda p_month no primeiro dia dele (só orçamentos desse mês)', async () => {
    await materializeRecurring('2026-10-07', '2027-01')
    expect(db.calls).toEqual([['finance_materialize_recurring', { p_today: '2026-10-07', p_month: '2027-01-01' }]])
  })

  it('erro: sem dado', async () => {
    db.queue = [{ data: null, error: { code: '42501', message: 'not authenticated' } }]
    expect(await materializeRecurring('2026-10-07')).toEqual({ data: null, error: { code: '42501', message: 'not authenticated' } })
  })
})

describe('markRecurringEntryPaid', () => {
  it('com valor manda os centavos; sem valor deixa o servidor usar o do recorrente', async () => {
    db.queue = [{ data: { entry, transaction: tx, recurring, already_paid: false }, error: null }]
    const { data } = await markRecurringEntryPaid('e1', 1234)
    await markRecurringEntryPaid('e2', null)
    expect(db.calls).toEqual([
      ['finance_mark_entry_paid', { p_entry: 'e1', p_amount_cents: 1234 }],
      ['finance_mark_entry_paid', { p_entry: 'e2' }],
    ])
    expect(data).toMatchObject({ entry: { id: 'e1' }, transaction: { id: 't1', workspace_id: 'ws1' }, recurring: { active: false }, alreadyPaid: false })
  })

  it('erro de regra sobe sem dado', async () => {
    db.queue = [{ data: null, error: { code: '22023', message: 'Informe o valor pago' } }]
    const { data, error } = await markRecurringEntryPaid('e1', null)
    expect(data).toBeNull()
    expect(error).toMatchObject({ code: '22023' })
  })
})

describe('skipRecurringEntry', () => {
  it('chama a RPC e lê o lançamento e o recorrente', async () => {
    db.queue = [{ data: { entry: { ...entry, status: 'skipped' }, recurring }, error: null }]
    const { data } = await skipRecurringEntry('e1')
    expect(db.calls).toEqual([['finance_skip_entry', { p_entry: 'e1' }]])
    expect(data).toMatchObject({ entry: { status: 'skipped' }, transaction: null, recurring: { id: 'r1' }, alreadyPaid: false })
  })

  it('erro: sem dado', async () => {
    db.queue = [{ data: null, error: { code: 'P0001', message: 'Lançamento já pago' } }]
    expect((await skipRecurringEntry('e1')).data).toBeNull()
  })
})

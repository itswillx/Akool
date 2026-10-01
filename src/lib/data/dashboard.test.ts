import { beforeEach, describe, expect, it, vi } from 'vitest'

// PERF-015: as consultas do Dashboard devolvem as mesmas linhas de antes e
// transformam erro em exceção (o useQuery trata). Cliente falso encadeável:
// cada tabela devolve as linhas de `tables`, ou o erro de `errors`.
const tables: Record<string, unknown[]> = {}
const errors: Record<string, { message: string; code?: string } | undefined> = {}
const calls: { table: string; method: string; args: unknown[] }[] = []

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'in', 'range', 'overrideTypes']) {
    chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain }
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(errors[table]
    ? { data: null, error: errors[table] }
    : { data: tables[table] ?? [], error: null })
  return chain
}
vi.mock('../supabase', () => ({ supabase: { from: (table: string) => builder(table) } }))

const { loadDashboardFinance, loadDashboardProjects, loadDashboardTodos } = await import('./dashboard')

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  for (const k of Object.keys(errors)) delete errors[k]
  calls.length = 0
})

describe('loadDashboardFinance', () => {
  it('traz contas, transações (só colunas de agregado) e categorias do usuário', async () => {
    tables.finance_accounts = [{ id: 'a1' }]
    tables.finance_transactions = [{ id: 't1', amount: 10 }]
    tables.finance_categories = [{ id: 'c1' }]
    const rows = await loadDashboardFinance('u1')
    expect(rows).toEqual({ accounts: [{ id: 'a1' }], transactions: [{ id: 't1', amount: 10 }], categories: [{ id: 'c1' }] })
    expect(calls.filter(c => c.method === 'eq').every(c => c.args[0] === 'user_id' && c.args[1] === 'u1')).toBe(true)
    expect(calls.some(c => c.table === 'finance_transactions' && c.method === 'range')).toBe(true)
  })

  it('erro vira exceção com a mensagem do PostgREST', async () => {
    errors.finance_categories = { message: 'permission denied', code: '42501' }
    await expect(loadDashboardFinance('u1')).rejects.toMatchObject({ message: 'permission denied', code: '42501' })
  })
})

describe('loadDashboardTodos', () => {
  it('traz as tarefas do usuário, paginadas', async () => {
    tables.todos = [{ id: 'x' }]
    expect(await loadDashboardTodos('u1')).toEqual([{ id: 'x' }])
    expect(calls.some(c => c.table === 'todos' && c.method === 'range')).toBe(true)
  })

  it('erro vira exceção', async () => {
    errors.todos = { message: 'Failed to fetch' }
    await expect(loadDashboardTodos('u1')).rejects.toBeInstanceOf(Error)
  })
})

describe('loadDashboardProjects', () => {
  it('junta quadros próprios e compartilhados (sem repetir) e busca os cards deles', async () => {
    tables.project_boards = [{ id: 'b1', name: 'Meu', icon: '', color: '#000', sort_order: 0 }]
    tables.project_shares = [
      { project_boards: { id: 'b1', name: 'Meu', icon: '', color: '#000', sort_order: 0 } },
      { project_boards: { id: 'b2', name: 'Deles', icon: '', color: '#111', sort_order: 1 } },
      { project_boards: null },
    ]
    tables.project_cards = [{ id: 'c1', board_id: 'b2', title: 'T', completed: false, due_date: null }]
    const { boards, cards } = await loadDashboardProjects('u1')
    expect(boards.map(b => [b.id, b.is_shared])).toEqual([['b1', false], ['b2', true]])
    expect(cards).toHaveLength(1)
    expect(calls.find(c => c.table === 'project_cards' && c.method === 'in')?.args).toEqual(['board_id', ['b1', 'b2']])
  })

  it('sem quadros, não consulta cards', async () => {
    const result = await loadDashboardProjects('u1')
    expect(result).toEqual({ boards: [], cards: [] })
    expect(calls.some(c => c.table === 'project_cards')).toBe(false)
  })

  it('erro nos cards vira exceção', async () => {
    tables.project_boards = [{ id: 'b1', name: 'Meu', icon: '', color: '#000', sort_order: 0 }]
    errors.project_cards = { message: 'boom' }
    await expect(loadDashboardProjects('u1')).rejects.toMatchObject({ message: 'boom' })
  })
})

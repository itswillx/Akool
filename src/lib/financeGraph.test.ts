import { describe, it, expect } from 'vitest'
import type { FinanceAccount, FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceTransaction } from '../types'
import {
  DEFAULT_GRAPH_FILTERS, accountNodeId, categoryNodeId, goalNodeId,
  lastNMonths, filterTransactions, buildFinanceGraph, graphValueBounds,
  applyValueFilter, applySearch, normalizeSearch, neighborsOf,
  nodeMonthlySeries, nodeTransactions, rankCategories, rankGoalsByProgress,
} from './financeGraph'

const acc = (id: string, name: string): FinanceAccount => ({
  id, user_id: 'u1', name, type: 'checking', initial_balance: 0,
  color: '#3b82f6', icon: '🏦', created_at: '2026-01-01',
})
const cat = (id: string, name: string, type: 'income' | 'expense'): FinanceCategory => ({
  id, user_id: 'u1', name, color: '#ef4444', icon: '🛒', type,
  is_default: false, created_at: '2026-01-01',
})
const goal = (id: string, name: string, accountId: string | null, target = 100000): FinanceGoal => ({
  id, user_id: 'u1', name, icon: '🎯', color: '#10b981', target_amount: target,
  deadline: '2026-12-31', account_id: accountId, status: 'active', created_at: '2026-01-01',
})
const contrib = (id: string, goalId: string, amount: number, date: string): FinanceGoalContribution => ({
  id, goal_id: goalId, user_id: 'u1', amount, note: '', date, created_at: date,
})
const tx = (id: string, accountId: string | null, categoryId: string | null, type: 'income' | 'expense', amount: number, date: string): FinanceTransaction => ({
  id, user_id: 'u1', account_id: accountId, category_id: categoryId, type,
  amount, description: id, date, shared_with_user_id: null, created_at: date,
})

// 2 contas, 3 categorias, 1 meta, transações em ago/2026 e meses anteriores.
const accounts = [acc('a1', 'Nubank'), acc('a2', 'Carteira')]
const categories = [cat('c1', 'Mercado', 'expense'), cat('c2', 'Saúde', 'expense'), cat('c3', 'Salário', 'income')]
const goals = [goal('g1', 'Viagem', 'a1')]
const contributions = [
  contrib('gc1', 'g1', 20000, '2026-07-10'),
  contrib('gc2', 'g1', 30000, '2026-08-01'),
]
const transactions = [
  tx('t1', 'a1', 'c1', 'expense', 5000, '2026-08-01'),
  tx('t2', 'a1', 'c1', 'expense', 7000, '2026-08-15'),
  tx('t3', 'a1', 'c3', 'income', 300000, '2026-08-05'),
  tx('t4', 'a2', 'c2', 'expense', 12000, '2026-08-07'),
  tx('t5', 'a2', null, 'expense', 900, '2026-08-08'),   // sem categoria: conta soma, sem aresta
  tx('t6', null, 'c2', 'expense', 1100, '2026-08-09'),  // sem conta: categoria soma, sem aresta
  tx('t7', 'a1', 'c1', 'expense', 4000, '2026-05-20'),  // fora da janela de 3 meses (base 2026-08)
]

const base = '2026-08'
const filters = { ...DEFAULT_GRAPH_FILTERS }

function build(f = filters) {
  return buildFinanceGraph(
    { accounts, categories, goals, contributions, transactions: filterTransactions(transactions, f, base) },
    f,
  )
}

describe('lastNMonths', () => {
  it('returns N months ending at base, oldest first, crossing year boundaries', () => {
    expect(lastNMonths('2026-08', 3)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(lastNMonths('2026-01', 3)).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('filterTransactions', () => {
  it('cuts by month window', () => {
    const out = filterTransactions(transactions, { months: 3, accountId: null, txType: 'all' }, base)
    expect(out.map(t => t.id)).not.toContain('t7')
    expect(out).toHaveLength(6)
  })
  it('cuts by account and type', () => {
    const out = filterTransactions(transactions, { months: 12, accountId: 'a1', txType: 'expense' }, base)
    expect(out.map(t => t.id).sort()).toEqual(['t1', 't2', 't7'])
  })
})

describe('buildFinanceGraph', () => {
  it('aggregates edge weights in cents per account↔category pair', () => {
    const g = build()
    const e = g.edges.find(e => e.id === `${accountNodeId('a1')}|${categoryNodeId('c1')}`)
    expect(e).toBeDefined()
    expect(e!.weight).toBe(12000) // 5000 + 7000; t7 fora da janela
    expect(e!.txCount).toBe(2)
    expect(e!.kind).toBe('expense')
  })
  it('counts transactions missing one side toward the node but creates no edge', () => {
    const g = build()
    const a2 = g.nodes.find(n => n.id === accountNodeId('a2'))!
    expect(a2.value).toBe(12900) // t4 + t5
    const c2 = g.nodes.find(n => n.id === categoryNodeId('c2'))!
    expect(c2.value).toBe(13100) // t4 + t6
    expect(g.edges.find(e => e.id === `${accountNodeId('a2')}|${categoryNodeId('c2')}`)!.weight).toBe(12000)
  })
  it('links goals to their account with all-time contributions and drops them under a type filter', () => {
    const g = build()
    const goalNode = g.nodes.find(n => n.id === goalNodeId('g1'))!
    expect(goalNode.value).toBe(50000)
    expect(g.edges.find(e => e.target === goalNodeId('g1'))!.kind).toBe('goal')

    const expenseOnly = build({ ...filters, txType: 'expense' })
    expect(expenseOnly.nodes.find(n => n.kind === 'goal')).toBeUndefined()
  })
  it('drops orphan nodes (no value, no edges) and dangling edges', () => {
    const lonely = [...accounts, acc('a9', 'Vazia')]
    const g = buildFinanceGraph(
      { accounts: lonely, categories, goals, contributions, transactions: filterTransactions(transactions, filters, base) },
      filters,
    )
    expect(g.nodes.find(n => n.id === accountNodeId('a9'))).toBeUndefined()
    const ids = new Set(g.nodes.map(n => n.id))
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })
})

describe('value filter', () => {
  it('bounds are computed on the unfiltered graph', () => {
    const g = build()
    const { min, max } = graphValueBounds(g)
    expect(min).toBeGreaterThan(0)
    expect(max).toBe(312000) // a1: 5000+7000+300000
  })
  it('removes nodes outside the range and their edges', () => {
    const g = build()
    const filtered = applyValueFilter(g, 13000, null)
    expect(filtered.nodes.find(n => n.id === accountNodeId('a2'))).toBeUndefined() // 12900 < 13000
    const ids = new Set(filtered.nodes.map(n => n.id))
    for (const e of filtered.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })
})

describe('search', () => {
  it('is accent- and case-insensitive', () => {
    expect(normalizeSearch('SAÚDE')).toBe('saude')
    const g = applySearch(build(), 'saude')
    expect(g.nodes.find(n => n.id === categoryNodeId('c2'))).toBeDefined()
  })
  it('keeps direct neighbors flagged as dimmed', () => {
    const g = applySearch(build(), 'mercado')
    const match = g.nodes.find(n => n.id === categoryNodeId('c1'))!
    const neighbor = g.nodes.find(n => n.id === accountNodeId('a1'))!
    expect(match.dimmed).toBeUndefined()
    expect(neighbor.dimmed).toBe(true)
    // a2/c2 não são vizinhos de Mercado: fora do resultado
    expect(g.nodes.find(n => n.id === accountNodeId('a2'))).toBeUndefined()
  })
})

describe('neighborsOf', () => {
  it('returns neighbors heaviest first', () => {
    const g = build()
    const around = neighborsOf(g, accountNodeId('a1'))
    expect(around[0].node.id).toBe(categoryNodeId('c3')) // 300000
    expect(around.map(n => n.node.id)).toContain(goalNodeId('g1'))
  })
})

describe('nodeMonthlySeries', () => {
  const months = lastNMonths(base, 3)
  it('accounts and categories delegate to their transactions', () => {
    const s = nodeMonthlySeries({ kind: 'account', refId: 'a1' }, filterTransactions(transactions, filters, base), contributions, months)
    expect(s[2].expense).toBe(12000)
    expect(s[2].income).toBe(300000)
  })
  it('goals map contributions to income', () => {
    const s = nodeMonthlySeries({ kind: 'goal', refId: 'g1' }, [], contributions, months)
    expect(s.map(m => m.income)).toEqual([0, 20000, 30000])
  })
})

describe('nodeTransactions', () => {
  it('lists account transactions newest first', () => {
    const rows = nodeTransactions({ kind: 'account', refId: 'a1' }, transactions, contributions)
    expect(rows.map(r => r.id)).toEqual(['t2', 't3', 't1', 't7'])
    expect(rows[0].amount).toBe(7000)
    expect(rows[0].type).toBe('expense')
  })
  it('lists category transactions including ones without account', () => {
    const rows = nodeTransactions({ kind: 'category', refId: 'c2' }, transactions, contributions)
    expect(rows.map(r => r.id)).toEqual(['t6', 't4'])
  })
  it('maps goal contributions to income rows', () => {
    const rows = nodeTransactions({ kind: 'goal', refId: 'g1' }, transactions, contributions)
    expect(rows.map(r => r.id)).toEqual(['gc2', 'gc1'])
    expect(rows.every(r => r.type === 'income')).toBe(true)
    expect(rows[0].amount).toBe(30000)
  })
})

describe('rankings', () => {
  it('ranks categories by total of one type', () => {
    const txs = filterTransactions(transactions, filters, base)
    const top = rankCategories(categories, txs, 'expense', 8)
    expect(top[0].category.id).toBe('c2') // 13100 > 12000
    expect(top[0].total).toBe(13100)
    expect(top).toHaveLength(2)
  })
  it('ranks goals by progress, over-funded first', () => {
    const twoGoals = [goal('g1', 'Viagem', 'a1', 100000), goal('g2', 'Reserva', null, 10000)]
    const contribs = [...contributions, contrib('gc3', 'g2', 15000, '2026-08-02')]
    const ranked = rankGoalsByProgress(twoGoals, contribs)
    expect(ranked[0].goal.id).toBe('g2') // 150% > 50%
    expect(ranked[0].pctRaw).toBe(150)
    expect(ranked[1].pct).toBe(50)
  })
})

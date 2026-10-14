import { describe, expect, it } from 'vitest'
import type { FinanceRecurringEntry, FinanceTransaction } from '../types'
import {
  monthTotals,
  transactionsInMonth,
  accountBalance,
  expenseByCategory,
  savingsRate,
  budgetStatus,
  goalProgress,
  daysUntil,
  monthsOfYear,
  monthlySeries,
  totalsByCategory,
  totalsByUser,
  topCategories,
  pendingRecurringTotal,
  balancesByAccount,
  countByCategory,
  sumByGoal,
} from './financeCalc'

// Minimal transaction factory (only the fields the calculations read).
const tx = (
  type: FinanceTransaction['type'],
  amount: number,
  extra: Partial<Pick<FinanceTransaction, 'account_id' | 'category_id' | 'date' | 'user_id'>> = {},
) => ({ type, amount, account_id: null, category_id: null, date: '2025-06-15', user_id: 'u1', ...extra })

describe('monthTotals', () => {
  it('sums income and expense and nets balance', () => {
    const r = monthTotals([tx('income', 5000), tx('expense', 1200), tx('expense', 800), tx('income', 200)])
    expect(r).toEqual({ income: 5200, expense: 2000, balance: 3200 })
  })
  it('is zero for an empty list', () => {
    expect(monthTotals([])).toEqual({ income: 0, expense: 0, balance: 0 })
  })
})

describe('transactionsInMonth', () => {
  it('keeps only matching YYYY-MM', () => {
    const txs = [
      tx('expense', 1, { date: '2025-06-01' }),
      tx('expense', 2, { date: '2025-07-01' }),
      tx('expense', 3, { date: '2025-06-30' }),
    ]
    expect(transactionsInMonth(txs, '2025-06')).toHaveLength(2)
  })
})

describe('accountBalance', () => {
  it('adds initial balance plus income minus expense of own transactions', () => {
    const txs = [
      tx('income', 1000, { account_id: 'a1' }),
      tx('expense', 300, { account_id: 'a1' }),
      tx('income', 9999, { account_id: 'a2' }), // other account, ignored
    ]
    expect(accountBalance({ id: 'a1', initial_balance: 500 }, txs)).toBe(1200)
  })

  it('subtracts an expense from the initial balance', () => {
    const txs = [tx('expense', 300, { account_id: 'a1' })]
    expect(accountBalance({ id: 'a1', initial_balance: 500 }, txs)).toBe(200)
  })
})

describe('expenseByCategory', () => {
  it('groups expense amounts by category, ignoring income and uncategorized', () => {
    const txs = [
      tx('expense', 100, { category_id: 'food' }),
      tx('expense', 50, { category_id: 'food' }),
      tx('expense', 70, { category_id: 'rent' }),
      tx('income', 999, { category_id: 'food' }), // income ignored
      tx('expense', 5, { category_id: null }), // uncategorized ignored
    ]
    expect(expenseByCategory(txs)).toEqual({ food: 150, rent: 70 })
  })
})

describe('savingsRate', () => {
  it('returns the whole-number percentage of income', () => {
    expect(savingsRate(1000, 750)).toBe(25)
    expect(savingsRate(1000, 1000)).toBe(0)
  })
  it('returns null when there is no income', () => {
    expect(savingsRate(0, 500)).toBeNull()
  })
  it('can be negative when expenses exceed income', () => {
    expect(savingsRate(100, 200)).toBe(-100)
  })
})

describe('budgetStatus', () => {
  it('reports remaining and pct under budget', () => {
    expect(budgetStatus(300, 1000)).toMatchObject({ remaining: 700, over: false, pct: 30 })
  })
  it('flags over budget and clamps pct at 100', () => {
    expect(budgetStatus(1200, 1000)).toMatchObject({ remaining: -200, over: true, pct: 100 })
  })
  it('handles a zero limit without dividing by zero', () => {
    expect(budgetStatus(50, 0).pct).toBe(0)
  })
})

describe('goalProgress', () => {
  it('computes raw and clamped percentages', () => {
    expect(goalProgress(1000, 250)).toEqual({ accumulated: 250, pctRaw: 25, pct: 25, remaining: 750 })
  })
  it('keeps real pctRaw but clamps the bar and remaining when over-funded', () => {
    expect(goalProgress(1000, 1200)).toEqual({ accumulated: 1200, pctRaw: 120, pct: 100, remaining: 0 })
  })
  it('handles a zero target', () => {
    expect(goalProgress(0, 100).pctRaw).toBe(0)
  })
})

describe('daysUntil', () => {
  const today = new Date('2025-06-15T12:00:00')
  it('is 0 for today, negative for past, positive for future', () => {
    expect(daysUntil('2025-06-15', today)).toBe(0)
    expect(daysUntil('2025-06-13', today)).toBe(-2)
    expect(daysUntil('2025-06-20', today)).toBe(5)
  })
  it('crosses month and year boundaries', () => {
    expect(daysUntil('2025-07-01', new Date('2025-06-30T08:00:00'))).toBe(1)
    expect(daysUntil('2026-01-01', new Date('2025-12-31T23:00:00'))).toBe(1)
  })
})

describe('monthsOfYear', () => {
  it('lists the 12 months of a year, zero-padded', () => {
    const months = monthsOfYear(2025)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-01')
    expect(months[8]).toBe('2025-09')
    expect(months[11]).toBe('2025-12')
  })
})

describe('monthlySeries', () => {
  it('aligns totals to the given months, with zeros for empty ones', () => {
    const txs = [
      tx('income', 1000, { date: '2025-01-10' }),
      tx('expense', 300, { date: '2025-01-20' }),
      tx('expense', 50, { date: '2025-03-05' }),
      tx('income', 999, { date: '2024-12-31' }), // outside the window, ignored
    ]
    const r = monthlySeries(txs, ['2025-01', '2025-02', '2025-03'])
    expect(r).toEqual([
      { income: 1000, expense: 300, balance: 700 },
      { income: 0, expense: 0, balance: 0 },
      { income: 0, expense: 50, balance: -50 },
    ])
  })
  it('returns an empty list for no months', () => {
    expect(monthlySeries([tx('income', 1)], [])).toEqual([])
  })
})

describe('totalsByCategory', () => {
  const txs = [
    tx('expense', 100, { category_id: 'food' }),
    tx('expense', 50, { category_id: 'food' }),
    tx('income', 700, { category_id: 'salary' }),
    tx('income', 300, { category_id: 'salary' }),
    tx('income', 80, { category_id: 'freela' }),
    tx('expense', 5, { category_id: null }), // uncategorized ignored
  ]
  it('groups the requested type only', () => {
    expect(totalsByCategory(txs, 'expense')).toEqual({ food: 150 })
    expect(totalsByCategory(txs, 'income')).toEqual({ salary: 1000, freela: 80 })
  })
})

describe('totalsByUser', () => {
  it('groups the requested type by author', () => {
    const txs = [
      tx('expense', 100, { user_id: 'ana' }),
      tx('expense', 50, { user_id: 'ana' }),
      tx('expense', 70, { user_id: 'bia' }),
      tx('income', 999, { user_id: 'ana' }), // other type ignored
    ]
    expect(totalsByUser(txs, 'expense')).toEqual({ ana: 150, bia: 70 })
    expect(totalsByUser(txs, 'income')).toEqual({ ana: 999 })
  })
  it('is empty for an empty list', () => {
    expect(totalsByUser([], 'expense')).toEqual({})
  })
})

describe('topCategories', () => {
  it('sorts descending and cuts at n', () => {
    const r = topCategories({ a: 10, b: 300, c: 50, d: 200 }, 3)
    expect(r).toEqual([
      { categoryId: 'b', amount: 300 },
      { categoryId: 'd', amount: 200 },
      { categoryId: 'c', amount: 50 },
    ])
  })
  it('returns everything when n exceeds the map size', () => {
    expect(topCategories({ a: 1 }, 5)).toEqual([{ categoryId: 'a', amount: 1 }])
  })
})

describe('pendingRecurringTotal', () => {
  const recs = [
    { id: 'r1', type: 'expense' as const, amount: 5000 },
    { id: 'r2', type: 'expense' as const, amount: null }, // variable
    { id: 'r3', type: 'income' as const, amount: 30000 },
  ]
  const entry = (
    recurring_id: string,
    extra: Partial<Pick<FinanceRecurringEntry, 'due_date' | 'status' | 'amount'>> = {},
  ) => ({ recurring_id, due_date: '2025-06-10', status: 'pending' as const, amount: null, ...extra })

  it('sums pending entries of the month for the requested type', () => {
    const entries = [entry('r1'), entry('r3')]
    expect(pendingRecurringTotal(recs, entries, '2025-06', 'expense')).toBe(5000)
    expect(pendingRecurringTotal(recs, entries, '2025-06', 'income')).toBe(30000)
  })
  it('excludes paid and skipped entries (paid already became a transaction)', () => {
    const entries = [entry('r1', { status: 'paid' }), entry('r1', { status: 'skipped' })]
    expect(pendingRecurringTotal(recs, entries, '2025-06', 'expense')).toBe(0)
  })
  it('excludes entries due in another month', () => {
    expect(pendingRecurringTotal(recs, [entry('r1', { due_date: '2025-07-10' })], '2025-06', 'expense')).toBe(0)
  })
  it('prefers the entry amount over the recurring amount', () => {
    expect(pendingRecurringTotal(recs, [entry('r1', { amount: 7777 })], '2025-06', 'expense')).toBe(7777)
  })
  it('counts a variable recurring with no amount as 0', () => {
    expect(pendingRecurringTotal(recs, [entry('r2')], '2025-06', 'expense')).toBe(0)
  })
  it('ignores entries whose recurring is unknown', () => {
    expect(pendingRecurringTotal(recs, [entry('ghost')], '2025-06', 'expense')).toBe(0)
  })
})

// PERF-005: single-pass versions. They must match the per-item functions they
// replaced in FinancePanel, on generated data.
describe('single-pass helpers (PERF-005)', () => {
  const types = ['income', 'expense', 'transfer'] as FinanceTransaction['type'][]
  const txs = Array.from({ length: 500 }, (_, i) => tx(types[i % 3], 100 + ((i * 53) % 9_000), {
    account_id: i % 7 === 0 ? null : `acc-${i % 5}`,
    category_id: i % 11 === 0 ? null : `cat-${i % 13}`,
  }))
  const accounts = Array.from({ length: 6 }, (_, i) => ({ id: `acc-${i}`, initial_balance: 1_000 * i }))

  it('balancesByAccount matches accountBalance for every account (including one with no movement)', () => {
    const balances = balancesByAccount(accounts, txs)
    for (const acc of accounts) expect(balances.get(acc.id)).toBe(accountBalance(acc, txs))
    expect(balances.get('acc-5')).toBe(5_000)
  })

  it('countByCategory matches a per-category filter and skips uncategorized rows', () => {
    const counts = countByCategory(txs)
    for (let c = 0; c < 13; c++) {
      const id = `cat-${c}`
      expect(counts.get(id) ?? 0).toBe(txs.filter(t => t.category_id === id).length)
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(txs.filter(t => t.category_id).length)
  })

  it('sumByGoal matches the per-goal sum of contributions', () => {
    const contributions = Array.from({ length: 50 }, (_, i) => ({ goal_id: `g-${i % 4}`, amount: 10 * (i + 1) }))
    const sums = sumByGoal(contributions)
    for (let g = 0; g < 4; g++) {
      const id = `g-${g}`
      expect(sums.get(id)).toBe(contributions.filter(c => c.goal_id === id).reduce((s, c) => s + c.amount, 0))
    }
    expect(sums.get('g-9')).toBeUndefined()
  })
})

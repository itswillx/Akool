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
  recurringDueDate,
  missingRecurringDueDates,
  monthsOfYear,
  monthlySeries,
  totalsByCategory,
  totalsByUser,
  topCategories,
  pendingRecurringTotal,
  missingAutoBudgets,
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

describe('recurringDueDate', () => {
  it('formats a normal due date', () => {
    expect(recurringDueDate(2025, 6, 10)).toBe('2025-06-10')
  })
  it('clamps day 31 to the last day of a short month', () => {
    expect(recurringDueDate(2025, 2, 31)).toBe('2025-02-28') // Feb (non-leap)
    expect(recurringDueDate(2024, 2, 31)).toBe('2024-02-29') // Feb (leap)
    expect(recurringDueDate(2025, 4, 31)).toBe('2025-04-30') // April has 30
  })
  it('zero-pads month and day', () => {
    expect(recurringDueDate(2025, 3, 5)).toBe('2025-03-05')
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

describe('missingRecurringDueDates', () => {
  const now = new Date('2025-06-15T12:00:00')
  const item = (extra: Partial<Parameters<typeof missingRecurringDueDates>[0]> = {}) => ({
    active: true,
    day_of_month: 10,
    total_installments: null,
    created_at: '2025-06-01T09:00:00',
    ...extra,
  })

  it('generates current and next month for a brand-new item', () => {
    expect(missingRecurringDueDates(item(), [], now)).toEqual(['2025-06-10', '2025-07-10'])
  })

  it('backfills months in which the app was never opened', () => {
    // Created in February, entries exist only for Feb and Mar.
    const r = missingRecurringDueDates(
      item({ created_at: '2025-02-03T09:00:00' }),
      ['2025-02-10', '2025-03-10'],
      now,
    )
    expect(r).toEqual(['2025-04-10', '2025-05-10', '2025-06-10', '2025-07-10'])
  })

  it('fills gaps in the middle of the series', () => {
    const r = missingRecurringDueDates(
      item({ created_at: '2025-01-05T09:00:00' }),
      ['2025-01-10', '2025-04-10', '2025-06-10'],
      now,
    )
    expect(r).toEqual(['2025-02-10', '2025-03-10', '2025-05-10', '2025-07-10'])
  })

  it('compares by month, so an edited day_of_month never duplicates a month', () => {
    const r = missingRecurringDueDates(item({ day_of_month: 25 }), ['2025-06-10'], now)
    expect(r).toEqual(['2025-07-25'])
  })

  it('respects total_installments chronologically', () => {
    const r = missingRecurringDueDates(
      item({ created_at: '2025-03-01T09:00:00', total_installments: 3 }),
      ['2025-03-10'],
      now,
    )
    expect(r).toEqual(['2025-04-10', '2025-05-10'])
  })

  it('returns nothing when all installments already exist', () => {
    const r = missingRecurringDueDates(
      item({ created_at: '2025-03-01T09:00:00', total_installments: 2 }),
      ['2025-03-10', '2025-04-10'],
      now,
    )
    expect(r).toEqual([])
  })

  it('returns nothing for an inactive item', () => {
    expect(missingRecurringDueDates(item({ active: false }), [], now)).toEqual([])
  })

  it('clamps the due day in short months', () => {
    const r = missingRecurringDueDates(
      item({ created_at: '2025-01-15T09:00:00', day_of_month: 31 }),
      [],
      new Date('2025-02-10T12:00:00'),
    )
    expect(r).toEqual(['2025-01-31', '2025-02-28', '2025-03-31'])
  })
})

describe('missingAutoBudgets', () => {
  const rec = (extra: Partial<Parameters<typeof missingAutoBudgets>[0][number]> = {}) => ({
    type: 'expense' as const, active: true, is_variable: false, amount: 5000,
    category_id: 'cat1', workspace_id: null, ...extra,
  })

  it('creates a budget for a qualifying active fixed-amount expense recurring', () => {
    expect(missingAutoBudgets([rec()], [], '2025-06')).toEqual([
      { category_id: 'cat1', month: '2025-06', amount_limit: 5000, workspace_id: null },
    ])
  })

  it('skips variable-amount recurrings', () => {
    expect(missingAutoBudgets([rec({ is_variable: true, amount: null })], [], '2025-06')).toEqual([])
  })

  it('skips inactive recurrings', () => {
    expect(missingAutoBudgets([rec({ active: false })], [], '2025-06')).toEqual([])
  })

  it('skips income-type recurrings', () => {
    expect(missingAutoBudgets([rec({ type: 'income' })], [], '2025-06')).toEqual([])
  })

  it('skips recurrings with no category', () => {
    expect(missingAutoBudgets([rec({ category_id: null })], [], '2025-06')).toEqual([])
  })

  it('does not duplicate a budget that already exists for that category/month/scope', () => {
    const existing = [{ category_id: 'cat1', month: '2025-06', workspace_id: null }]
    expect(missingAutoBudgets([rec()], existing, '2025-06')).toEqual([])
  })

  it('treats personal and workspace scope as distinct even for the same category', () => {
    const existing = [{ category_id: 'cat1', month: '2025-06', workspace_id: 'ws1' }]
    // personal recurring (workspace_id null) still needs its own budget
    expect(missingAutoBudgets([rec()], existing, '2025-06')).toEqual([
      { category_id: 'cat1', month: '2025-06', amount_limit: 5000, workspace_id: null },
    ])
  })

  it('does not let a budget in a different month block this month', () => {
    const existing = [{ category_id: 'cat1', month: '2025-05', workspace_id: null }]
    expect(missingAutoBudgets([rec()], existing, '2025-06')).toEqual([
      { category_id: 'cat1', month: '2025-06', amount_limit: 5000, workspace_id: null },
    ])
  })

  it('dedupes two active recurrings that would produce the same category/scope candidate', () => {
    expect(missingAutoBudgets([rec(), rec({ amount: 7000 })], [], '2025-06')).toHaveLength(1)
  })
})

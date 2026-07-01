import { describe, expect, it } from 'vitest'
import type { FinanceTransaction } from '../types'
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
} from './financeCalc'

// Minimal transaction factory (only the fields the calculations read).
const tx = (
  type: FinanceTransaction['type'],
  amount: number,
  extra: Partial<Pick<FinanceTransaction, 'account_id' | 'category_id' | 'date'>> = {},
) => ({ type, amount, account_id: null, category_id: null, date: '2025-06-15', ...extra })

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

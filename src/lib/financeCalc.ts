// Pure finance calculations extracted from FinancePanel/Dashboard so the logic
// can be unit-tested and reused without duplication. Unit-agnostic: callers pass
// amounts in one consistent unit (integer cents after the money migration).
// Side-effect free and framework-agnostic.

import type { FinanceTransaction, FinanceAccount } from '../types'

type AmountTx = Pick<FinanceTransaction, 'type' | 'amount'>

export interface Totals { income: number; expense: number; balance: number }

// Sum income / expense (and net balance) for a list of transactions. The list is
// used as-is — filter by month/account before calling if needed.
export function monthTotals(transactions: AmountTx[]): Totals {
  let income = 0
  let expense = 0
  for (const tx of transactions) {
    if (tx.type === 'income') income += tx.amount
    else if (tx.type === 'expense') expense += tx.amount
  }
  return { income, expense, balance: income - expense }
}

// Transactions whose ISO date falls in the given YYYY-MM month.
export function transactionsInMonth<T extends { date: string }>(transactions: T[], month: string): T[] {
  return transactions.filter(tx => tx.date.startsWith(month))
}

// Current balance of an account: initial balance + its income − its expense.
export function accountBalance(
  account: Pick<FinanceAccount, 'id' | 'initial_balance'>,
  transactions: (AmountTx & Pick<FinanceTransaction, 'account_id'>)[],
): number {
  const { income, expense } = monthTotals(transactions.filter(tx => tx.account_id === account.id))
  return account.initial_balance + income - expense
}

// Total expense per category id (only expense transactions with a category).
export function expenseByCategory(
  transactions: (AmountTx & Pick<FinanceTransaction, 'category_id'>)[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tx of transactions) {
    if (tx.type === 'expense' && tx.category_id) {
      out[tx.category_id] = (out[tx.category_id] ?? 0) + tx.amount
    }
  }
  return out
}

// Savings rate as a whole-number percentage of income, or null when there is no
// income (avoids divide-by-zero and meaningless rates).
export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0) return null
  return Math.round(((income - expense) / income) * 100)
}

export interface BudgetStatus { spent: number; limit: number; remaining: number; over: boolean; pct: number }

// Budget status for a category. `remaining` is negative when over budget; `pct`
// is clamped to 0..100 for a progress bar (overage is conveyed by `over`).
export function budgetStatus(spent: number, limit: number): BudgetStatus {
  return {
    spent,
    limit,
    remaining: limit - spent,
    over: spent > limit,
    pct: limit > 0 ? Math.min((spent / limit) * 100, 100) : 0,
  }
}

export interface GoalProgress { accumulated: number; pctRaw: number; pct: number; remaining: number }

// Goal progress vs. target. `pctRaw` can exceed 100 (over-funded) for display;
// `pct` is clamped for the progress bar; `remaining` is never negative.
export function goalProgress(target: number, accumulated: number): GoalProgress {
  const pctRaw = target > 0 ? (accumulated / target) * 100 : 0
  return {
    accumulated,
    pctRaw,
    pct: Math.min(pctRaw, 100),
    remaining: Math.max(target - accumulated, 0),
  }
}

// Whole-day difference between `today` and an ISO 'YYYY-MM-DD' deadline. Negative
// when the deadline is in the past, 0 when it is today. Compares at local
// midnight to avoid timezone drift.
export function daysUntil(deadline: string, today: Date = new Date()): number {
  const due = new Date(deadline + 'T00:00:00')
  const ref = new Date(today)
  ref.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - ref.getTime()) / 86400000)
}

// Due date (YYYY-MM-DD) for a recurring item in a given year/month, clamping
// day_of_month to the last day of that month (e.g. day 31 in February -> 28/29).
export function recurringDueDate(year: number, month1to12: number, dayOfMonth: number): string {
  const lastDay = new Date(year, month1to12, 0).getDate()
  const day = Math.min(dayOfMonth, lastDay)
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

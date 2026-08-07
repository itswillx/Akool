// Pure finance calculations extracted from FinancePanel/Dashboard so the logic
// can be unit-tested and reused without duplication. Unit-agnostic: callers pass
// amounts in one consistent unit (integer cents after the money migration).
// Side-effect free and framework-agnostic.

import type { FinanceTransaction, FinanceAccount, FinanceRecurring, FinanceRecurringEntry, FinanceTxType, FinanceBudget } from '../types'

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
//
// Já teve um terceiro argumento com os movimentos de investimento, que viviam
// fora de finance_transactions mas saíam da conta de verdade. O submódulo de
// Investimentos foi removido, então todo dinheiro que mexe no saldo é
// transação de novo.
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

// The 12 'YYYY-MM' keys of a calendar year, January through December.
export function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

// Income/expense totals per month, aligned index-by-index to `months` (zeros
// for months with no transactions). Single pass over the transaction list;
// months are matched by the 'YYYY-MM' date prefix.
export function monthlySeries(
  transactions: (AmountTx & Pick<FinanceTransaction, 'date'>)[],
  months: string[],
): Totals[] {
  const index = new Map<string, Totals>()
  const out = months.map(m => {
    const totals: Totals = { income: 0, expense: 0, balance: 0 }
    index.set(m, totals)
    return totals
  })
  for (const tx of transactions) {
    const totals = index.get(tx.date.slice(0, 7))
    if (!totals) continue
    if (tx.type === 'income') totals.income += tx.amount
    else if (tx.type === 'expense') totals.expense += tx.amount
    totals.balance = totals.income - totals.expense
  }
  return out
}

// Total per category id for one transaction type. Generalizes expenseByCategory
// (kept above for its existing callers) so income can be grouped the same way.
export function totalsByCategory(
  transactions: (AmountTx & Pick<FinanceTransaction, 'category_id'>)[],
  type: FinanceTxType,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tx of transactions) {
    if (tx.type === type && tx.category_id) {
      out[tx.category_id] = (out[tx.category_id] ?? 0) + tx.amount
    }
  }
  return out
}

// Total per user id for one transaction type — the workspace "spending by
// member" breakdown. Same shape as totalsByCategory, keyed by author.
export function totalsByUser(
  transactions: (AmountTx & Pick<FinanceTransaction, 'user_id'>)[],
  type: FinanceTxType,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const tx of transactions) {
    if (tx.type === type) {
      out[tx.user_id] = (out[tx.user_id] ?? 0) + tx.amount
    }
  }
  return out
}

// Largest N entries of a category→amount map, descending by amount.
export function topCategories(
  byCategory: Record<string, number>,
  n: number,
): { categoryId: string; amount: number }[] {
  return Object.entries(byCategory)
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n)
}

// Amount still expected for a month: pending entries due in that month, for
// recurrings of the given type. Paid entries are excluded on purpose — marking
// one paid creates a real transaction, so counting them here would double-count
// against realized totals. Skipped entries are out; a variable recurring with
// no amount on the entry counts as 0. Entries are the ledger, so rec.active is
// not consulted.
export function pendingRecurringTotal(
  recurring: Pick<FinanceRecurring, 'id' | 'type' | 'amount'>[],
  entries: Pick<FinanceRecurringEntry, 'recurring_id' | 'due_date' | 'status' | 'amount'>[],
  month: string,
  type: FinanceTxType,
): number {
  const byId = new Map(recurring.map(r => [r.id, r]))
  let total = 0
  for (const entry of entries) {
    if (entry.status !== 'pending' || !entry.due_date.startsWith(month)) continue
    const rec = byId.get(entry.recurring_id)
    if (!rec || rec.type !== type) continue
    total += entry.amount ?? rec.amount ?? 0
  }
  return total
}

// Due dates a recurring item is missing, from its creation month through the
// month after `now`. Iterating from the creation month backfills months in
// which the app was never opened — the entry for a missed month must exist for
// the bill to surface as overdue and for installment counts to stay correct.
// Months are compared by YYYY-MM (not the exact day) so editing day_of_month
// never duplicates a month, and `total_installments` caps existing + new
// entries chronologically.
export function missingRecurringDueDates(
  item: Pick<FinanceRecurring, 'active' | 'day_of_month' | 'total_installments' | 'created_at'>,
  existingDueDates: string[],
  now: Date = new Date(),
): string[] {
  if (!item.active) return []
  let budget = item.total_installments != null
    ? item.total_installments - existingDueDates.length
    : Infinity
  if (budget <= 0) return []

  const existingMonths = new Set(existingDueDates.map(d => d.slice(0, 7)))
  const created = new Date(item.created_at)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const out: string[] = []
  for (let i = 0; budget > 0; i++) {
    const cursor = new Date(created.getFullYear(), created.getMonth() + i, 1)
    if (cursor > end) break
    const due = recurringDueDate(cursor.getFullYear(), cursor.getMonth() + 1, item.day_of_month)
    if (!existingMonths.has(due.slice(0, 7))) {
      out.push(due)
      budget--
    }
  }
  return out
}

export interface AutoBudgetCandidate {
  category_id: string
  month: string
  amount_limit: number
  workspace_id: string | null
}

// Budgets to auto-create for the given month from active, fixed-amount expense
// recurrings that don't have one yet — so an active recurring counts toward
// expense tracking without the user manually setting up a budget for it.
// Variable-amount recurrings and ones without a category are skipped outright.
// A row already existing for (category_id, month, scope) — manual or a prior
// auto-create — is left untouched: this only ever proposes what's missing.
export function missingAutoBudgets(
  recurring: Pick<FinanceRecurring, 'type' | 'active' | 'is_variable' | 'amount' | 'category_id' | 'workspace_id'>[],
  existingBudgets: Pick<FinanceBudget, 'category_id' | 'month' | 'workspace_id'>[],
  month: string,
): AutoBudgetCandidate[] {
  const existingKeys = new Set(
    existingBudgets
      .filter(b => b.month === month)
      .map(b => `${b.workspace_id ?? ''}|${b.category_id}`)
  )
  const seen = new Set<string>()
  const out: AutoBudgetCandidate[] = []
  for (const r of recurring) {
    if (r.type !== 'expense' || !r.active || r.is_variable) continue
    if (!r.category_id || r.amount == null) continue
    const workspaceId = r.workspace_id ?? null
    const key = `${workspaceId ?? ''}|${r.category_id}`
    if (existingKeys.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ category_id: r.category_id, month, amount_limit: r.amount, workspace_id: workspaceId })
  }
  return out
}

// Pure calculations for the "Obras" submodule (finance projects). Money is in
// integer cents everywhere; `quantity` is the one decimal value in the domain,
// so every quantity x price product is rounded to cents in a single step and
// only cent integers are ever summed — no float drift accumulates.
//
// Dates are 'YYYY-MM-DD' strings manipulated by slicing and integer arithmetic,
// never by parsing with `new Date(string)` (which reads as UTC and shifts a day
// in UTC-3).

import { budgetStatus, recurringDueDate, type BudgetStatus } from './financeCalc'
import type {
  FinanceProject,
  FinanceProjectExpense,
  FinanceProjectItem,
  FinanceProjectQuote,
  FinanceProjectStage,
  FinanceSupplier,
} from '../types'

type ItemLike = Pick<FinanceProjectItem, 'quantity' | 'estimated_unit_price'>
type QuoteLike = Pick<FinanceProjectQuote, 'unit_price' | 'total_price'>

// Estimated cost of an item before any quote: quantity x the price the user
// guessed. Rounded once, to cents.
export function itemEstimatedTotal(item: ItemLike): number {
  return Math.round(item.quantity * item.estimated_unit_price)
}

// Cost of a quote for a given item. A closed price from the store (freight and
// discounts already baked in) wins over the unit price; note that `total_price`
// of 0 is a legitimate "free" and must not fall back.
export function quoteTotal(quote: QuoteLike, item: ItemLike): number {
  if (quote.total_price != null) return quote.total_price
  return Math.round(item.quantity * quote.unit_price)
}

// Cheapest quote for an item. Ties are broken by the most recent `quoted_on`
// (a null date loses), so re-quoting the same price surfaces the fresh one.
export function bestQuote<T extends FinanceProjectQuote>(quotes: T[], item: ItemLike): T | null {
  let best: T | null = null
  let bestTotal = Infinity
  for (const q of quotes) {
    const total = quoteTotal(q, item)
    if (total < bestTotal) {
      best = q
      bestTotal = total
      continue
    }
    if (total === bestTotal && best && (q.quoted_on ?? '') > (best.quoted_on ?? '')) {
      best = q
    }
  }
  return best
}

export interface QuoteSavings {
  best: number
  worst: number
  /** How much the cheapest quote saves against the most expensive one. */
  savings: number
}

// Spread between the cheapest and the priciest quote. Null when there is
// nothing to compare; zero savings when every quote lands on the same total.
export function quoteSavings(quotes: FinanceProjectQuote[], item: ItemLike): QuoteSavings | null {
  if (quotes.length === 0) return null
  const totals = quotes.map(q => quoteTotal(q, item))
  const best = Math.min(...totals)
  const worst = Math.max(...totals)
  return { best, worst, savings: worst - best }
}

// What an item is expected to cost: the quote the user picked, else the
// cheapest quote on the table, else their own estimate.
export function itemExpectedCost(item: FinanceProjectItem, quotes: FinanceProjectQuote[]): number {
  const own = quotes.filter(q => q.item_id === item.id)
  const chosen = item.chosen_quote_id ? own.find(q => q.id === item.chosen_quote_id) : undefined
  if (chosen) return quoteTotal(chosen, item)
  const best = bestQuote(own, item)
  return best ? quoteTotal(best, item) : itemEstimatedTotal(item)
}

// An item counts as still ahead of us (money not yet spent) unless it was
// bought or dropped.
function isPending(item: FinanceProjectItem): boolean {
  return item.status !== 'purchased' && item.status !== 'cancelled'
}

export function expensesTotal(expenses: Pick<FinanceProjectExpense, 'amount'>[]): number {
  return expenses.reduce((sum, e) => sum + e.amount, 0)
}

export interface StageTotals extends BudgetStatus {
  /** Expected cost of the items in this stage that were not bought yet. */
  planned: number
}

// Budget vs. reality for one stage. `spent` only counts expenses; `planned` is
// what the pending items of the stage should still cost.
export function stageTotals(
  stage: Pick<FinanceProjectStage, 'id' | 'budget_amount'>,
  items: FinanceProjectItem[],
  expenses: FinanceProjectExpense[],
  quotes: FinanceProjectQuote[] = [],
): StageTotals {
  const spent = expensesTotal(expenses.filter(e => e.stage_id === stage.id))
  const planned = items
    .filter(i => i.stage_id === stage.id && isPending(i))
    .reduce((sum, i) => sum + itemExpectedCost(i, quotes), 0)
  return { ...budgetStatus(spent, stage.budget_amount), planned }
}

export interface ProjectTotals extends BudgetStatus {
  /** Expected cost of everything still on the shopping list. */
  planned: number
  /** spent + planned — the projected final cost of the project. */
  committed: number
  /** Projected cost minus the budget. Positive means the budget will burst. */
  projectedOverrun: number
}

// Consolidated numbers for a project. The ceiling is the project's own
// `budget_total` when set; otherwise it falls back to the sum of the stage
// ceilings, so a user who only budgets per stage still gets a total.
// Expenses with no stage are included — they are real money either way.
export function projectTotals(
  project: Pick<FinanceProject, 'id' | 'budget_total'>,
  stages: FinanceProjectStage[],
  items: FinanceProjectItem[],
  expenses: FinanceProjectExpense[],
  quotes: FinanceProjectQuote[] = [],
): ProjectTotals {
  const own = expenses.filter(e => e.project_id === project.id)
  const spent = expensesTotal(own)
  const planned = items
    .filter(i => i.project_id === project.id && isPending(i))
    .reduce((sum, i) => sum + itemExpectedCost(i, quotes), 0)
  const limit = project.budget_total > 0
    ? project.budget_total
    : stages.filter(s => s.project_id === project.id).reduce((sum, s) => sum + s.budget_amount, 0)
  const committed = spent + planned
  return {
    ...budgetStatus(spent, limit),
    planned,
    committed,
    projectedOverrun: limit > 0 ? committed - limit : 0,
  }
}

export interface SupplierSpend {
  supplier_id: string | null
  name: string
  total: number
  count: number
}

// "Quanto já gastei na Leroy" — ranked descending. Expenses without a supplier
// are grouped under a single null bucket so the totals still add up.
export function spentBySupplier(
  expenses: FinanceProjectExpense[],
  suppliers: Pick<FinanceSupplier, 'id' | 'name'>[],
  unknownLabel = '—',
): SupplierSpend[] {
  const byId = new Map(suppliers.map(s => [s.id, s.name]))
  const acc = new Map<string, SupplierSpend>()
  for (const e of expenses) {
    const key = e.supplier_id ?? ''
    const row = acc.get(key) ?? {
      supplier_id: e.supplier_id,
      name: e.supplier_id ? byId.get(e.supplier_id) ?? unknownLabel : unknownLabel,
      total: 0,
      count: 0,
    }
    row.total += e.amount
    row.count += 1
    acc.set(key, row)
  }
  return [...acc.values()].sort((a, b) => b.total - a.total)
}

// Totals keyed by stage id; expenses with no stage land under ''.
export function expensesByStage(expenses: FinanceProjectExpense[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of expenses) {
    const key = e.stage_id ?? ''
    out[key] = (out[key] ?? 0) + e.amount
  }
  return out
}

// Totals keyed by 'YYYY-MM', from the date string itself.
export function expensesByMonth(expenses: FinanceProjectExpense[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of expenses) {
    const key = e.date.slice(0, 7)
    out[key] = (out[key] ?? 0) + e.amount
  }
  return out
}

// Split a total into `count` installments whose sum is exactly the total. The
// leftover cents go to the LAST one, so the earlier installments keep the round
// figure the store advertises ("12x de R$ 83,33").
export function splitInstallments(totalCents: number, count: number): number[] {
  if (count <= 1) return [totalCents]
  const base = Math.floor(totalCents / count)
  const out = new Array<number>(count).fill(base)
  out[count - 1] += totalCents - base * count
  return out
}

// Monthly due dates starting at `firstDate`, clamping the day to the length of
// each month (31/01 -> 28/02). Integer month arithmetic only.
export function installmentDueDates(firstDate: string, count: number): string[] {
  const [year, month, day] = firstDate.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const zeroBased = month - 1 + i
    out.push(recurringDueDate(year + Math.floor(zeroBased / 12), (zeroBased % 12) + 1, day))
  }
  return out
}

export interface Installment {
  number: number
  due_date: string
  amount: number
}

// Payment schedule of an expense. A cash purchase yields a single installment
// due on the purchase date, so callers never need a separate code path.
export function installmentSchedule(
  expense: Pick<FinanceProjectExpense, 'amount' | 'date' | 'installments'>,
): Installment[] {
  const count = Math.max(1, expense.installments)
  const amounts = splitInstallments(expense.amount, count)
  const dates = installmentDueDates(expense.date, count)
  return amounts.map((amount, i) => ({ number: i + 1, due_date: dates[i], amount }))
}

export interface ItemPurchase {
  purchased: boolean
  paid: number
  /** Paid minus estimated: positive means it cost more than planned. */
  diffVsEstimate: number
}

// Whether an item was actually bought, derived from the expenses pointing at
// it rather than trusted from `status` — an item can be bought in several
// partial deliveries.
export function itemPurchase(item: FinanceProjectItem, expenses: FinanceProjectExpense[]): ItemPurchase {
  const own = expenses.filter(e => e.item_id === item.id)
  const paid = expensesTotal(own)
  return {
    purchased: own.length > 0,
    paid,
    diffVsEstimate: own.length > 0 ? paid - itemEstimatedTotal(item) : 0,
  }
}

// Total already spent across every project that is not cancelled — the single
// number the finance overview shows for "Obras".
export function activeProjectsSpent(
  projects: Pick<FinanceProject, 'id' | 'status'>[],
  expenses: FinanceProjectExpense[],
): number {
  const live = new Set(projects.filter(p => p.status !== 'cancelled').map(p => p.id))
  return expensesTotal(expenses.filter(e => live.has(e.project_id)))
}

// ─── Reconciling works expenses with the cash flow ────────────────────────────

/** Days either side of the expense date a candidate transaction may fall on.
 *  A card purchase posts a day or two after the receipt, so an exact-date match
 *  would miss most of them. */
const RECONCILE_DAY_WINDOW = 3

// Shifts a 'YYYY-MM-DD' by whole days without going through Date parsing of the
// string itself (which shifts a day in UTC-3). Building from the numeric parts
// uses the local constructor, which is safe.
function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const shifted = new Date(y, m - 1, d + days)
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`
}

type ReconcileTxLike = { id: string; date: string; amount: number; type: 'income' | 'expense'; description: string }

// Transactions that could be the cash-flow side of a works expense: an expense
// of the same amount, within a few days, not already claimed by another
// works expense or by the store.
//
// Amount has to match exactly — a works expense and its statement line are the
// same payment, so a "close enough" amount would be a different purchase.
export function reconcileCandidates(
  expense: Pick<FinanceProjectExpense, 'amount' | 'date'>,
  transactions: ReconcileTxLike[],
  claimedTransactionIds: ReadonlySet<string>,
): ReconcileTxLike[] {
  const from = shiftDay(expense.date, -RECONCILE_DAY_WINDOW)
  const to = shiftDay(expense.date, RECONCILE_DAY_WINDOW)
  return transactions
    .filter(tx =>
      tx.type === 'expense'
      && tx.amount === expense.amount
      && tx.date >= from && tx.date <= to
      && !claimedTransactionIds.has(tx.id))
    // Closest date first: with several identical payments, the nearest one is
    // the likeliest match.
    .sort((a, b) => {
      const da = Math.abs(dayDiff(a.date, expense.date))
      const db = Math.abs(dayDiff(b.date, expense.date))
      return da === db ? a.date.localeCompare(b.date) : da - db
    })
}

function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number)
  const [yb, mb, db] = b.split('-').map(Number)
  return Math.round((new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime()) / 86400000)
}

export interface ProjectsCashSplit {
  /** Everything spent on live projects. */
  total: number
  /** The part backed by a finance_transactions row — already in the cash flow. */
  linked: number
  /** The part with no linked transaction. */
  unlinked: number
}

// Splits the works total by whether each expense has a transaction behind it.
//
// This is what dissolves the double-counting question. A works expense never
// creates a transaction on its own, but the money did leave the bank and shows
// up when the statement is imported — so the same money was described twice
// with nothing saying so. `linked` is the part already counted in the cash
// flow; `unlinked` is the part still floating outside it.
export function projectsCashSplit(
  projects: Pick<FinanceProject, 'id' | 'status'>[],
  expenses: Pick<FinanceProjectExpense, 'project_id' | 'amount' | 'transaction_id'>[],
): ProjectsCashSplit {
  const live = new Set(projects.filter(p => p.status !== 'cancelled').map(p => p.id))
  let linked = 0
  let unlinked = 0
  for (const e of expenses) {
    if (!live.has(e.project_id)) continue
    if (e.transaction_id) linked += e.amount
    else unlinked += e.amount
  }
  return { total: linked + unlinked, linked, unlinked }
}

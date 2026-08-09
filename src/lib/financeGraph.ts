// Pure model behind the finance "Rede" tab: turns accounts, categories, goals
// and transactions into a node/edge graph, plus the filter and ranking helpers
// the tab needs. Framework-agnostic and side-effect free; amounts are integer
// cents throughout (format with formatBRL at the edge).
//
// v1 scope is the personal data useFinanceData already loads. Store data
// (products/customers/sales) is intentionally out: the Projects tab owns the
// single useFinanceStore instance, so wiring it here would either duplicate the
// hook or couple the two tabs. Extend by adding new node kinds when that hook
// gains a shared home.

import type {
  FinanceAccount, FinanceCategory, FinanceGoal, FinanceGoalContribution,
  FinanceTransaction, FinanceTxType,
} from '../types'
import { goalProgress, monthlySeries, totalsByCategory, topCategories, type Totals } from './financeCalc'
import type { GraphEdgeBase, GraphNodeBase } from './graph'

// Filtering/searching a graph is the same work in any domain, so those helpers
// live in ./graph. Re-exported here so the finance tab keeps a single import.
export { normalizeSearch, applySearch, applyValueFilter, graphValueBounds, neighborsOf } from './graph'

export type GraphNodeKind = 'account' | 'category' | 'goal'

export interface GraphNode extends GraphNodeBase<GraphNodeKind> {
  /** id is 'acc:<uuid>' | 'cat:<uuid>' | 'goal:<uuid>'.
   *
   *  `value` is in cents. Accounts/categories: volume inside the filter window.
   *  Goals: all-time accumulated contributions — a goal is a stock, not a flow,
   *  so windowing it would show a misleading "empty" goal. */
  txCount: number
}

export interface GraphEdge extends GraphEdgeBase<'income' | 'expense' | 'goal'> {
  /** id is `${source}|${target}`; weight is cents summed over the window
   *  (goal edges: all-time contributions). */
  txCount: number
}

export interface FinanceGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface GraphFilters {
  months: 1 | 3 | 6 | 12
  search: string
  /** Cents; bounds come from graphValueBounds computed BEFORE this filter. */
  minValue: number
  maxValue: number | null
  accountId: string | null
  txType: 'all' | FinanceTxType
}

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  months: 3,
  search: '',
  minValue: 0,
  maxValue: null,
  accountId: null,
  txType: 'all',
}

export const accountNodeId = (id: string) => `acc:${id}`
export const categoryNodeId = (id: string) => `cat:${id}`
export const goalNodeId = (id: string) => `goal:${id}`

// The N 'YYYY-MM' keys ending at (and including) baseYM, oldest first.
export function lastNMonths(baseYM: string, n: number): string[] {
  const [y, m] = baseYM.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// Window/account/type filter — the part of GraphFilters that narrows the
// transaction list itself (value range and search act on the built graph).
export function filterTransactions(
  transactions: FinanceTransaction[],
  filters: Pick<GraphFilters, 'months' | 'accountId' | 'txType'>,
  baseYM: string,
): FinanceTransaction[] {
  const window = new Set(lastNMonths(baseYM, filters.months))
  return transactions.filter(tx =>
    window.has(tx.date.slice(0, 7))
    && (filters.accountId == null || tx.account_id === filters.accountId)
    && (filters.txType === 'all' || tx.type === filters.txType),
  )
}

interface GraphSource {
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  /** Already narrowed by filterTransactions. */
  transactions: FinanceTransaction[]
}

// Build nodes and edges from the (pre-filtered) transactions. Account↔category
// edges aggregate the window's transactions per pair; a transaction missing one
// side still counts toward the node it does reference, it just draws no line.
// Goals attach to their linked account; goal nodes and edges only appear when
// txType is 'all' — a goal is neither income nor expense, so showing it under
// either filter would be noise. Nodes with no edges and no value are dropped.
export function buildFinanceGraph(source: GraphSource, filters: Pick<GraphFilters, 'txType' | 'accountId'>): FinanceGraph {
  const nodeValue = new Map<string, { value: number; txCount: number }>()
  const bump = (id: string, amount: number) => {
    const cur = nodeValue.get(id) ?? { value: 0, txCount: 0 }
    cur.value += amount
    cur.txCount += 1
    nodeValue.set(id, cur)
  }

  const edgeAgg = new Map<string, { weight: number; txCount: number; income: number; expense: number }>()
  for (const tx of source.transactions) {
    if (tx.account_id) bump(accountNodeId(tx.account_id), tx.amount)
    if (tx.category_id) bump(categoryNodeId(tx.category_id), tx.amount)
    if (tx.account_id && tx.category_id) {
      const key = `${accountNodeId(tx.account_id)}|${categoryNodeId(tx.category_id)}`
      const cur = edgeAgg.get(key) ?? { weight: 0, txCount: 0, income: 0, expense: 0 }
      cur.weight += tx.amount
      cur.txCount += 1
      if (tx.type === 'income') cur.income += tx.amount
      else if (tx.type === 'expense') cur.expense += tx.amount
      edgeAgg.set(key, cur)
    }
  }

  const edges: GraphEdge[] = []
  for (const [key, agg] of edgeAgg) {
    const [sourceId, targetId] = key.split('|')
    edges.push({
      id: key,
      source: sourceId,
      target: targetId,
      weight: agg.weight,
      txCount: agg.txCount,
      kind: agg.income >= agg.expense ? 'income' : 'expense',
    })
  }

  const includeGoals = filters.txType === 'all'
  const goalTotals = new Map<string, { value: number; txCount: number }>()
  if (includeGoals) {
    for (const c of source.contributions) {
      const cur = goalTotals.get(c.goal_id) ?? { value: 0, txCount: 0 }
      cur.value += c.amount
      cur.txCount += 1
      goalTotals.set(c.goal_id, cur)
    }
    for (const goal of source.goals) {
      if (filters.accountId != null && goal.account_id !== filters.accountId) continue
      const total = goalTotals.get(goal.id) ?? { value: 0, txCount: 0 }
      if (goal.account_id) {
        edges.push({
          id: `${accountNodeId(goal.account_id)}|${goalNodeId(goal.id)}`,
          source: accountNodeId(goal.account_id),
          target: goalNodeId(goal.id),
          weight: total.value,
          txCount: total.txCount,
          kind: 'goal',
        })
      }
    }
  }

  const linked = new Set<string>()
  for (const e of edges) {
    linked.add(e.source)
    linked.add(e.target)
  }

  const nodes: GraphNode[] = []
  for (const acc of source.accounts) {
    const id = accountNodeId(acc.id)
    const agg = nodeValue.get(id) ?? { value: 0, txCount: 0 }
    if (agg.value === 0 && !linked.has(id)) continue
    nodes.push({ id, kind: 'account', refId: acc.id, label: acc.name, icon: acc.icon, color: acc.color, ...agg })
  }
  for (const cat of source.categories) {
    const id = categoryNodeId(cat.id)
    const agg = nodeValue.get(id) ?? { value: 0, txCount: 0 }
    if (agg.value === 0 && !linked.has(id)) continue
    nodes.push({ id, kind: 'category', refId: cat.id, label: cat.name, icon: cat.icon, color: cat.color, ...agg })
  }
  if (includeGoals) {
    for (const goal of source.goals) {
      if (filters.accountId != null && goal.account_id !== filters.accountId) continue
      const id = goalNodeId(goal.id)
      const total = goalTotals.get(goal.id) ?? { value: 0, txCount: 0 }
      if (total.value === 0 && !linked.has(id)) continue
      nodes.push({ id, kind: 'goal', refId: goal.id, label: goal.name, icon: goal.icon, color: goal.color, value: total.value, txCount: total.txCount })
    }
  }

  // A goal edge can reference an account that has no window activity of its
  // own; the account node was still emitted above because `linked` marked it.
  // The reverse (edge to a node that was filtered out) is handled here so the
  // graph never has dangling edge endpoints.
  const nodeIds = new Set(nodes.map(n => n.id))
  return { nodes, edges: edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target)) }
}

// Monthly Totals for one node, aligned to `months`. Accounts/categories delegate
// to monthlySeries over their own transactions; goals map contributions to the
// income side (a contribution is money entering the goal).
export function nodeMonthlySeries(
  node: Pick<GraphNode, 'kind' | 'refId'>,
  transactions: FinanceTransaction[],
  contributions: FinanceGoalContribution[],
  months: string[],
): Totals[] {
  if (node.kind === 'goal') {
    return monthlySeries(
      contributions
        .filter(c => c.goal_id === node.refId)
        .map(c => ({ type: 'income' as FinanceTxType, amount: c.amount, date: c.date })),
      months,
    )
  }
  const key = node.kind === 'account' ? 'account_id' : 'category_id'
  return monthlySeries(transactions.filter(tx => tx[key] === node.refId), months)
}

// Unified "transaction row" for the detail panel's list: real transactions for
// accounts/categories, contributions for goals (money entering the goal, hence
// income). Newest first; ties keep input order.
export interface NodeTxRow {
  id: string
  date: string
  description: string
  amount: number
  type: FinanceTxType
}

export function nodeTransactions(
  node: Pick<GraphNode, 'kind' | 'refId'>,
  transactions: FinanceTransaction[],
  contributions: FinanceGoalContribution[],
): NodeTxRow[] {
  const rows: NodeTxRow[] = node.kind === 'goal'
    ? contributions
        .filter(c => c.goal_id === node.refId)
        .map(c => ({ id: c.id, date: c.date, description: c.note, amount: c.amount, type: 'income' as FinanceTxType }))
    : transactions
        .filter(tx => (node.kind === 'account' ? tx.account_id : tx.category_id) === node.refId)
        .map(tx => ({ id: tx.id, date: tx.date, description: tx.description, amount: tx.amount, type: tx.type }))
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

// Top categories of one type inside the already-filtered transaction list.
export function rankCategories(
  categories: FinanceCategory[],
  transactions: FinanceTransaction[],
  type: FinanceTxType,
  n: number,
): { category: FinanceCategory; total: number }[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  return topCategories(totalsByCategory(transactions, type), n)
    .map(({ categoryId, amount }) => {
      const category = byId.get(categoryId)
      return category ? { category, total: amount } : null
    })
    .filter((x): x is { category: FinanceCategory; total: number } => x !== null)
}

// Goals by completion, most funded first. pctRaw can exceed 100 (over-funded).
export function rankGoalsByProgress(
  goals: FinanceGoal[],
  contributions: FinanceGoalContribution[],
): { goal: FinanceGoal; accumulated: number; pct: number; pctRaw: number }[] {
  const totals = new Map<string, number>()
  for (const c of contributions) totals.set(c.goal_id, (totals.get(c.goal_id) ?? 0) + c.amount)
  return goals
    .map(goal => {
      const p = goalProgress(goal.target_amount, totals.get(goal.id) ?? 0)
      return { goal, accumulated: p.accumulated, pct: p.pct, pctRaw: p.pctRaw }
    })
    .sort((a, b) => b.pctRaw - a.pctRaw)
}

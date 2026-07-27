import { describe, expect, it } from 'vitest'
import type {
  FinanceProjectExpense,
  FinanceProjectItem,
  FinanceProjectQuote,
  FinanceProjectStage,
} from '../types'
import {
  itemEstimatedTotal,
  quoteTotal,
  bestQuote,
  quoteSavings,
  itemExpectedCost,
  stageTotals,
  projectTotals,
  spentBySupplier,
  expensesByStage,
  expensesByMonth,
  splitInstallments,
  installmentDueDates,
  installmentSchedule,
  itemPurchase,
  activeProjectsSpent,
} from './financeProjectCalc'

// Factories carrying only the fields the calculations read; the rest of the row
// is filled with inert defaults so the objects still satisfy the domain types.
const item = (over: Partial<FinanceProjectItem> = {}): FinanceProjectItem => ({
  id: 'i1',
  user_id: 'u1',
  workspace_id: null,
  project_id: 'p1',
  stage_id: null,
  name: 'Porcelanato 80x80',
  notes: '',
  quantity: 1,
  unit: 'un',
  estimated_unit_price: 0,
  status: 'planned',
  priority: 'normal',
  chosen_quote_id: null,
  attachments: [],
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const quote = (over: Partial<FinanceProjectQuote> = {}): FinanceProjectQuote => ({
  id: 'q1',
  user_id: 'u1',
  workspace_id: null,
  item_id: 'i1',
  supplier_id: null,
  supplier_name: '',
  unit_price: 0,
  total_price: null,
  quoted_on: null,
  url: '',
  notes: '',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const expense = (over: Partial<FinanceProjectExpense> = {}): FinanceProjectExpense => ({
  id: 'e1',
  user_id: 'u1',
  workspace_id: null,
  project_id: 'p1',
  stage_id: null,
  item_id: null,
  supplier_id: null,
  account_id: null,
  description: 'Compra',
  amount: 0,
  date: '2026-07-10',
  payment_method: 'pix',
  installments: 1,
  attachments: [],
  created_at: '2026-07-10T00:00:00Z',
  updated_at: '2026-07-10T00:00:00Z',
  ...over,
})

const stage = (over: Partial<FinanceProjectStage> = {}): FinanceProjectStage => ({
  id: 's1',
  user_id: 'u1',
  workspace_id: null,
  project_id: 'p1',
  name: 'Acabamento',
  icon: '🧱',
  color: '#64748b',
  budget_amount: 0,
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

describe('itemEstimatedTotal', () => {
  it('multiplies a fractional quantity by the unit price in cents', () => {
    // 60,5 m² x R$ 89,90 = R$ 5.438,95
    expect(itemEstimatedTotal({ quantity: 60.5, estimated_unit_price: 8990 })).toBe(543895)
  })
  it('rounds a half cent up instead of leaving a fraction', () => {
    expect(itemEstimatedTotal({ quantity: 1.5, estimated_unit_price: 333 })).toBe(500)
  })
  it('is zero when the quantity or the price is zero', () => {
    expect(itemEstimatedTotal({ quantity: 0, estimated_unit_price: 8990 })).toBe(0)
    expect(itemEstimatedTotal({ quantity: 10, estimated_unit_price: 0 })).toBe(0)
  })
})

describe('quoteTotal', () => {
  it('uses quantity x unit price when there is no closed price', () => {
    expect(quoteTotal(quote({ unit_price: 8990 }), { quantity: 10, estimated_unit_price: 0 })).toBe(89900)
  })
  it('lets a closed price from the store win over the unit price', () => {
    expect(quoteTotal(quote({ unit_price: 8990, total_price: 85000 }), { quantity: 10, estimated_unit_price: 0 })).toBe(85000)
  })
  it('treats a closed price of zero as free, not as missing', () => {
    expect(quoteTotal(quote({ unit_price: 8990, total_price: 0 }), { quantity: 10, estimated_unit_price: 0 })).toBe(0)
  })
})

describe('bestQuote', () => {
  const it10 = { quantity: 10, estimated_unit_price: 0 }
  it('picks the cheapest total', () => {
    const cheap = quote({ id: 'q2', unit_price: 8000 })
    const best = bestQuote([quote({ id: 'q1', unit_price: 9000 }), cheap], it10)
    expect(best?.id).toBe('q2')
  })
  it('breaks a tie in favour of the most recent quote', () => {
    const older = quote({ id: 'q1', unit_price: 8000, quoted_on: '2026-07-01' })
    const newer = quote({ id: 'q2', unit_price: 8000, quoted_on: '2026-07-20' })
    expect(bestQuote([older, newer], it10)?.id).toBe('q2')
    expect(bestQuote([newer, older], it10)?.id).toBe('q2')
  })
  it('returns null when there is no quote', () => {
    expect(bestQuote([], it10)).toBeNull()
  })
})

describe('quoteSavings', () => {
  const it1 = { quantity: 1, estimated_unit_price: 0 }
  it('reports the spread between the cheapest and the priciest', () => {
    const r = quoteSavings([quote({ unit_price: 10000 }), quote({ unit_price: 7500 }), quote({ unit_price: 9000 })], it1)
    expect(r).toEqual({ best: 7500, worst: 10000, savings: 2500 })
  })
  it('saves nothing with a single quote', () => {
    expect(quoteSavings([quote({ unit_price: 7500 })], it1)).toEqual({ best: 7500, worst: 7500, savings: 0 })
  })
  it('returns null with no quotes', () => {
    expect(quoteSavings([], it1)).toBeNull()
  })
})

describe('itemExpectedCost', () => {
  it('falls back to the user estimate when nothing was quoted', () => {
    expect(itemExpectedCost(item({ quantity: 10, estimated_unit_price: 9000 }), [])).toBe(90000)
  })
  it('prefers the cheapest quote over the estimate', () => {
    const quotes = [quote({ id: 'q1', unit_price: 9500 }), quote({ id: 'q2', unit_price: 8000 })]
    expect(itemExpectedCost(item({ quantity: 10, estimated_unit_price: 9000 }), quotes)).toBe(80000)
  })
  it('honours the quote the user picked even when a cheaper one exists', () => {
    const quotes = [quote({ id: 'q1', unit_price: 9500 }), quote({ id: 'q2', unit_price: 8000 })]
    const chosen = item({ quantity: 10, estimated_unit_price: 9000, chosen_quote_id: 'q1' })
    expect(itemExpectedCost(chosen, quotes)).toBe(95000)
  })
  it('ignores quotes that belong to another item', () => {
    const other = [quote({ id: 'q9', item_id: 'i2', unit_price: 100 })]
    expect(itemExpectedCost(item({ quantity: 10, estimated_unit_price: 9000 }), other)).toBe(90000)
  })
})

describe('stageTotals', () => {
  const s = stage({ id: 's1', budget_amount: 100000 })
  it('counts only the expenses of the stage and flags an overrun', () => {
    const r = stageTotals(s, [], [
      expense({ stage_id: 's1', amount: 60000 }),
      expense({ stage_id: 's1', amount: 50000 }),
      expense({ stage_id: 's2', amount: 999999 }),
      expense({ stage_id: null, amount: 999999 }),
    ])
    expect(r.spent).toBe(110000)
    expect(r.over).toBe(true)
    expect(r.remaining).toBe(-10000)
  })
  it('plans only the items that were not bought or cancelled', () => {
    const items = [
      item({ id: 'i1', stage_id: 's1', quantity: 1, estimated_unit_price: 10000 }),
      item({ id: 'i2', stage_id: 's1', quantity: 1, estimated_unit_price: 20000, status: 'purchased' }),
      item({ id: 'i3', stage_id: 's1', quantity: 1, estimated_unit_price: 40000, status: 'cancelled' }),
    ]
    expect(stageTotals(s, items, []).planned).toBe(10000)
  })
  it('never reports a percentage for a stage without a ceiling', () => {
    const r = stageTotals(stage({ id: 's1', budget_amount: 0 }), [], [expense({ stage_id: 's1', amount: 50000 })])
    expect(r).toMatchObject({ spent: 50000, limit: 0, pct: 0, over: true })
  })
})

describe('projectTotals', () => {
  const stages = [stage({ id: 's1', budget_amount: 60000 }), stage({ id: 's2', budget_amount: 40000 })]
  it('uses the project ceiling when it is set', () => {
    const r = projectTotals({ id: 'p1', budget_total: 500000 }, stages, [], [expense({ amount: 120000 })])
    expect(r.limit).toBe(500000)
    expect(r.spent).toBe(120000)
    expect(r.remaining).toBe(380000)
  })
  it('falls back to the sum of the stage ceilings', () => {
    const r = projectTotals({ id: 'p1', budget_total: 0 }, stages, [], [])
    expect(r.limit).toBe(100000)
  })
  it('includes expenses that have no stage', () => {
    const r = projectTotals({ id: 'p1', budget_total: 500000 }, stages, [], [
      expense({ amount: 10000, stage_id: 's1' }),
      expense({ amount: 5000, stage_id: null }),
    ])
    expect(r.spent).toBe(15000)
  })
  it('ignores expenses of another project', () => {
    const r = projectTotals({ id: 'p1', budget_total: 0 }, stages, [], [expense({ project_id: 'p2', amount: 999999 })])
    expect(r.spent).toBe(0)
  })
  it('projects the final cost and the overrun from the pending items', () => {
    const items = [item({ id: 'i1', quantity: 1, estimated_unit_price: 90000 })]
    const r = projectTotals({ id: 'p1', budget_total: 100000 }, stages, items, [expense({ amount: 40000 })])
    expect(r.planned).toBe(90000)
    expect(r.committed).toBe(130000)
    expect(r.projectedOverrun).toBe(30000)
  })
  it('reports no overrun when there is no ceiling at all', () => {
    const r = projectTotals({ id: 'p1', budget_total: 0 }, [], [], [expense({ amount: 40000 })])
    expect(r.projectedOverrun).toBe(0)
  })
})

describe('spentBySupplier', () => {
  it('ranks suppliers by total spent and names them', () => {
    const suppliers = [{ id: 'sup1', name: 'Leroy Merlin' }, { id: 'sup2', name: 'Telhanorte' }]
    const r = spentBySupplier([
      expense({ supplier_id: 'sup1', amount: 30000 }),
      expense({ supplier_id: 'sup2', amount: 50000 }),
      expense({ supplier_id: 'sup1', amount: 40000 }),
    ], suppliers)
    expect(r).toEqual([
      { supplier_id: 'sup1', name: 'Leroy Merlin', total: 70000, count: 2 },
      { supplier_id: 'sup2', name: 'Telhanorte', total: 50000, count: 1 },
    ])
  })
  it('groups the expenses without a supplier under one bucket', () => {
    const r = spentBySupplier([expense({ amount: 100 }), expense({ amount: 200 })], [], 'Sem fornecedor')
    expect(r).toEqual([{ supplier_id: null, name: 'Sem fornecedor', total: 300, count: 2 }])
  })
})

describe('expensesByStage / expensesByMonth', () => {
  it('keys stageless expenses under an empty string', () => {
    const r = expensesByStage([expense({ stage_id: 's1', amount: 100 }), expense({ stage_id: null, amount: 250 })])
    expect(r).toEqual({ s1: 100, '': 250 })
  })
  it('groups by YYYY-MM across a year boundary without timezone drift', () => {
    const r = expensesByMonth([
      expense({ date: '2026-12-31', amount: 100 }),
      expense({ date: '2027-01-01', amount: 200 }),
      expense({ date: '2027-01-31', amount: 300 }),
    ])
    expect(r).toEqual({ '2026-12': 100, '2027-01': 500 })
  })
})

describe('splitInstallments', () => {
  it('keeps the sum exact when the total does not divide evenly', () => {
    expect(splitInstallments(10000, 3)).toEqual([3333, 3333, 3334])
  })
  it('returns the whole total for a single installment', () => {
    expect(splitInstallments(10000, 1)).toEqual([10000])
    expect(splitInstallments(10000, 0)).toEqual([10000])
  })
  it('handles a zero total', () => {
    expect(splitInstallments(0, 4)).toEqual([0, 0, 0, 0])
  })
  it('always sums back to the total', () => {
    for (const total of [1, 7, 99, 100, 12345, 999999]) {
      for (const count of [1, 2, 3, 5, 12, 18]) {
        expect(splitInstallments(total, count).reduce((a, b) => a + b, 0)).toBe(total)
      }
    }
  })
})

describe('installmentDueDates', () => {
  it('clamps the day to the length of each month', () => {
    expect(installmentDueDates('2026-01-31', 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
  it('knows february in a leap year', () => {
    expect(installmentDueDates('2028-01-31', 2)).toEqual(['2028-01-31', '2028-02-29'])
  })
  it('rolls over into the next year', () => {
    expect(installmentDueDates('2026-11-15', 4)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15'])
  })
  it('returns just the purchase date for a single installment', () => {
    expect(installmentDueDates('2026-07-27', 1)).toEqual(['2026-07-27'])
  })
})

describe('installmentSchedule', () => {
  it('builds a numbered schedule whose amounts sum to the total', () => {
    const r = installmentSchedule({ amount: 10000, date: '2026-01-31', installments: 3 })
    expect(r).toEqual([
      { number: 1, due_date: '2026-01-31', amount: 3333 },
      { number: 2, due_date: '2026-02-28', amount: 3333 },
      { number: 3, due_date: '2026-03-31', amount: 3334 },
    ])
    expect(r.reduce((s, i) => s + i.amount, 0)).toBe(10000)
  })
  it('yields a single entry on the purchase date for a cash buy', () => {
    expect(installmentSchedule({ amount: 25000, date: '2026-07-27', installments: 1 })).toEqual([
      { number: 1, due_date: '2026-07-27', amount: 25000 },
    ])
  })
})

describe('itemPurchase', () => {
  const it10 = item({ id: 'i1', quantity: 10, estimated_unit_price: 9000 })
  it('reports nothing paid when no expense points at the item', () => {
    expect(itemPurchase(it10, [expense({ item_id: null, amount: 999 })])).toEqual({
      purchased: false, paid: 0, diffVsEstimate: 0,
    })
  })
  it('adds up partial purchases of the same item', () => {
    const r = itemPurchase(it10, [
      expense({ item_id: 'i1', amount: 50000 }),
      expense({ item_id: 'i1', amount: 45000 }),
    ])
    expect(r).toEqual({ purchased: true, paid: 95000, diffVsEstimate: 5000 })
  })
  it('reports a negative difference when it came in under the estimate', () => {
    expect(itemPurchase(it10, [expense({ item_id: 'i1', amount: 80000 })]).diffVsEstimate).toBe(-10000)
  })
})

describe('activeProjectsSpent', () => {
  it('skips cancelled projects', () => {
    const projects = [
      { id: 'p1', status: 'active' as const },
      { id: 'p2', status: 'cancelled' as const },
      { id: 'p3', status: 'done' as const },
    ]
    const expenses = [
      expense({ project_id: 'p1', amount: 1000 }),
      expense({ project_id: 'p2', amount: 5000 }),
      expense({ project_id: 'p3', amount: 300 }),
    ]
    expect(activeProjectsSpent(projects, expenses)).toBe(1300)
  })
  it('is zero with no projects', () => {
    expect(activeProjectsSpent([], [expense({ amount: 1000 })])).toBe(0)
  })
})

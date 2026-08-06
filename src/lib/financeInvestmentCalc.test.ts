import { describe, it, expect } from 'vitest'
import {
  positionDelta, accountDelta, accountInvestmentFlow,
  positionApplied, totalApplied, positionBreakdown,
  investmentTotals, investmentMonthlySeries, appliedByGroup,
} from './financeInvestmentCalc'
import type { FinanceInvestmentMovement, FinanceInvestmentMovementKind } from '../types'

type Mov = Pick<
  FinanceInvestmentMovement,
  'investment_id' | 'account_id' | 'kind' | 'amount' | 'settles_in_account' | 'date'
>

const mov = (over: Partial<Mov> & { kind: FinanceInvestmentMovementKind; amount: number }): Mov => ({
  investment_id: 'inv-1',
  account_id: 'acc-1',
  settles_in_account: true,
  date: '2026-07-10',
  ...over,
})

const position = (over: Partial<{ id: string; opening_balance: number; archived: boolean; institution: string; asset_class: 'fixed_income' | 'equity' | 'treasury' }> = {}) => ({
  id: 'inv-1',
  opening_balance: 0,
  archived: false,
  institution: 'C6',
  asset_class: 'fixed_income' as const,
  ...over,
})

describe('sign tables', () => {
  it('moves position and account in opposite directions for cash movements', () => {
    const contribution = mov({ kind: 'contribution', amount: 5000 })
    expect(positionDelta(contribution)).toBe(5000)
    expect(accountDelta(contribution)).toBe(-5000)

    const redemption = mov({ kind: 'redemption', amount: 3000 })
    expect(positionDelta(redemption)).toBe(-3000)
    expect(accountDelta(redemption)).toBe(3000)
  })

  // A yield paid into the checking account left the product; a capitalized one
  // never touched the bank. Same amount, opposite bookkeeping.
  it('splits yields by where they settled', () => {
    const credited = mov({ kind: 'yield', amount: 400, settles_in_account: true })
    expect(positionDelta(credited)).toBe(0)
    expect(accountDelta(credited)).toBe(400)

    const capitalized = mov({ kind: 'yield', amount: 400, settles_in_account: false })
    expect(positionDelta(capitalized)).toBe(400)
    expect(accountDelta(capitalized)).toBe(0)
  })

  it('splits taxes and fees the same way, mirrored', () => {
    for (const kind of ['tax', 'fee'] as const) {
      const withheldFromAccount = mov({ kind, amount: 120, settles_in_account: true })
      expect(positionDelta(withheldFromAccount)).toBe(0)
      expect(accountDelta(withheldFromAccount)).toBe(-120)

      const withheldInside = mov({ kind, amount: 120, settles_in_account: false })
      expect(positionDelta(withheldInside)).toBe(-120)
      expect(accountDelta(withheldInside)).toBe(0)
    }
  })
})

describe('accountInvestmentFlow', () => {
  const movements = [
    mov({ kind: 'contribution', amount: 5000 }),
    mov({ kind: 'redemption', amount: 2000 }),
    mov({ kind: 'contribution', amount: 1000, account_id: 'acc-2' }),
    mov({ kind: 'yield', amount: 300, settles_in_account: false }),
  ]

  it('nets only the movements of the given account', () => {
    expect(accountInvestmentFlow('acc-1', movements)).toBe(-3000)
    expect(accountInvestmentFlow('acc-2', movements)).toBe(-1000)
  })

  it('ignores unrelated accounts and movements with no account', () => {
    expect(accountInvestmentFlow('acc-9', movements)).toBe(0)
    expect(accountInvestmentFlow('acc-1', [mov({ kind: 'contribution', amount: 900, account_id: null })])).toBe(0)
  })
})

describe('positionApplied', () => {
  it('starts from the opening balance when there are no movements', () => {
    expect(positionApplied(position({ opening_balance: 30000 }), [])).toBe(30000)
  })

  it('adds contributions, subtracts redemptions and capitalizes internal yield', () => {
    const applied = positionApplied(position({ opening_balance: 10000 }), [
      mov({ kind: 'contribution', amount: 5000 }),
      mov({ kind: 'redemption', amount: 2000 }),
      mov({ kind: 'yield', amount: 700, settles_in_account: false }),
      mov({ kind: 'yield', amount: 400, settles_in_account: true }),
      mov({ kind: 'tax', amount: 100, settles_in_account: false }),
    ])
    expect(applied).toBe(10000 + 5000 - 2000 + 700 - 100)
  })

  it('ignores movements of other positions', () => {
    expect(positionApplied(position(), [mov({ kind: 'contribution', amount: 5000, investment_id: 'inv-2' })])).toBe(0)
  })
})

describe('totalApplied', () => {
  it('skips archived positions', () => {
    const investments = [
      position({ id: 'inv-1', opening_balance: 10000 }),
      position({ id: 'inv-2', opening_balance: 20000, archived: true }),
    ]
    expect(totalApplied(investments, [])).toBe(10000)
  })
})

describe('positionBreakdown', () => {
  it('splits the applied amount into its parts', () => {
    const b = positionBreakdown(position({ opening_balance: 10000 }), [
      mov({ kind: 'contribution', amount: 5000 }),
      mov({ kind: 'redemption', amount: 2000 }),
      mov({ kind: 'yield', amount: 700, settles_in_account: false }),
      mov({ kind: 'tax', amount: 100, settles_in_account: false }),
    ])
    expect(b).toMatchObject({ contributed: 15000, redeemed: 2000, earned: 700, costs: 100, movementCount: 4 })
    expect(b.applied).toBe(positionApplied(position({ opening_balance: 10000 }), [
      mov({ kind: 'contribution', amount: 5000 }),
      mov({ kind: 'redemption', amount: 2000 }),
      mov({ kind: 'yield', amount: 700, settles_in_account: false }),
      mov({ kind: 'tax', amount: 100, settles_in_account: false }),
    ]))
  })
})

describe('investmentTotals', () => {
  const movements = [
    mov({ kind: 'contribution', amount: 5000, date: '2026-07-03' }),
    mov({ kind: 'redemption', amount: 2000, date: '2026-07-28' }),
    mov({ kind: 'yield', amount: 400, date: '2026-07-31' }),
    mov({ kind: 'contribution', amount: 9999, date: '2026-08-01' }),
  ]

  it('consolidates one month only', () => {
    expect(investmentTotals('2026-07', movements)).toMatchObject({
      contributed: 5000, redeemed: 2000, earned: 400, costs: 0, net: 3000,
    })
  })

  it('returns zeros for a month with no movement', () => {
    expect(investmentTotals('2026-06', movements)).toMatchObject({ contributed: 0, redeemed: 0, net: 0 })
  })
})

describe('investmentMonthlySeries', () => {
  const months = ['2026-05', '2026-06', '2026-07']

  it('accumulates across months and carries flat months forward', () => {
    const { applied, contributed } = investmentMonthlySeries(months, [
      mov({ kind: 'contribution', amount: 1000, date: '2026-05-10' }),
      mov({ kind: 'contribution', amount: 2000, date: '2026-07-10' }),
      mov({ kind: 'yield', amount: 500, date: '2026-07-20', settles_in_account: false }),
    ])
    expect(applied).toEqual([1000, 1000, 3500])
    // The gap between the two series is the accumulated yield.
    expect(contributed).toEqual([1000, 1000, 3000])
  })

  it('folds movements older than the window into the starting value', () => {
    const { applied } = investmentMonthlySeries(months, [
      mov({ kind: 'contribution', amount: 8000, date: '2026-01-15' }),
      mov({ kind: 'contribution', amount: 1000, date: '2026-06-01' }),
    ])
    expect(applied).toEqual([8000, 9000, 9000])
  })

  it('starts from the opening total', () => {
    const { applied } = investmentMonthlySeries(months, [], 30000)
    expect(applied).toEqual([30000, 30000, 30000])
  })

  it('returns empty series for an empty window', () => {
    expect(investmentMonthlySeries([], [mov({ kind: 'contribution', amount: 1000 })])).toEqual({ applied: [], contributed: [] })
  })
})

describe('appliedByGroup', () => {
  const investments = [
    position({ id: 'inv-1', opening_balance: 10000, institution: 'C6', asset_class: 'fixed_income' }),
    position({ id: 'inv-2', opening_balance: 5000, institution: 'XP', asset_class: 'equity' }),
    position({ id: 'inv-3', opening_balance: 3000, institution: 'C6', asset_class: 'treasury' }),
    position({ id: 'inv-4', opening_balance: 9999, institution: 'XP', asset_class: 'equity', archived: true }),
  ]

  it('groups by institution, largest first', () => {
    expect(appliedByGroup(investments, [], 'institution')).toEqual([
      { key: 'C6', label: 'C6', value: 13000 },
      { key: 'XP', label: 'XP', value: 5000 },
    ])
  })

  it('groups by asset class', () => {
    expect(appliedByGroup(investments, [], 'asset_class').map(s => s.key)).toEqual(['fixed_income', 'equity', 'treasury'])
  })

  it('drops emptied positions — a chart cannot draw a zero slice', () => {
    const emptied = appliedByGroup(
      [position({ id: 'inv-1', opening_balance: 10000 })],
      [mov({ kind: 'redemption', amount: 10000 })],
      'institution',
    )
    expect(emptied).toEqual([])
  })

  it('labels a nameless institution as OUTROS', () => {
    const slices = appliedByGroup([position({ opening_balance: 100, institution: '' })], [], 'institution')
    expect(slices[0].key).toBe('OUTROS')
  })
})

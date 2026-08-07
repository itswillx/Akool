import { describe, expect, it } from 'vitest'
import { FINANCE_PHASES, goalPhase, salePhase } from './financePhase'

describe('salePhase', () => {
  it('treats a sale still being negotiated as planned', () => {
    expect(salePhase('negotiating')).toBe('planned')
  })

  it('keeps sold and shipped in doing', () => {
    // The money came in, but the operation only closes on delivery.
    expect(salePhase('sold')).toBe('doing')
    expect(salePhase('shipped')).toBe('doing')
  })

  it('closes on delivered and isolates cancelled', () => {
    expect(salePhase('delivered')).toBe('done')
    expect(salePhase('cancelled')).toBe('cancelled')
  })
})

describe('goalPhase', () => {
  it('is done once the goal is marked completed, even with nothing saved', () => {
    // The declaration beats the number.
    expect(goalPhase({ status: 'completed' }, 0)).toBe('done')
  })

  it('is planned while the goal is active and nothing was put in', () => {
    expect(goalPhase({ status: 'active' }, 0)).toBe('planned')
  })

  it('moves to doing on the first contribution', () => {
    expect(goalPhase({ status: 'active' }, 1)).toBe('doing')
  })

  it('keeps cancelled as its own phase regardless of what was saved', () => {
    expect(goalPhase({ status: 'cancelled' }, 500_00)).toBe('cancelled')
  })
})

describe('FINANCE_PHASES', () => {
  it('lists the columns in board order with cancelled last', () => {
    expect(FINANCE_PHASES).toEqual(['planned', 'doing', 'done', 'cancelled'])
  })
})

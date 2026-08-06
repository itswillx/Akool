import { describe, expect, it } from 'vitest'
import { FINANCE_PHASES, goalPhase, investmentPhase, projectPhase, salePhase } from './financePhase'

describe('projectPhase', () => {
  it('maps planning to planned and done to done', () => {
    expect(projectPhase('planning')).toBe('planned')
    expect(projectPhase('done')).toBe('done')
  })

  it('keeps a paused work in doing', () => {
    // The work exists and already has money in it — pausing does not turn it
    // back into a plan.
    expect(projectPhase('active')).toBe('doing')
    expect(projectPhase('paused')).toBe('doing')
  })

  it('keeps cancelled as its own phase', () => {
    expect(projectPhase('cancelled')).toBe('cancelled')
  })
})

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

describe('investmentPhase', () => {
  it('is done once archived, even with money still applied', () => {
    // Archiving is a declaration of intent and wins over the number.
    expect(investmentPhase({ archived: true }, 500_00)).toBe('done')
  })

  it('is doing while there is an applied position', () => {
    expect(investmentPhase({ archived: false }, 1)).toBe('doing')
  })

  it('is planned for a position with nothing applied yet', () => {
    expect(investmentPhase({ archived: false }, 0)).toBe('planned')
  })

  it('is planned when the position went negative (bad data, not a phase)', () => {
    expect(investmentPhase({ archived: false }, -100)).toBe('planned')
  })
})

describe('goalPhase', () => {
  it('is done once the goal is marked completed, even with nothing saved', () => {
    // Same rule as an archived investment: the declaration beats the number.
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

import { describe, expect, it } from 'vitest'
import { isTerminalStep, stepIndexOf, stepProgress, stepStates, type StepDef } from './boardStepper'

const SALE: StepDef[] = [
  { id: 'negotiating', label: 'Em negociação' },
  { id: 'sold', label: 'Vendido' },
  { id: 'shipped', label: 'Enviado' },
  { id: 'delivered', label: 'Entregue' },
]

describe('stepIndexOf', () => {
  it('finds the position of a status on the track', () => {
    expect(stepIndexOf(SALE, 'shipped')).toBe(2)
  })

  it('returns -1 for a status outside the track', () => {
    // 'cancelled' is a real sale status but not a step: it left the path.
    expect(stepIndexOf(SALE, 'cancelled')).toBe(-1)
  })
})

describe('stepStates', () => {
  it('splits the track into completed / current / upcoming', () => {
    expect(stepStates(SALE, 1)).toEqual(['completed', 'current', 'upcoming', 'upcoming'])
  })

  it('marks every step skipped when the card is off the track', () => {
    expect(stepStates(SALE, -1)).toEqual(['skipped', 'skipped', 'skipped', 'skipped'])
  })

  it('has no upcoming step on the last one', () => {
    expect(stepStates(SALE, 3)).toEqual(['completed', 'completed', 'completed', 'current'])
  })

  it('returns an empty list for an empty track', () => {
    expect(stepStates([], 0)).toEqual([])
  })
})

describe('isTerminalStep', () => {
  it('is true only on the last step', () => {
    expect(isTerminalStep(SALE, 3)).toBe(true)
    expect(isTerminalStep(SALE, 2)).toBe(false)
  })

  it('is false off the track and on an empty track', () => {
    expect(isTerminalStep(SALE, -1)).toBe(false)
    expect(isTerminalStep([], -1)).toBe(false)
  })
})

describe('stepProgress', () => {
  it('divides by the number of connectors, so the last step fills the rail', () => {
    expect(stepProgress(SALE, 0)).toBe(0)
    expect(stepProgress(SALE, 1)).toBeCloseTo(1 / 3)
    expect(stepProgress(SALE, 3)).toBe(1)
  })

  it('is zero off the track and with fewer than two steps', () => {
    expect(stepProgress(SALE, -1)).toBe(0)
    expect(stepProgress([{ id: 'a', label: 'A' }], 0)).toBe(0)
  })

  it('clamps an index past the end instead of overflowing the rail', () => {
    expect(stepProgress(SALE, 9)).toBe(1)
  })
})

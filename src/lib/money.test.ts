import { describe, expect, it } from 'vitest'
import { toCents, fromCents, formatBRL } from './money'

describe('toCents', () => {
  it('parses pt-BR formatted strings', () => {
    expect(toCents('1.234,56')).toBe(123456)
    expect(toCents('0,01')).toBe(1)
    expect(toCents('0,1')).toBe(10)
    expect(toCents('1.000.000,00')).toBe(100000000)
  })

  it('parses plain and en-formatted strings', () => {
    expect(toCents('1234.56')).toBe(123456)
    expect(toCents('1,234.56')).toBe(123456)
    expect(toCents('10')).toBe(1000)
    expect(toCents('1234,56')).toBe(123456)
  })

  it('reads dot-only grouping as pt-BR thousands', () => {
    expect(toCents('1.500')).toBe(150000)
    expect(toCents('2.500')).toBe(250000)
    expect(toCents('1.234.567')).toBe(123456700)
    expect(toCents('1.000.000')).toBe(100000000)
  })

  it('keeps a single dot as decimal when not a 3-digit group', () => {
    expect(toCents('0.500')).toBe(50)
    expect(toCents('2.50')).toBe(250)
    expect(toCents('2.5')).toBe(250)
    expect(toCents('1234.567')).toBe(123457)
  })

  it('reads comma-only grouping as en thousands', () => {
    expect(toCents('1,234,567')).toBe(123456700)
  })

  it('accepts a numeric value already in reais', () => {
    expect(toCents(12.34)).toBe(1234)
    expect(toCents(1000)).toBe(100000)
    expect(toCents(0)).toBe(0)
  })

  it('returns 0 for blank or invalid input', () => {
    expect(toCents('')).toBe(0)
    expect(toCents('   ')).toBe(0)
    expect(toCents('abc')).toBe(0)
    expect(toCents(NaN)).toBe(0)
    expect(toCents(Infinity)).toBe(0)
  })

  it('rounds to the nearest cent', () => {
    expect(toCents('1,999')).toBe(200)
    expect(toCents('1,994')).toBe(199)
  })
})

describe('fromCents', () => {
  it('converts cents back to a decimal in reais', () => {
    expect(fromCents(123456)).toBe(1234.56)
    expect(fromCents(1)).toBe(0.01)
    expect(fromCents(0)).toBe(0)
  })

  it('round-trips with toCents', () => {
    for (const v of ['1.234,56', '0,01', '99,99', '1234']) {
      expect(toCents(fromCents(toCents(v)))).toBe(toCents(v))
    }
  })
})

describe('formatBRL', () => {
  it('formats cents as Brazilian currency', () => {
    // Avoid asserting the exact (locale-data-dependent) currency symbol/spacing;
    // assert the number portion, which is stable for pt-BR.
    expect(formatBRL(123456)).toContain('1.234,56')
    expect(formatBRL(0)).toContain('0,00')
    expect(formatBRL(5)).toContain('0,05')
  })

  it('sums of cents do not drift (unlike float reais)', () => {
    // 0.1 + 0.2 !== 0.3 in float, but 10 + 20 === 30 in cents.
    const sum = toCents('0,10') + toCents('0,20')
    expect(sum).toBe(30)
    expect(formatBRL(sum)).toContain('0,30')
  })
})

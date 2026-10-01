import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentYM, daysUntil, fmt, last6Months, nextMonth, prevMonth, resolveTabRequest } from './financeFormat'

// ARCH-001: helpers que saíram do FinancePanel (abas, meses, prazos).

describe('resolveTabRequest', () => {
  it('aceita as abas atuais', () => {
    expect(resolveTabRequest('transactions')).toEqual({ tab: 'transactions', section: null })
    expect(resolveTabRequest('myprojects:store')).toEqual({ tab: 'myprojects', section: 'store' })
  })

  it('traduz os ids antigos para a sub-aba de Projetos', () => {
    expect(resolveTabRequest('store')).toEqual({ tab: 'myprojects', section: 'store' })
  })

  it('recusa lixo e vazio', () => {
    expect(resolveTabRequest(null)).toBeNull()
    expect(resolveTabRequest('nao-existe')).toBeNull()
  })
})

describe('meses', () => {
  it('anda e volta atravessando o ano', () => {
    expect(prevMonth('2026-01')).toBe('2025-12')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(nextMonth(prevMonth('2026-03'))).toBe('2026-03')
  })

  it('últimos 6 meses terminam no mês base, em ordem', () => {
    expect(last6Months('2026-02')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('mês atual no formato AAAA-MM', () => {
    expect(currentYM()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })
})

describe('daysUntil', () => {
  afterEach(() => { vi.useRealTimers() })

  it('conta dias de calendário até o prazo (negativo se passou)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 30, 15, 0))
    expect(daysUntil('2026-09-30')).toBe(0)
    expect(daysUntil('2026-10-10')).toBe(10)
    expect(daysUntil('2026-09-25')).toBe(-5)
  })
})

describe('fmt', () => {
  it('formata centavos em reais', () => {
    expect(fmt(123_456)).toMatch(/1\.234,56/)
  })
})

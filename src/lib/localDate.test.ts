import { describe, expect, it } from 'vitest'
import { localDateKey, localDaysBetween, msUntilNextLocalMidnight } from './localDate'

describe('localDateKey', () => {
  it('usa o calendário local, não o UTC', () => {
    // 22h30 locais: em Brasília, o toISOString() já diria "dia seguinte".
    expect(localDateKey(new Date(2026, 8, 26, 22, 30))).toBe('2026-09-26')
    expect(localDateKey(new Date(2026, 8, 26, 0, 0))).toBe('2026-09-26')
    expect(localDateKey(new Date(2026, 8, 26, 23, 59, 59))).toBe('2026-09-26')
  })

  it('completa mês e dia com zero', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
    expect(localDateKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
})

describe('localDaysBetween', () => {
  it('conta dias de calendário', () => {
    expect(localDaysBetween('2026-09-26', '2026-09-26')).toBe(0)
    expect(localDaysBetween('2026-09-25', '2026-09-26')).toBe(1)
    expect(localDaysBetween('2026-08-31', '2026-09-26')).toBe(26)
    expect(localDaysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('não erra na troca de horário de verão', () => {
    expect(localDaysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(localDaysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })

  it('negativo para data à frente e null para data inválida', () => {
    expect(localDaysBetween('2026-09-27', '2026-09-26')).toBe(-1)
    expect(localDaysBetween('ontem', '2026-09-26')).toBeNull()
  })
})

describe('msUntilNextLocalMidnight', () => {
  it('mede até a meia-noite local seguinte', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 8, 26, 23, 59, 0))).toBe(60_000)
    expect(msUntilNextLocalMidnight(new Date(2026, 8, 26, 21, 0, 0))).toBe(3 * 3_600_000)
  })
})

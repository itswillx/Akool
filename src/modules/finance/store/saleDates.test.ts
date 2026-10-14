import { afterEach, describe, expect, it, vi } from 'vitest'
import { saleDateMax, saoPauloToday } from './saleDates'

// API-028 (#14 da revisão): o teto da data da venda é o menor entre o amanhã
// do aparelho e o de São Paulo (o do gatilho). Cada fuso em par: a meia hora
// antes e a meia hora depois da virada que muda a resposta. O stubEnv grava no
// process.env, e o Node relê o TZ (o pool do vitest é forks).

afterEach(() => { vi.unstubAllEnvs() })

// Offsets de outubro de 2026: o Brasil não tem horário de verão; Lisboa está
// no de verão (UTC+1) até 25/10.
const at = (tz: string, offset: number, instant: string) => {
  vi.stubEnv('TZ', tz)
  const now = new Date(instant)
  // Pré-condição: o fuso fixado vale; sem ela o caso rodaria no fuso do processo.
  expect(now.getTimezoneOffset()).toBe(offset)
  return now
}

describe('saleDateMax: aparelho adiantado em relação a São Paulo', () => {
  it.each([
    { tz: 'America/Noronha', offset: 120, before: '2026-10-13T02:30:00Z', after: '2026-10-13T03:30:00Z' },
    { tz: 'Europe/Lisbon', offset: -60, before: '2026-10-12T23:30:00Z', after: '2026-10-13T03:30:00Z' },
  ])('$tz: depois da meia-noite local e antes da de São Paulo, o teto é o amanhã de São Paulo', ({ tz, offset, before, after }) => {
    // 00:30 no aparelho em 13/10, ainda 12/10 em São Paulo: o amanhã do
    // aparelho (14/10) o servidor recusaria.
    const night = at(tz, offset, before)
    expect(saoPauloToday(night)).toBe('2026-10-12')
    expect(saleDateMax(night)).toBe('2026-10-13')
    // Passada a meia-noite de São Paulo, os dois amanhãs coincidem.
    const later = at(tz, offset, after)
    expect(saoPauloToday(later)).toBe('2026-10-13')
    expect(saleDateMax(later)).toBe('2026-10-14')
  })
})

describe('saleDateMax: aparelho atrasado ou no fuso de São Paulo', () => {
  it('Manaus: antes da meia-noite local, o teto é o amanhã do aparelho (não o de São Paulo)', () => {
    const night = at('America/Manaus', 240, '2026-10-13T03:30:00Z') // 23:30 de 12/10 em Manaus, 00:30 de 13/10 em SP
    expect(saoPauloToday(night)).toBe('2026-10-13')
    expect(saleDateMax(night)).toBe('2026-10-13')
    const morning = at('America/Manaus', 240, '2026-10-13T04:30:00Z') // 00:30 de 13/10 em Manaus
    expect(saleDateMax(morning)).toBe('2026-10-14')
  })

  it('São Paulo: o teto é o amanhã, dos dois lados da meia-noite', () => {
    expect(saleDateMax(at('America/Sao_Paulo', 180, '2026-10-13T02:30:00Z'))).toBe('2026-10-13')
    expect(saleDateMax(at('America/Sao_Paulo', 180, '2026-10-13T03:30:00Z'))).toBe('2026-10-14')
  })

  it('vira o mês e o ano pelo calendário', () => {
    expect(saleDateMax(at('America/Sao_Paulo', 180, '2026-12-31T15:00:00Z'))).toBe('2027-01-01')
    expect(saleDateMax(at('America/Sao_Paulo', 180, '2026-02-28T15:00:00Z'))).toBe('2026-03-01')
  })
})

import { describe, expect, it } from 'vitest'
import { dayGroup, exactDateTime, relativeTime } from './relativeTime'

const NOW = new Date(2026, 9, 4, 15, 0, 0)
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000)

describe('relativeTime', () => {
  it.each([
    [10, 'pt-BR', 'agora'],
    [50, 'pt-BR', 'há 1 minuto'],
    [5 * 60, 'pt-BR', 'há 5 minutos'],
    [3 * 3600, 'pt-BR', 'há 3 horas'],
    [26 * 3600, 'pt-BR', 'há 1 dia'],
    [10 * 86400, 'pt-BR', 'há 1 semana'],
    [58 * 86400, 'pt-BR', 'há 1 mês'],
    [400 * 86400, 'pt-BR', 'há 1 ano'],
    [5 * 60, 'en', '5 minutes ago'],
    [26 * 3600, 'en', '1 day ago'],
  ] as const)('%ss → %s: %s', (seconds, lang, text) => {
    expect(relativeTime(ago(seconds), NOW, lang)).toBe(text)
  })

  it('relógio adiantado (data no futuro) vira "agora"', () => {
    expect(relativeTime(new Date(NOW.getTime() + 60_000), NOW, 'pt-BR')).toBe('agora')
  })
})

describe('dayGroup', () => {
  it.each([
    [new Date(2026, 9, 4, 0, 5), 'today'],
    [new Date(2026, 9, 3, 23, 59), 'yesterday'],
    [new Date(2026, 9, 1, 12, 0), 'week'],
    [new Date(2026, 8, 20, 12, 0), 'earlier'],
    // Relógio adiantado: conta como hoje.
    [new Date(2026, 9, 5, 9, 0), 'today'],
  ] as const)('%s → %s', (date, group) => {
    expect(dayGroup(date, NOW)).toBe(group)
  })
})

it('exactDateTime: data longa e hora no idioma', () => {
  expect(exactDateTime(NOW, 'pt-BR')).toMatch(/4 de outubro de 2026.*15:00/)
  expect(exactDateTime(NOW, 'en')).toMatch(/October 4, 2026.*3:00/)
})

import { describe, expect, it } from 'vitest'
import { daySegments, diffDays, monthSegments, weekSegments, yearSegments, type Segment } from './ganttLayout'

// Faixas do cabeçalho do cronograma: o GanttView desenha cada célula com
// `width: seg.days * pxPerDay`, então `days` tem de parar no fim do mês, do ano
// ou da semana, e nunca passar do fim do intervalo.

const spans = (segs: Segment[]) => segs.map(s => [s.offset, s.days, s.key])

describe('faixas do cabeçalho: tamanho de cada faixa', () => {
  it('meses parciais no começo e no fim', () => {
    expect(spans(monthSegments('2026-01-20', '2026-03-10'))).toEqual([
      [0, 12, '2026-01-01'],
      [12, 28, '2026-02-01'],
      [40, 10, '2026-03-01'],
    ])
  })

  it('fevereiro bissexto', () => {
    expect(spans(monthSegments('2028-02-10', '2028-03-02'))).toEqual([
      [0, 20, '2028-02-01'],
      [20, 2, '2028-03-01'],
    ])
  })

  it('anos cruzando duas viradas', () => {
    expect(yearSegments('2025-12-30', '2027-01-02').map(s => [s.offset, s.days, s.key, s.date])).toEqual([
      [0, 2, '2025', '2025-12-30'],
      [2, 365, '2026', '2026-01-01'],
      [367, 2, '2027', '2027-01-01'],
    ])
  })

  it('semanas parciais, começando na segunda', () => {
    // 15/07/2026 é quarta: a primeira semana começa na segunda, 13/07.
    expect(spans(weekSegments('2026-07-15', '2026-07-28'))).toEqual([
      [0, 5, '2026-07-13'],
      [5, 7, '2026-07-20'],
      [12, 2, '2026-07-27'],
    ])
  })

  it('intervalo dentro de um só mês, ano e semana', () => {
    expect(spans(monthSegments('2026-05-05', '2026-05-07'))).toEqual([[0, 3, '2026-05-01']])
    expect(spans(yearSegments('2026-05-05', '2026-05-07'))).toEqual([[0, 3, '2026']])
    expect(spans(weekSegments('2026-05-05', '2026-05-07'))).toEqual([[0, 3, '2026-05-04']])
  })
})

describe('faixas do cabeçalho: cobrem o intervalo sem buraco e sem sobra', () => {
  const ranges: Array<[string, string]> = [
    ['2026-03-15', '2026-03-15'],
    ['2026-01-31', '2026-02-01'],
    ['2025-12-31', '2026-01-01'],
    ['2026-07-19', '2026-07-20'],
    ['2024-02-28', '2024-03-01'],
    ['2025-11-03', '2027-04-18'],
  ]
  const kinds = { monthSegments, yearSegments, weekSegments, daySegments }

  for (const [name, fn] of Object.entries(kinds)) {
    it.each(ranges)(`${name} de %s a %s`, (start, end) => {
      const segs = fn(start, end)
      const total = diffDays(start, end) + 1
      expect(segs[0].offset).toBe(0)
      for (let i = 1; i < segs.length; i++) expect(segs[i].offset).toBe(segs[i - 1].offset + segs[i - 1].days)
      expect(segs.every(s => s.days >= 1)).toBe(true)
      expect(segs.reduce((sum, s) => sum + s.days, 0)).toBe(total)
    })
  }
})

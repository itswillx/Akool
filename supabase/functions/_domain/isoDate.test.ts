import { describe, expect, it } from 'vitest'
import { addDays, diffDays, isoFromUTC, isOverdue, mondayOf, toUTC } from './isoDate.ts'

// API-027: datas de calendário em UTC, sem relógio. O resultado não depende do
// fuso de quem roda o teste (o CI roda em UTC; o Deno também).

describe('toUTC e isoFromUTC', () => {
  it('ida e volta pela meia-noite UTC', () => {
    expect(toUTC('2025-03-10')).toBe(Date.UTC(2025, 2, 10))
    expect(isoFromUTC(Date.UTC(2025, 2, 10, 23, 59))).toBe('2025-03-10')
    expect(isoFromUTC(toUTC('2024-02-29'))).toBe('2024-02-29')
  })
})

describe('addDays e diffDays', () => {
  it('viram mês, ano e o 29 de fevereiro', () => {
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01')
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28')
    expect(diffDays('2024-02-28', '2024-03-01')).toBe(2)
    expect(diffDays('2025-02-28', '2025-03-01')).toBe(1)
    expect(diffDays('2025-03-10', '2025-03-03')).toBe(-7)
  })

  it('não perdem a hora do início do horário de verão (09/03/2025 nos EUA)', () => {
    expect(diffDays('2025-03-03', '2025-03-10')).toBe(7)
    expect(addDays('2025-03-09', 1)).toBe('2025-03-10')
  })
})

describe('mondayOf', () => {
  it('a semana vai de segunda a domingo', () => {
    expect(mondayOf('2025-03-10')).toBe('2025-03-10') // segunda
    expect(mondayOf('2025-03-12')).toBe('2025-03-10') // quarta
    expect(mondayOf('2025-03-09')).toBe('2025-03-03') // domingo
    expect(mondayOf('2025-01-01')).toBe('2024-12-30') // quarta, semana que vem de dezembro
  })
})

describe('isOverdue', () => {
  it('só card aberto com prazo antes de hoje', () => {
    const today = '2025-03-10'
    expect(isOverdue({ due_date: '2025-03-09', completed: false }, today)).toBe(true)
    expect(isOverdue({ due_date: '2025-03-10', completed: false }, today)).toBe(false)
    expect(isOverdue({ due_date: '2025-03-09', completed: true }, today)).toBe(false)
    expect(isOverdue({ due_date: null, completed: false }, today)).toBe(false)
  })
})

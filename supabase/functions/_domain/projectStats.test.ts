import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isoFromUTC } from './isoDate.ts'
import { createdPerWeek, dueBuckets, overviewSummary, type StatsCard } from './projectStats.ts'

// API-027: as estatísticas sem relógio. O dia de criação vem de `dayOf`, e o
// teste usa um fixo de São Paulo (UTC−3, sem horário de verão desde 2019) que
// não depende do fuso do processo. O describe do createdPerWeek fixa o fuso em
// America/New_York: o CI roda em UTC e o dev em São Paulo, os dois sem horário
// de verão, e só num fuso com ele a conta em hora local volta a errar a semana.

const saoPauloDay = (createdAt: string) => isoFromUTC(Date.parse(createdAt) - 3 * 3_600_000)
const utcDay = (createdAt: string) => createdAt.slice(0, 10)

const card = (over: Partial<StatsCard> = {}): StatsCard => ({
  column_id: 'c1', priority: 'medium', due_date: null, completed: false, assignee_user_id: null, created_at: null, ...over,
})

describe('createdPerWeek: o dia de criação é o de quem vê', () => {
  // O stubEnv grava no process.env, e o Node relê o TZ (o pool do vitest é forks).
  beforeAll(() => { vi.stubEnv('TZ', 'America/New_York') })
  afterAll(() => { vi.unstubAllEnvs() })

  // Domingo 09/03/2025 às 22:30 em São Paulo, como o PostgREST devolve o created_at.
  const sundayNight = '2025-03-10T01:30:00.123456+00:00'

  it('o card de domingo à noite em São Paulo cai na semana de 03/03, não na de 10/03', () => {
    const weeks = createdPerWeek([card({ created_at: sundayNight })], 2, '2025-03-12', saoPauloDay)
    expect(weeks).toEqual([{ weekStart: '2025-03-03', count: 1 }, { weekStart: '2025-03-10', count: 0 }])
    // O dia UTC (o slice do created_at, como era antes) jogava o card na semana seguinte.
    expect(createdPerWeek([card({ created_at: sundayNight })], 2, '2025-03-12', utcDay))
      .toEqual([{ weekStart: '2025-03-03', count: 0 }, { weekStart: '2025-03-10', count: 1 }])
  })

  it('no próprio domingo à noite, o card recém-criado não some do gráfico', () => {
    const weeks = createdPerWeek([card({ created_at: sundayNight })], 8, '2025-03-09', saoPauloDay)
    expect(weeks.reduce((sum, w) => sum + w.count, 0)).toBe(1)
    expect(weeks.at(-1)).toEqual({ weekStart: '2025-03-03', count: 1 })
    // Com o dia UTC (10/03), a semana dele ainda não existe e o card sumia.
    expect(createdPerWeek([card({ created_at: sundayNight })], 8, '2025-03-09', utcDay).reduce((sum, w) => sum + w.count, 0)).toBe(0)
  })

  it('a segunda-feira depois do início do horário de verão fica na própria semana', () => {
    // Antes, a diferença em ms entre meias-noites locais perdia 1 h (America/New_York, 09/03/2025).
    // Pré-condição: o fuso fixado vale, e o domingo tem 23 h; sem ela o teste passaria à toa.
    expect(Date.parse('2025-03-10T00:00:00') - Date.parse('2025-03-09T00:00:00')).toBe(23 * 3_600_000)
    const weeks = createdPerWeek([card({ created_at: '2025-03-10T12:00:00Z' }), card({ created_at: '2025-03-09T12:00:00Z' })], 3, '2025-03-12', utcDay)
    expect(weeks).toEqual([
      { weekStart: '2025-02-24', count: 0 },
      { weekStart: '2025-03-03', count: 1 },
      { weekStart: '2025-03-10', count: 1 },
    ])
  })

  it('sem created_at ou fora da janela não conta', () => {
    const weeks = createdPerWeek([card(), card({ created_at: '2025-01-01T12:00:00Z' }), card({ created_at: '2025-03-20T12:00:00Z' })], 2, '2025-03-12', utcDay)
    expect(weeks.map(w => w.count)).toEqual([0, 0])
  })
})

describe('today vem de quem chama', () => {
  it('o mesmo quadro muda de atrasado e de semana conforme o dia passado', () => {
    const cards = [card({ due_date: '2025-03-09' }), card({ due_date: '2025-03-10' }), card({ due_date: '2025-03-16', completed: true })]
    expect(overviewSummary(cards, '2025-03-09')).toMatchObject({ overdue: 0, dueThisWeekOpen: 1 })
    expect(overviewSummary(cards, '2025-03-10')).toMatchObject({ overdue: 1, dueThisWeekOpen: 1 })
    expect(dueBuckets(cards, '2025-03-09')).toEqual({ overdue: 0, today: 1, week: 0, later: 1, none: 0 })
    expect(dueBuckets(cards, '2025-03-10')).toEqual({ overdue: 1, today: 1, week: 0, later: 0, none: 0 })
  })
})

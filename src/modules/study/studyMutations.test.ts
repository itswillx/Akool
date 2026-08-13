import { describe, expect, it } from 'vitest'
import {
  applyReschedule,
  planReschedule,
  rescheduleFailures,
  revertReschedule,
  type ReschedulePlanItem,
} from './studyMutations'
import type { WriteResult } from '../../lib/optimistic'
import type { StudyCard } from '../../types'

const card = (id: string, sort_order: number, due_date: string | null): StudyCard => ({
  id,
  user_id: 'u1',
  topic_id: 't1',
  title: id,
  description: '',
  rationale: '',
  checkpoints: [],
  resources: [],
  quiz: [],
  sort_order,
  due_date,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
})

const NOW = '2026-08-12T12:00:00.000Z'
const DATES = ['2026-08-20', '2026-08-25', '2026-08-30']

const sorted = () => [card('a', 0, null), card('b', 1, '2026-01-15'), card('c', 2, null)]

const ok = (): PromiseSettledResult<WriteResult<{ id: string }[]>> =>
  ({ status: 'fulfilled', value: { data: [{ id: 'x' }], error: null } })
const failed = (): PromiseSettledResult<WriteResult<{ id: string }[]>> =>
  ({ status: 'fulfilled', value: { data: null, error: { message: 'permission denied', code: '42501' } } })
const blockedByRls = (): PromiseSettledResult<WriteResult<{ id: string }[]>> =>
  ({ status: 'fulfilled', value: { data: [], error: null } })
const rejected = (): PromiseSettledResult<WriteResult<{ id: string }[]>> =>
  ({ status: 'rejected', reason: new TypeError('Failed to fetch') })

describe('planReschedule', () => {
  it('casa cada card com sua data por id, e guarda o valor anterior', () => {
    const plan = planReschedule(sorted(), DATES, NOW)
    expect(plan.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(plan[1].applied).toEqual({ due_date: '2026-08-25', updated_at: NOW })
    expect(plan[1].before).toEqual({ due_date: '2026-01-15', updated_at: '2026-01-01T00:00:00.000Z' })
  })
})

describe('applyReschedule', () => {
  it('aplica por id, ignorando a ordem do array no estado', () => {
    const plan = planReschedule(sorted(), DATES, NOW)
    // O estado guarda os cards fora de ordem de propósito.
    const out = applyReschedule([card('c', 2, null), card('a', 0, null)], plan)
    expect(out.map(c => [c.id, c.due_date])).toEqual([['c', '2026-08-30'], ['a', '2026-08-20']])
  })

  it('nao toca em cards que nao estao no plano', () => {
    const outsider = card('z', 9, '2026-12-01')
    const out = applyReschedule([outsider], planReschedule(sorted(), DATES, NOW))
    expect(out[0]).toBe(outsider)
  })
})

describe('rescheduleFailures', () => {
  const plan = (): ReschedulePlanItem[] => planReschedule(sorted(), DATES, NOW)

  it('devolve lista vazia quando todos gravaram', () => {
    expect(rescheduleFailures(plan(), [ok(), ok(), ok()])).toEqual([])
  })

  it('pega error, rejeicao e 0 linhas por RLS', () => {
    expect(rescheduleFailures(plan(), [failed(), rejected(), blockedByRls()]).map(i => i.id))
      .toEqual(['a', 'b', 'c'])
  })

  it('isola o item do meio quando so ele falha', () => {
    expect(rescheduleFailures(plan(), [ok(), failed(), ok()]).map(i => i.id)).toEqual(['b'])
  })
})

describe('revertReschedule', () => {
  it('reverte so os que falharam e preserva os que gravaram', () => {
    const plan = planReschedule(sorted(), DATES, NOW)
    const applied = applyReschedule(sorted(), plan)
    const out = revertReschedule(applied, rescheduleFailures(plan, [ok(), failed(), ok()]))

    // 'b' volta para a data antiga; 'a' e 'c' ficam com a nova (ja estao no banco).
    expect(out.map(c => [c.id, c.due_date])).toEqual([
      ['a', '2026-08-20'],
      ['b', '2026-01-15'],
      ['c', '2026-08-30'],
    ])
    // Os que passaram sequer foram reconstruidos.
    expect(out[0]).toBe(applied[0])
    expect(out[2]).toBe(applied[2])
    expect(out[1].updated_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('devolve a mesma lista quando nada falhou', () => {
    const applied = applyReschedule(sorted(), planReschedule(sorted(), DATES, NOW))
    expect(revertReschedule(applied, [])).toBe(applied)
  })

  it('nao desfaz uma edicao manual de due_date que pousou durante o write', () => {
    const plan = planReschedule(sorted(), DATES, NOW)
    const applied = applyReschedule(sorted(), plan)
    // O usuario mexeu na data do card 'b' enquanto o reschedule estava em voo.
    const raced = applied.map(c => (c.id === 'b' ? { ...c, due_date: '2026-09-09', updated_at: 'T9' } : c))

    const out = revertReschedule(raced, rescheduleFailures(plan, [ok(), failed(), ok()]))
    expect(out).toBe(raced)
    expect(out[1].due_date).toBe('2026-09-09')
  })
})

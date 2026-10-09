import { describe, expect, it } from 'vitest'
import { autoBudgetSourcesKey, mergeById, mergePendingInvites, mergeRecurringEntries, needsCategoryBootstrap, splitMaterializedBudgets, viewedMonthNeedsBudgets } from './financeLoad'

describe('needsCategoryBootstrap (PERF-003)', () => {
  it('seeds only when the user has no category at all', () => {
    expect(needsCategoryBootstrap([])).toBe(true)
    expect(needsCategoryBootstrap(null)).toBe(true)
  })

  it('does not seed again after a default category was deleted or renamed', () => {
    expect(needsCategoryBootstrap([{ name: 'Mercado' }])).toBe(false)
  })
})

describe('mergePendingInvites', () => {
  it('joins invites by user id and by e-mail without repeating', () => {
    const merged = mergePendingInvites([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], null)
    expect(merged.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeById (API-016)', () => {
  it('a linha do servidor vence a que já estava, e as novas entram no fim', () => {
    const merged = mergeById([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'b', v: 2 }, { id: 'c', v: 2 }])
    expect(merged).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 2 }])
  })

  it('sem nada novo, devolve a mesma lista', () => {
    const existing = [{ id: 'a' }]
    expect(mergeById(existing, [])).toBe(existing)
  })
})

describe('mergeRecurringEntries', () => {
  const entry = (id: string, due_date: string, status = 'pending') => ({ id, due_date, status })

  it('adds the newly created entries in due-date order', () => {
    const merged = mergeRecurringEntries([entry('a', '2026-09-05'), entry('b', '2026-10-05')], [entry('c', '2026-09-20')])
    expect(merged.map(e => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('keeps the same list when nothing came back, and never duplicates', () => {
    const existing = [entry('a', '2026-09-05')]
    expect(mergeRecurringEntries(existing, [])).toBe(existing)
    expect(mergeRecurringEntries(existing, [entry('a', '2026-09-05')])).toHaveLength(1)
  })

  it('API-016: a versão do servidor substitui a da carga (dia movido, pago por outra aba)', () => {
    const merged = mergeRecurringEntries([entry('a', '2026-10-10'), entry('b', '2026-11-10')], [entry('a', '2026-10-20', 'paid')])
    expect(merged).toEqual([entry('a', '2026-10-20', 'paid'), entry('b', '2026-11-10')])
  })
})

describe('splitMaterializedBudgets (API-016)', () => {
  // O servidor devolve todos os orçamentos dos meses que a pessoa enxerga: os
  // pessoais dela e os do workspace, inclusive os de outro membro.
  const rows = [
    { id: 'p', user_id: 'eu', workspace_id: null },
    { id: 'w', user_id: 'eu', workspace_id: 'ws1' },
    { id: 'wa', user_id: 'outro', workspace_id: 'ws1' },
    { id: 'x', user_id: 'eu', workspace_id: 'ws2' },
  ]

  it('os da pessoa vão para `budgets`; o de outro membro, só para os da família', () => {
    const { own, family } = splitMaterializedBudgets(rows, 'eu', 'ws1')
    expect(own.map(b => b.id)).toEqual(['p', 'w', 'x'])
    expect(family.map(b => b.id)).toEqual(['w', 'wa'])
  })

  it('sem workspace aberto, nenhum na família; sem usuário, nenhum próprio', () => {
    expect(splitMaterializedBudgets(rows, 'eu', null).family).toEqual([])
    expect(splitMaterializedBudgets(rows, undefined, 'ws1').own).toEqual([])
  })
})

describe('viewedMonthNeedsBudgets (API-016)', () => {
  it('o mês atual e o seguinte são do servidor: não pede', () => {
    expect(viewedMonthNeedsBudgets('2026-10', '2026-10')).toBe(false)
    expect(viewedMonthNeedsBudgets('2026-11', '2026-10')).toBe(false)
  })

  it('mês+2 em diante e meses passados pedem, até 12 meses para cada lado (virando o ano)', () => {
    expect(viewedMonthNeedsBudgets('2026-12', '2026-10')).toBe(true)
    expect(viewedMonthNeedsBudgets('2027-01', '2026-10')).toBe(true)
    expect(viewedMonthNeedsBudgets('2026-09', '2026-10')).toBe(true)
    expect(viewedMonthNeedsBudgets('2027-10', '2026-10')).toBe(true)
    expect(viewedMonthNeedsBudgets('2025-10', '2026-10')).toBe(true)
  })

  it('mais longe que 12 meses, o servidor ignora: não pede', () => {
    expect(viewedMonthNeedsBudgets('2027-11', '2026-10')).toBe(false)
    expect(viewedMonthNeedsBudgets('2025-09', '2026-10')).toBe(false)
  })
})

describe('autoBudgetSourcesKey (API-016)', () => {
  const rec = (id: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'expense' as const, active: true, is_variable: false, category_id: 'c1', amount: 8000,
    total_installments: null, workspace_id: null, ...extra,
  })

  it('só despesa ativa, fixa, com categoria e valor gera orçamento', () => {
    expect(autoBudgetSourcesKey([
      rec('inativo', { active: false }), rec('receita', { type: 'income' }), rec('variavel', { is_variable: true }),
      rec('sem-categoria', { category_id: null }), rec('zero', { amount: 0 }), rec('sem-valor', { amount: null }),
    ])).toBe('')
    expect(autoBudgetSourcesKey([rec('r1')])).not.toBe('')
  })

  it('a ordem não muda a chave; o valor muda', () => {
    expect(autoBudgetSourcesKey([rec('a'), rec('b')])).toBe(autoBudgetSourcesKey([rec('b'), rec('a')]))
    expect(autoBudgetSourcesKey([rec('a')])).not.toBe(autoBudgetSourcesKey([rec('a', { amount: 9000 })]))
  })
})

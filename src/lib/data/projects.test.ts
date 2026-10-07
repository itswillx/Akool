import { beforeEach, describe, expect, it, vi } from 'vitest'

// API-013: a edição do card vai sobre a versão do servidor (updated_at) e, com
// zero linhas, relê o card para separar conflito, reenvio duplicado e card
// apagado. O card novo e as datas da linha do tempo não mandam versão.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as string[], values: [] as unknown[] }))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const ops: string[] = []
      const b = {
        update: (values: unknown) => { ops.push('update'); db.values.push(values); return b },
        insert: (values: unknown) => { ops.push('insert'); db.values.push(values); return b },
        select: (cols: string) => { ops.push(`select(${cols})`); return b },
        single: () => b, maybeSingle: () => b,
        eq: (col: string, value: unknown) => { ops.push(`${col}=${String(value)}`); return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(`${table}:${ops.join(',')}`)
          return Promise.resolve(db.queue.shift() ?? { data: [], error: null }).then(resolve, reject)
        },
      }
      return b
    },
  },
}))

const { cardPatchMatches, changedFields, diffCardFields, insertCard, normalizeCard, rescheduleCard, saveCardVersioned } = await import('./projects')

const row = (title: string, updated_at: string, extra: Record<string, unknown> = {}) => ({
  id: 'c1', board_id: 'b1', column_id: 'col1', title, description: '', priority: 'medium', start_date: null, due_date: null,
  estimated_days: 1, assignee_user_id: null, labels: null, linked_page_id: null, parent_card_id: null, depends_on: [],
  completed: false, checklist: null, attachments: null, links: null, sort_order: 0, created_at: '', updated_at, ...extra,
})

beforeEach(() => {
  db.queue = []
  db.calls = []
  db.values = []
})

describe('diffCardFields, changedFields e cardPatchMatches', () => {
  it('só os campos que mudaram, comparando listas e objetos pelo conteúdo', () => {
    const base = { title: 'a', labels: ['x'], checklist: [{ id: '1', text: 't', completed: false }], due_date: null }
    expect(diffCardFields(base, { title: 'a', labels: ['x'], checklist: [{ id: '1', text: 't', completed: true }], due_date: null }))
      .toEqual({ checklist: [{ id: '1', text: 't', completed: true }] })
    expect(diffCardFields(base, { ...base })).toEqual({})
    expect(changedFields(base, { ...base, title: 'b' }, ['title', 'labels'])).toEqual(['title'])
    expect(cardPatchMatches({ title: 'a', labels: ['x'] }, { labels: ['x'] })).toBe(true)
    expect(cardPatchMatches({ title: 'a', labels: ['x'] }, { labels: ['X'] })).toBe(false)
  })

  it('normalizeCard troca jsonb nulo por lista vazia', () => {
    expect(normalizeCard(row('a', 'v1') as never)).toMatchObject({ labels: [], checklist: [], attachments: [], links: [], depends_on: [] })
  })
})

describe('saveCardVersioned', () => {
  it('grava sobre a versão e devolve a versão nova', async () => {
    db.queue = [{ data: [{ id: 'c1', updated_at: 'v2' }], error: null }]
    expect(await saveCardVersioned('c1', { title: 'x' }, 'v1')).toEqual({ status: 'saved', at: 'v2' })
    expect(db.calls).toEqual(['project_cards:update,id=c1,updated_at=v1,select(id, updated_at)'])
    expect(db.values).toEqual([{ title: 'x' }])
  })

  it('zero linhas e outra versão no servidor: conflito com o card de lá', async () => {
    db.queue = [{ data: [], error: null }, { data: row('deles', 'v3'), error: null }]
    expect(await saveCardVersioned('c1', { title: 'x' }, 'v1')).toMatchObject({
      status: 'conflict', current: { title: 'deles', labels: [], updated_at: 'v3' },
    })
    expect(db.calls[1]).toBe('project_cards:select(*),id=c1')
  })

  it('zero linhas, mas o servidor já tem o patch (reenvio duplicado): gravado', async () => {
    db.queue = [{ data: [], error: null }, { data: row('x', 'v2'), error: null }]
    expect(await saveCardVersioned('c1', { title: 'x' }, 'v1')).toEqual({ status: 'saved', at: 'v2' })
  })

  it('zero linhas e o card não existe mais: gone', async () => {
    db.queue = [{ data: [], error: null }, { data: null, error: null }]
    expect(await saveCardVersioned('c1', { title: 'x' }, 'v1')).toEqual({ status: 'gone' })
  })

  it('erro na gravação ou na releitura sobe como error', async () => {
    const rule = { message: 'Essa dependência criaria um ciclo', code: '23514', hint: 'akool' }
    db.queue = [{ data: null, error: rule }]
    expect(await saveCardVersioned('c1', { depends_on: ['c2'] }, 'v1')).toEqual({ status: 'error', error: rule })
    db.queue = [{ data: [], error: null }, { data: null, error: { message: 'falhou' } }]
    expect(await saveCardVersioned('c1', { title: 'x' }, 'v1')).toEqual({ status: 'error', error: { message: 'falhou' } })
  })
})

describe('sem versão', () => {
  it('card novo vai sem sort_order e sem updated_at (o gatilho preenche)', async () => {
    db.queue = [{ data: row('novo', 'v1'), error: null }]
    await insertCard({ board_id: 'b1', column_id: 'col1', title: 'novo' })
    expect(db.calls).toEqual(['project_cards:insert,select(*)'])
    expect(db.values[0]).not.toHaveProperty('sort_order')
    expect(db.values[0]).not.toHaveProperty('updated_at')
  })

  it('datas da linha do tempo vão sem versão e pedem a versão nova de volta', async () => {
    await rescheduleCard('c1', { start_date: '2026-10-01', due_date: '2026-10-03' })
    expect(db.calls).toEqual(['project_cards:update,id=c1,select(id, updated_at)'])
    expect(db.values).toEqual([{ start_date: '2026-10-01', due_date: '2026-10-03' }])
  })
})

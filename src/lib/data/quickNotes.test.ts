import { beforeEach, describe, expect, it, vi } from 'vitest'

// API-003: a gravação das notas rápidas vai sobre a versão do servidor e, com
// zero linhas, relê a nota para separar conflito, reenvio duplicado e nota apagada.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as string[], patches: [] as unknown[] }))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const ops: string[] = []
      const b = {
        update: (values: unknown) => { ops.push('update'); db.patches.push(values); return b },
        select: () => b, maybeSingle: () => b,
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

const { patchMatches, quickDraftPatch, saveQuickNote } = await import('./quickNotes')

const row = (content: string, updated_at: string) =>
  ({ id: 'q1', user_id: 'u1', content, color: 'yellow', linked_items: null, created_at: '', updated_at })

beforeEach(() => {
  db.queue = []
  db.calls = []
  db.patches = []
})

describe('quickDraftPatch', () => {
  it('fica só com os campos da nota (o updated_at do aparelho e o resto saem)', () => {
    expect(quickDraftPatch({ content: 'x', updated_at: '2020-01-01T00:00:00Z', user_id: 'u9' })).toEqual({ content: 'x' })
    expect(quickDraftPatch({ color: 'blue', linked_items: [] })).toEqual({ color: 'blue', linked_items: [] })
    expect(quickDraftPatch(null)).toEqual({})
    expect(quickDraftPatch('texto')).toEqual({})
  })
})

describe('patchMatches', () => {
  it('compara só os campos do patch, vínculos inclusive', () => {
    const link = { id: 'l1', type: 'page' as const, targetId: 'p1', title: 'P' }
    expect(patchMatches({ content: 'a', color: 'blue', linked_items: [link] }, { content: 'a' })).toBe(true)
    expect(patchMatches({ content: 'a', linked_items: [link] }, { linked_items: [link] })).toBe(true)
    expect(patchMatches({ content: 'a', linked_items: [] }, { linked_items: [link] })).toBe(false)
    expect(patchMatches({ content: 'a' }, { content: 'b' })).toBe(false)
  })
})

describe('saveQuickNote', () => {
  it('grava sobre a versão e devolve a versão nova', async () => {
    db.queue = [{ data: [{ id: 'q1', updated_at: 'v2' }], error: null }]
    expect(await saveQuickNote('q1', { content: 'x' }, 'v1')).toEqual({ status: 'saved', at: 'v2' })
    expect(db.calls).toEqual(['quick_notes:update,id=q1,updated_at=v1'])
    expect(db.patches).toEqual([{ content: 'x' }])
  })

  it('zero linhas e outra versão no servidor: conflito com a nota de lá', async () => {
    db.queue = [{ data: [], error: null }, { data: row('deles', 'v3'), error: null }]
    expect(await saveQuickNote('q1', { content: 'x' }, 'v1')).toMatchObject({
      status: 'conflict', current: { content: 'deles', linked_items: [], updated_at: 'v3' },
    })
    expect(db.calls).toEqual(['quick_notes:update,id=q1,updated_at=v1', 'quick_notes:id=q1'])
  })

  it('zero linhas, mas o servidor já tem o patch (reenvio duplicado): gravada', async () => {
    db.queue = [{ data: [], error: null }, { data: row('x', 'v2'), error: null }]
    expect(await saveQuickNote('q1', { content: 'x' }, 'v1')).toEqual({ status: 'saved', at: 'v2' })
  })

  it('zero linhas e a nota não existe mais: gone', async () => {
    db.queue = [{ data: [], error: null }, { data: null, error: null }]
    expect(await saveQuickNote('q1', { content: 'x' }, 'v1')).toEqual({ status: 'gone' })
  })

  it('erro do banco ou da rede passa adiante', async () => {
    db.queue = [{ data: null, error: { message: 'TypeError: Failed to fetch' } }]
    expect(await saveQuickNote('q1', { content: 'x' }, 'v1')).toEqual({ status: 'error', error: { message: 'TypeError: Failed to fetch' } })
  })
})

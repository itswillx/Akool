import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from './offlineStore'

// REL-012: o reenvio dos rascunhos guardados offline: notas e desenhos com
// save condicional pela versão (REL-009), quick notes por update; o que o
// servidor recusa fica guardado; páginas abertas ficam com o próprio editor.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as string[] }))
const store = vi.hoisted(() => ({ drafts: [] as Draft[], deleted: [] as string[] }))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const ops: string[] = []
      const b = {
        update: () => { ops.push('update'); return b }, insert: () => { ops.push('insert'); return b },
        select: () => b, eq: (col: string) => { ops.push(`eq:${col}`); return b }, single: () => b, maybeSingle: () => b,
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(`${table}:${ops.join(',')}`)
          return Promise.resolve(db.queue.shift() ?? { data: [], error: null }).then(resolve, reject)
        },
      }
      return b
    },
  },
}))
vi.mock('./offlineStore', () => ({
  listDrafts: async (userId: string) => store.drafts.filter(d => d.userId === userId),
  deleteDraft: async (key: string) => { store.deleted.push(key) },
}))

const { flushDrafts } = await import('./offlineSync')
const { markContentOpen } = await import('./contentPersistence')

const draft = (table: Draft['table'], id: string, value: unknown, version: string | null = 'v1'): Draft =>
  ({ key: `u1:${table}:${id}`, userId: 'u1', table, id, value, version, savedAt: 1 })

beforeEach(() => {
  db.queue = []
  db.calls = []
  store.drafts = []
  store.deleted = []
})

describe('flushDrafts', () => {
  it('nota: grava sobre a versão conhecida e apaga o rascunho', async () => {
    store.drafts = [draft('note_contents', 'p1', [{ type: 'paragraph' }])]
    db.queue = [{ data: [{ updated_at: 'v2' }], error: null }]
    expect(await flushDrafts('u1')).toEqual({ sent: 1, kept: 0 })
    expect(db.calls).toEqual(['note_contents:update,eq:page_id,eq:updated_at'])
    expect(store.deleted).toEqual(['u1:note_contents:p1'])
  })

  it('conflito (alguém salvou depois) fica guardado para a página avisar', async () => {
    store.drafts = [draft('drawing_contents', 'p2', { elements: [], app_state: {}, files: {} })]
    db.queue = [{ data: [], error: null }, { data: { updated_at: 'v9' }, error: null }]
    expect(await flushDrafts('u1')).toEqual({ sent: 0, kept: 1 })
    expect(store.deleted).toEqual([])
  })

  it('quick note: update por id; recusa do RLS (0 linhas) mantém o rascunho', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x' }, null), draft('quick_notes', 'q2', { content: 'y' }, null)]
    db.queue = [{ data: [{ id: 'q1' }], error: null }, { data: [], error: null }]
    expect(await flushDrafts('u1', 'quick_notes')).toEqual({ sent: 1, kept: 1 })
    expect(db.calls).toEqual(['quick_notes:update,eq:id', 'quick_notes:update,eq:id'])
    expect(store.deleted).toEqual(['u1:quick_notes:q1'])
  })

  it('pula a página aberta (o editor dela reenvia) e respeita o filtro por tabela', async () => {
    store.drafts = [draft('note_contents', 'aberta', 'a'), draft('quick_notes', 'q1', { content: 'x' }, null)]
    const close = markContentOpen('note_contents', 'aberta')
    db.queue = [{ data: [{ id: 'q1' }], error: null }]
    expect(await flushDrafts('u1')).toEqual({ sent: 1, kept: 1 })
    expect(db.calls).toEqual(['quick_notes:update,eq:id'])
    close()
    expect(await flushDrafts('u1', 'drawing_contents')).toEqual({ sent: 0, kept: 0 })
  })
})

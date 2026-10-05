import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from './offlineStore'

// REL-012: o reenvio dos rascunhos guardados offline: notas e desenhos com
// save condicional pela versão (REL-009); o que o servidor recusa fica
// guardado; páginas abertas ficam com o próprio editor.
// API-003: quick notes também gravam sobre a versão do rascunho; rascunho
// antigo (sem versão) e versão velha viram conflito, nunca sobrescrita.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as string[], patches: [] as unknown[] }))
const store = vi.hoisted(() => ({ drafts: [] as Draft[], deleted: [] as string[] }))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const ops: string[] = []
      const b = {
        update: (values: unknown) => { ops.push('update'); db.patches.push(values); return b }, insert: () => { ops.push('insert'); return b },
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
  db.patches = []
  store.drafts = []
  store.deleted = []
})

describe('flushDrafts', () => {
  it('nota: grava sobre a versão conhecida e apaga o rascunho', async () => {
    store.drafts = [draft('note_contents', 'p1', [{ type: 'paragraph' }])]
    db.queue = [{ data: [{ updated_at: 'v2' }], error: null }]
    expect(await flushDrafts('u1')).toMatchObject({ sent: 1, kept: 0 })
    expect(db.calls).toEqual(['note_contents:update,eq:page_id,eq:updated_at'])
    expect(store.deleted).toEqual(['u1:note_contents:p1'])
  })

  it('conflito (alguém salvou depois) fica guardado para a página avisar', async () => {
    store.drafts = [draft('drawing_contents', 'p2', { elements: [], app_state: {}, files: {} })]
    db.queue = [{ data: [], error: null }, { data: { updated_at: 'v9' }, error: null }]
    expect(await flushDrafts('u1')).toMatchObject({ sent: 0, kept: 1 })
    expect(store.deleted).toEqual([])
  })

  it('quick note: grava sobre a versão do rascunho, sem o updated_at do aparelho, e apaga o rascunho', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x', updated_at: '2026-01-01T00:00:00Z' }, 'v1')]
    db.queue = [{ data: [{ id: 'q1', updated_at: 'v2' }], error: null }]
    const report = await flushDrafts('u1', 'quick_notes')
    expect(report).toMatchObject({ sent: 1, kept: 0, dropped: 0 })
    expect(report.results).toEqual([{ key: 'u1:quick_notes:q1', table: 'quick_notes', id: 'q1', status: 'sent', at: 'v2' }])
    expect(db.calls).toEqual(['quick_notes:update,eq:id,eq:updated_at'])
    expect(db.patches).toEqual([{ content: 'x' }])
    expect(store.deleted).toEqual(['u1:quick_notes:q1'])
  })

  it('quick note antigo, sem versão, nunca vai às cegas: vira conflito e fica guardado', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x' }, null)]
    const report = await flushDrafts('u1', 'quick_notes')
    expect(report).toMatchObject({ sent: 0, kept: 1 })
    expect(report.results[0].status).toBe('conflict')
    expect(db.calls).toEqual([])
    expect(store.deleted).toEqual([])
  })

  it('quick note salva depois em outro lugar: conflito com a nota de lá, rascunho guardado', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x' }, 'v1')]
    db.queue = [{ data: [], error: null }, { data: { id: 'q1', content: 'deles', color: 'yellow', linked_items: null, updated_at: 'v3' }, error: null }]
    const report = await flushDrafts('u1', 'quick_notes')
    expect(report).toMatchObject({ sent: 0, kept: 1 })
    expect(report.results[0]).toMatchObject({ status: 'conflict', current: { content: 'deles', linked_items: [], updated_at: 'v3' } })
    expect(db.calls).toEqual(['quick_notes:update,eq:id,eq:updated_at', 'quick_notes:eq:id'])
    expect(store.deleted).toEqual([])
  })

  it('quick note que já tem o conteúdo do rascunho (reenvio duplicado) conta como enviada', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x' }, 'v1')]
    db.queue = [{ data: [], error: null }, { data: { id: 'q1', content: 'x', color: 'yellow', linked_items: [], updated_at: 'v2' }, error: null }]
    const report = await flushDrafts('u1', 'quick_notes')
    expect(report.results[0]).toMatchObject({ status: 'sent', at: 'v2' })
    expect(store.deleted).toEqual(['u1:quick_notes:q1'])
  })

  it('quick note apagada em outro lugar: o rascunho sai', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x' }, 'v1')]
    db.queue = [{ data: [], error: null }, { data: null, error: null }]
    expect(await flushDrafts('u1', 'quick_notes')).toMatchObject({ sent: 0, kept: 0, dropped: 1 })
    expect(store.deleted).toEqual(['u1:quick_notes:q1'])
  })

  it('o mesmo rascunho não sai duas vezes ao mesmo tempo (App e tela de notas)', async () => {
    store.drafts = [draft('quick_notes', 'q1', { content: 'x' }, 'v1')]
    db.queue = [{ data: [{ id: 'q1', updated_at: 'v2' }], error: null }]
    const [a, b] = await Promise.all([flushDrafts('u1'), flushDrafts('u1')])
    expect(db.calls).toEqual(['quick_notes:update,eq:id,eq:updated_at'])
    expect(a.sent + b.sent).toBe(1)
    expect(a.kept + b.kept).toBe(1)
  })

  it('pula a página aberta (o editor dela reenvia) e respeita o filtro por tabela', async () => {
    store.drafts = [draft('note_contents', 'aberta', 'a'), draft('quick_notes', 'q1', { content: 'x' }, 'v1')]
    const close = markContentOpen('note_contents', 'aberta')
    db.queue = [{ data: [{ id: 'q1', updated_at: 'v2' }], error: null }]
    expect(await flushDrafts('u1')).toMatchObject({ sent: 1, kept: 1 })
    expect(db.calls).toEqual(['quick_notes:update,eq:id,eq:updated_at'])
    close()
    expect(await flushDrafts('u1', 'drawing_contents')).toMatchObject({ sent: 0, kept: 0 })
  })
})

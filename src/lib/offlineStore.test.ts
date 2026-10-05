import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearDrafts, deleteDraft, deleteDraftFor, draftKey, getDraft, getDraftFor, listDrafts, putDraft } from './offlineStore'

// REL-012: os rascunhos vão e voltam do IndexedDB (aqui o fake-indexeddb),
// por conta, e somem ao sair da conta.

const note = (userId: string, id: string, value: unknown, version: string | null = 'v1') =>
  ({ userId, table: 'note_contents' as const, id, value, version, savedAt: 1 })

beforeEach(async () => {
  await clearDrafts('u1')
  await clearDrafts('u2')
})

describe('offlineStore', () => {
  it('chave = conta:tabela:id', () => {
    expect(draftKey('u1', 'quick_notes', 'q1')).toBe('u1:quick_notes:q1')
  })

  it('grava, lê e substitui o rascunho de um conteúdo', async () => {
    await putDraft(note('u1', 'p1', [{ type: 'paragraph' }]))
    expect((await getDraftFor('u1', 'note_contents', 'p1'))?.value).toEqual([{ type: 'paragraph' }])
    await putDraft(note('u1', 'p1', [{ type: 'heading' }], 'v2'))
    const again = await getDraft('u1:note_contents:p1')
    expect(again?.value).toEqual([{ type: 'heading' }])
    expect(again?.version).toBe('v2')
  })

  it('lista só os rascunhos da conta e apaga um ou todos', async () => {
    await putDraft(note('u1', 'p1', 'a'))
    await putDraft({ userId: 'u1', table: 'quick_notes', id: 'q1', value: { content: 'b' }, version: '2026-10-05T12:00:00.123456+00:00', savedAt: 2 })
    await putDraft(note('u2', 'p9', 'c'))
    expect((await listDrafts('u1')).map(d => d.key).sort()).toEqual(['u1:note_contents:p1', 'u1:quick_notes:q1'])
    await deleteDraftFor('u1', 'note_contents', 'p1')
    expect((await listDrafts('u1')).map(d => d.key)).toEqual(['u1:quick_notes:q1'])
    await deleteDraft('u1:quick_notes:q1')
    expect(await listDrafts('u1')).toEqual([])
    expect((await listDrafts('u2')).length).toBe(1)
    await clearDrafts('u2')
    expect(await listDrafts('u2')).toEqual([])
  })

  it('sem o conteúdo, lê nulo', async () => {
    expect(await getDraftFor('u1', 'drawing_contents', 'nada')).toBeNull()
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { QuickNote, QuickNoteLinkedItem } from '../types'

// REL-004: sem usuário, `loading` não fica preso; editar e excluir desfazem só
// a nota tocada quando o banco recusa, e avisam.
// API-003: toda gravação vai sobre a versão do servidor; quem salvou depois
// gera aviso de conflito em vez de ser sobrescrito.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string; code?: string } | null }

// Cada operação devolve um resultado fixo, ou uma fila (um por chamada).
const db = vi.hoisted(() => {
  const results: Partial<Record<Op, Res | Res[]>> = {}
  return { results, calls: [] as string[], patches: [] as unknown[] }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let op: Op = 'select'
      const filters: string[] = []
      const b = {
        select: () => b, order: () => b, single: () => b, maybeSingle: () => b,
        eq: (col: string, value: unknown) => { filters.push(`${col}=${String(value)}`); return b },
        insert: () => { op = 'insert'; return b },
        update: (values: unknown) => { op = 'update'; db.patches.push(values); return b },
        delete: () => { op = 'delete'; return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(`${table}:${op}${filters.length ? `:${filters.join(',')}` : ''}`)
          const result = db.results[op]
          const next = Array.isArray(result) ? result.shift() : result
          return Promise.resolve(next ?? { data: [], error: null }).then(resolve, reject)
        },
      }
      return b
    },
  },
}))

const showToast = vi.fn()
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

// REL-012: os rascunhos locais (IndexedDB) em memória.
const offline = vi.hoisted(() => {
  const current: Record<string, unknown> = {}
  return { puts: [] as unknown[], drafts: [] as unknown[], deleted: [] as string[], current }
})
vi.mock('../lib/offlineStore', () => ({
  listDrafts: async () => offline.drafts,
  getDraftFor: async (_userId: string, _table: string, id: string) => offline.current[id] ?? null,
  putDraft: async (draft: unknown) => { offline.puts.push(draft) },
  deleteDraft: async (key: string) => { offline.deleted.push(key) },
  deleteDraftFor: async (userId: string, table: string, id: string) => { offline.deleted.push(`${userId}:${table}:${id}`) },
}))

import { useQuickNotes } from './useQuickNotes'

const note = (id: string, content: string, extra: Partial<QuickNote> = {}): QuickNote =>
  ({ id, user_id: 'u1', content, color: 'yellow', linked_items: [], created_at: '', updated_at: '2026-09-01T00:00:00Z', ...extra })
const link = (id: string): QuickNoteLinkedItem => ({ id, type: 'page', targetId: `p-${id}`, title: id })

let hook: ReturnType<typeof useQuickNotes>
const capture = (value: ReturnType<typeof useQuickNotes>) => { hook = value }
function Probe({ userId }: { userId: string | undefined }) {
  const value = useQuickNotes(userId)
  useEffect(() => { capture(value) })
  return null
}

let container: HTMLDivElement
let root: Root
const render = (userId: string | undefined) => act(async () => { root.render(<Probe userId={userId} />) })
/**
 * Deixa os efeitos assíncronos (rascunhos, reenvio com `import()`) terminarem:
 * espera até `done` valer, ou cerca de 1 s. Com a suíte inteira em paralelo,
 * uma espera fixa curta não basta.
 */
const settle = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}

beforeEach(() => {
  db.results = {}
  db.calls = []
  db.patches = []
  offline.puts = []
  offline.drafts = []
  offline.deleted = []
  offline.current = {}
  showToast.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useQuickNotes', () => {
  it('is not loading and queries nothing without a user', async () => {
    await render(undefined)
    expect(hook.loading).toBe(false)
    expect(hook.notes).toEqual([])
    expect(db.calls).toEqual([])
  })

  it('loads the user notes and leaves loading', async () => {
    db.results.select = { data: [note('a', 'one')], error: null }
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(hook.notes.map(n => n.content)).toEqual(['one'])
  })

  it('reverts only the edited note when the update is refused', async () => {
    db.results.select = { data: [note('a', 'one'), note('b', 'two')], error: null }
    await render('u1')
    // Recusa do banco (não é falta de rede: essa vira rascunho local, REL-012).
    db.results.update = { data: null, error: { message: 'permission denied for table quick_notes', code: '42501' } } satisfies Res
    await act(async () => { await hook.updateNote('b', { content: 'changed' }) })
    expect(hook.notes.map(n => n.content)).toEqual(['one', 'two'])
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_permission')
  })

  it('puts a note back in place when RLS deletes 0 rows', async () => {
    db.results.select = { data: [note('a', 'one'), note('b', 'two'), note('c', 'three')], error: null }
    await render('u1')
    db.results.delete = { data: [], error: null }
    await act(async () => { await hook.deleteNote('b') })
    expect(hook.notes.map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_permission')
  })

  it('tells the caller when a new note was not saved', async () => {
    await render('u1')
    db.results.insert = { data: null, error: { message: 'boom' } }
    let saved = true
    await act(async () => { saved = await hook.createNote({ content: 'x', color: 'yellow' }) })
    expect(saved).toBe(false)
    expect(hook.notes).toEqual([])
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_save')
  })
})

describe('useQuickNotes: versão do servidor (API-003)', () => {
  it('grava sem updated_at, sobre a versão conhecida, e a próxima usa a versão devolvida', async () => {
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    await render('u1')
    db.results.update = [
      { data: [{ id: 'a', updated_at: 'v2' }], error: null },
      { data: [{ id: 'a', updated_at: 'v3' }], error: null },
    ]
    await act(async () => { await Promise.all([hook.updateNote('a', { content: '1' }), hook.updateNote('a', { content: '2' })]) })
    expect(db.patches).toEqual([{ content: '1' }, { content: '2' }])
    expect(db.calls.slice(1)).toEqual(['quick_notes:update:id=a,updated_at=v1', 'quick_notes:update:id=a,updated_at=v2'])
    expect(hook.notes[0]).toMatchObject({ content: '2', updated_at: 'v3' })
  })

  it('outra aba salvou o mesmo campo: a edição fica na tela e num rascunho, e aparece o conflito', async () => {
    db.results.select = [
      { data: [note('a', 'one', { updated_at: 'v1' })], error: null },
      { data: note('a', 'deles', { updated_at: 'v9' }), error: null },
    ]
    await render('u1')
    db.results.update = [{ data: [], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'minha' }) })
    expect(hook.notes[0].content).toBe('minha')
    expect(hook.conflicts.a).toMatchObject({ mine: { content: 'minha' }, theirs: { content: 'deles', updated_at: 'v9' } })
    expect(offline.puts).toHaveLength(1)
    expect(offline.puts[0]).toMatchObject({ id: 'a', value: { content: 'minha' }, version: 'v1' })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('"carregar a versão salva" troca pela nota do servidor e apaga o rascunho', async () => {
    db.results.select = [
      { data: [note('a', 'one', { updated_at: 'v1' })], error: null },
      { data: note('a', 'deles', { updated_at: 'v9' }), error: null },
    ]
    await render('u1')
    db.results.update = [{ data: [], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'minha' }) })
    await act(async () => { await hook.resolveConflict('a', 'load') })
    expect(hook.notes[0]).toMatchObject({ content: 'deles', updated_at: 'v9' })
    expect(hook.conflicts).toEqual({})
    await settle(() => offline.deleted.includes('u1:quick_notes:a'))
    expect(offline.deleted).toContain('u1:quick_notes:a')
  })

  it('"manter a minha" grava sobre a versão que chegou', async () => {
    db.results.select = [
      { data: [note('a', 'one', { updated_at: 'v1' })], error: null },
      { data: note('a', 'deles', { updated_at: 'v9' }), error: null },
    ]
    await render('u1')
    db.results.update = [{ data: [], error: null }, { data: [{ id: 'a', updated_at: 'v10' }], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'minha' }) })
    await act(async () => { await hook.resolveConflict('a', 'keep') })
    expect(db.calls.at(-1)).toBe('quick_notes:update:id=a,updated_at=v9')
    expect(db.patches.at(-1)).toEqual({ content: 'minha' })
    expect(hook.conflicts).toEqual({})
    expect(hook.notes[0]).toMatchObject({ content: 'minha', updated_at: 'v10' })
  })

  it('a versão mudou por outro campo (cor em outra aba): grava de novo, sem conflito', async () => {
    db.results.select = [
      { data: [note('a', 'one', { updated_at: 'v1' })], error: null },
      { data: note('a', 'one', { color: 'blue', updated_at: 'v2' }), error: null },
    ]
    await render('u1')
    db.results.update = [{ data: [], error: null }, { data: [{ id: 'a', updated_at: 'v3' }], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'two' }) })
    expect(db.calls.slice(1)).toEqual([
      'quick_notes:update:id=a,updated_at=v1',
      'quick_notes:select:id=a',
      'quick_notes:update:id=a,updated_at=v2',
    ])
    expect(hook.conflicts).toEqual({})
    expect(hook.notes[0]).toMatchObject({ content: 'two', updated_at: 'v3' })
  })

  it('vínculo novo entra na lista do servidor quando outra aba mexeu nela', async () => {
    db.results.select = [
      { data: [note('a', 'one', { linked_items: [link('L1')], updated_at: 'v1' })], error: null },
      { data: note('a', 'one', { linked_items: [link('L1'), link('L2')], updated_at: 'v2' }), error: null },
    ]
    await render('u1')
    db.results.update = [{ data: [], error: null }, { data: [{ id: 'a', updated_at: 'v3' }], error: null }]
    const L3 = link('L3')
    await act(async () => { await hook.updateNote('a', current => ({ linked_items: [...current.linked_items, L3] })) })
    expect(db.patches.at(-1)).toEqual({ linked_items: [link('L1'), link('L2'), L3] })
    expect(hook.notes[0].linked_items.map(l => l.id)).toEqual(['L1', 'L2', 'L3'])
    expect(hook.conflicts).toEqual({})
  })

  it('nota apagada em outro lugar sai da lista, com aviso', async () => {
    db.results.select = [{ data: [note('a', 'one', { updated_at: 'v1' })], error: null }, { data: null, error: null }]
    await render('u1')
    db.results.update = [{ data: [], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'x' }) })
    expect(hook.notes).toEqual([])
    expect(showToast).toHaveBeenCalledWith('warning', 'quick_notes_gone')
  })
})

// REL-012: sem conexão a edição fica na tela e vira rascunho local; o
// reenvio acontece quando a conexão volta.
describe('useQuickNotes offline (REL-012)', () => {
  it('a edição fica na tela quando a rede cai, e vai para o rascunho local com a versão base', async () => {
    db.results.select = { data: [note('n1', 'antes')], error: null }
    db.results.update = { data: null, error: { message: 'TypeError: Failed to fetch' } }
    await render('u1')
    await act(async () => { await hook.updateNote('n1', { content: 'depois' }) })
    expect(hook.notes[0].content).toBe('depois')
    expect(showToast).not.toHaveBeenCalled()
    await settle(() => offline.puts.length > 0)
    expect(offline.puts).toHaveLength(1)
    expect(offline.puts[0]).toMatchObject({
      userId: 'u1', table: 'quick_notes', id: 'n1', value: { content: 'depois' }, version: '2026-09-01T00:00:00Z',
    })
  })

  it('rascunho antigo, sem versão: aparece como conflito e não é enviado às cegas', async () => {
    offline.drafts = [{
      key: 'u1:quick_notes:a', userId: 'u1', table: 'quick_notes', id: 'a',
      value: { content: 'offline', updated_at: '2020-01-01T00:00:00Z' }, version: null, savedAt: 1,
    }]
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    await render('u1')
    await settle(() => !!hook.conflicts.a)
    expect(db.patches).toEqual([])
    expect(hook.notes[0]).toMatchObject({ content: 'offline', updated_at: 'v1' })
    expect(hook.conflicts.a).toMatchObject({ mine: { content: 'offline' }, theirs: { content: 'one' } })
  })
})

describe('useQuickNotes: caminhos de borda (API-003)', () => {
  it('carregar com erro não trava o loading', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.results.select = { data: null, error: { message: 'boom' } }
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(hook.notes).toEqual([])
    consoleError.mockRestore()
  })

  it('criar põe a nota no topo e já conhece a versão dela', async () => {
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    await render('u1')
    db.results.insert = { data: note('b', 'nova', { updated_at: 'v5' }), error: null }
    let saved = false
    await act(async () => { saved = await hook.createNote({ content: 'nova', color: 'yellow' }) })
    expect(saved).toBe(true)
    expect(hook.notes.map(n => n.id)).toEqual(['b', 'a'])
    db.results.update = [{ data: [{ id: 'b', updated_at: 'v6' }], error: null }]
    await act(async () => { await hook.updateNote('b', { content: 'editada' }) })
    expect(db.calls.at(-1)).toBe('quick_notes:update:id=b,updated_at=v5')
  })

  it('sem usuário, criar não grava', async () => {
    await render(undefined)
    let saved = true
    await act(async () => { saved = await hook.createNote({ content: 'x', color: 'yellow' }) })
    expect(saved).toBe(false)
    expect(db.calls).toEqual([])
  })

  it('nota desconhecida ou patch vazio não gravam nada', async () => {
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    await render('u1')
    await act(async () => {
      await hook.updateNote('zz', { content: 'x' })
      await hook.updateNote('a', {})
      await hook.resolveConflict('a', 'keep')
      await hook.deleteNote('zz')
    })
    expect(db.patches).toEqual([])
    expect(db.calls).toEqual(['quick_notes:select:user_id=u1'])
  })

  it('gravação online tira do rascunho os campos gravados e deixa o resto sobre a versão nova', async () => {
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    await render('u1')
    offline.current.a = { userId: 'u1', table: 'quick_notes', id: 'a', value: { content: 'x', color: 'blue' }, version: 'v1', savedAt: 1 }
    db.results.update = [{ data: [{ id: 'a', updated_at: 'v2' }], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'online' }) })
    await settle(() => offline.puts.length > 0)
    expect(offline.puts[0]).toMatchObject({ id: 'a', value: { color: 'blue' }, version: 'v2' })
  })

  it('gravação online com o rascunho todo coberto apaga o rascunho', async () => {
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    await render('u1')
    offline.current.a = { userId: 'u1', table: 'quick_notes', id: 'a', value: { content: 'x' }, version: 'v1', savedAt: 1 }
    db.results.update = [{ data: [{ id: 'a', updated_at: 'v2' }], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'online' }) })
    await settle(() => offline.deleted.includes('u1:quick_notes:a'))
    expect(offline.deleted).toContain('u1:quick_notes:a')
  })

  it('em conflito, novas edições entram na "minha versão" sem ir ao servidor', async () => {
    db.results.select = [
      { data: [note('a', 'one', { updated_at: 'v1' })], error: null },
      { data: note('a', 'deles', { updated_at: 'v9' }), error: null },
    ]
    await render('u1')
    db.results.update = [{ data: [], error: null }]
    await act(async () => { await hook.updateNote('a', { content: 'minha' }) })
    const writes = db.patches.length
    await act(async () => { await hook.updateNote('a', { color: 'blue' }) })
    expect(db.patches).toHaveLength(writes)
    expect(hook.conflicts.a.mine).toEqual({ content: 'minha', color: 'blue' })
    expect(hook.notes[0]).toMatchObject({ content: 'minha', color: 'blue' })
  })

  it('excluir com sucesso tira a nota, o conflito e o rascunho', async () => {
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' }), note('b', 'two')], error: null }
    await render('u1')
    db.results.delete = { data: [{ id: 'a' }], error: null }
    await act(async () => { await hook.deleteNote('a') })
    expect(hook.notes.map(n => n.id)).toEqual(['b'])
    await settle(() => offline.deleted.includes('u1:quick_notes:a'))
    expect(offline.deleted).toContain('u1:quick_notes:a')
  })

  it('rascunho na versão certa é reenviado ao abrir e a nota fica com a versão nova', async () => {
    offline.drafts = [{ key: 'u1:quick_notes:a', userId: 'u1', table: 'quick_notes', id: 'a', value: { content: 'offline' }, version: 'v1', savedAt: 1 }]
    db.results.select = { data: [note('a', 'one', { updated_at: 'v1' })], error: null }
    db.results.update = [{ data: [{ id: 'a', updated_at: 'v2' }], error: null }]
    await render('u1')
    await settle(() => hook.notes[0]?.updated_at === 'v2')
    expect(hook.notes[0]).toMatchObject({ content: 'offline', updated_at: 'v2' })
    expect(hook.conflicts).toEqual({})
  })

  it('rascunho de nota apagada em outro lugar: a nota sai e aparece o aviso', async () => {
    offline.drafts = [{ key: 'u1:quick_notes:a', userId: 'u1', table: 'quick_notes', id: 'a', value: { content: 'offline' }, version: 'v1', savedAt: 1 }]
    db.results.select = [{ data: [note('a', 'one', { updated_at: 'v1' })], error: null }, { data: null, error: null }]
    db.results.update = [{ data: [], error: null }]
    await render('u1')
    await settle(() => hook.notes.length === 0)
    expect(hook.notes).toEqual([])
    expect(showToast).toHaveBeenCalledWith('warning', 'quick_notes_gone')
  })
})

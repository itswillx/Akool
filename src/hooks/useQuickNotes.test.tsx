// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { QuickNote } from '../types'

// REL-004: sem usuário, `loading` não fica preso; editar e excluir desfazem só
// a nota tocada quando o banco recusa, e avisam.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string; code?: string } | null }

const db = vi.hoisted(() => {
  const results: Partial<Record<Op, Res>> = {}
  return { results, calls: [] as string[] }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let op: Op = 'select'
      const b = {
        select: () => b, eq: () => b, order: () => b, single: () => b,
        insert: () => { op = 'insert'; return b },
        update: () => { op = 'update'; return b },
        delete: () => { op = 'delete'; return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(`${table}:${op}`)
          return Promise.resolve(db.results[op] ?? { data: [], error: null }).then(resolve, reject)
        },
      }
      return b
    },
  },
}))

const showToast = vi.fn()
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

import { useQuickNotes } from './useQuickNotes'

const note = (id: string, content: string): QuickNote =>
  ({ id, user_id: 'u1', content, color: 'yellow', linked_items: [], created_at: '', updated_at: '2026-09-01T00:00:00Z' })

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

beforeEach(() => {
  db.results = {}
  db.calls = []
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

// REL-012: sem conexão a edição fica na tela e vira rascunho local; o
// reenvio acontece quando a conexão volta.
const offline = vi.hoisted(() => ({ puts: [] as unknown[], drafts: [] as unknown[] }))
vi.mock('../lib/offlineStore', () => ({
  listDrafts: async () => offline.drafts,
  getDraftFor: async () => null,
  putDraft: async (draft: unknown) => { offline.puts.push(draft) },
  deleteDraft: async () => {},
}))

describe('useQuickNotes offline (REL-012)', () => {
  it('a edição fica na tela quando a rede cai, e vai para o rascunho local', async () => {
    offline.puts = []
    db.results.select = { data: [note('n1', 'antes')], error: null }
    db.results.update = { data: null, error: { message: 'TypeError: Failed to fetch' } }
    await render('u1')
    await act(async () => { await hook.updateNote('n1', { content: 'depois' }) })
    expect(hook.notes[0].content).toBe('depois')
    expect(showToast).not.toHaveBeenCalled()
    expect(offline.puts).toHaveLength(1)
    expect(offline.puts[0]).toMatchObject({ userId: 'u1', table: 'quick_notes', id: 'n1', value: { content: 'depois' } })
  })
})

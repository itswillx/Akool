// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// QA-001: hooks de src/hooks que ainda não tinham teste — colaboração em
// tempo real, seleção da visão Documentos e o breakpoint de celular.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Change = (payload: { new: Record<string, unknown> }) => void
const rt = vi.hoisted(() => ({
  onChange: null as ((payload: { new: Record<string, unknown> }) => void) | null,
  channels: [] as string[],
  removed: 0,
  fetches: [] as string[],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      rt.channels.push(name)
      const ch = {
        on: (_event: string, _filter: unknown, cb: Change) => { rt.onChange = cb; return ch },
        subscribe: () => ch,
      }
      return ch
    },
    removeChannel: () => { rt.removed++ },
  },
}))
vi.mock('../lib/data/pages', () => ({
  fetchPageContent: (table: string, pageId: string) => {
    rt.fetches.push(`${table}:${pageId}`)
    return Promise.resolve({ data: { value: ['inicial'], updatedAt: 'v1' }, error: null })
  },
}))

import { useCollaborativeContent } from './useCollaborativeContent'
import { useDocsSelection } from './useDocsSelection'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { setDocsSelection } from '../lib/docsNavigation'

let container: HTMLDivElement
let root: Root
let last: unknown
function Probe<T>({ use }: { use: () => T }) {
  const value = use()
  useEffect(() => { last = value })
  return null
}
const render = <T,>(use: () => T) => act(async () => { root.render(<Probe use={use} />) })

beforeEach(() => {
  rt.onChange = null
  rt.channels = []
  rt.removed = 0
  rt.fetches = []
  last = undefined
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useCollaborativeContent', () => {
  it('desligado (página não compartilhada): nem lê nem assina', async () => {
    await render(() => useCollaborativeContent('p1', 'note_contents', false))
    expect(rt.fetches).toEqual([])
    expect(rt.channels).toEqual([])
    expect(last).toEqual({ remoteContent: null, remoteUpdatedAt: null })
  })

  it('lê o conteúdo e segue as mudanças da coluna certa', async () => {
    await render(() => useCollaborativeContent('p1', 'drawing_contents', true))
    expect(rt.fetches).toEqual(['drawing_contents:p1'])
    expect(rt.channels).toEqual(['drawing_contents:p1'])
    expect(last).toEqual({ remoteContent: ['inicial'], remoteUpdatedAt: 'v1' })

    await act(async () => { rt.onChange?.({ new: { elements: ['novo'], updated_at: 'v2' } }) })
    expect(last).toEqual({ remoteContent: ['novo'], remoteUpdatedAt: 'v2' })

    // Linha sem a coluna do desenho (ex.: só metadados) não mexe no conteúdo.
    await act(async () => { rt.onChange?.({ new: { content: ['nota'], updated_at: 'v3' } }) })
    expect(last).toEqual({ remoteContent: ['novo'], remoteUpdatedAt: 'v2' })
  })

  it('sai do canal ao desmontar', async () => {
    await render(() => useCollaborativeContent('p1', 'note_contents', true))
    act(() => root.unmount())
    root = createRoot(container)
    expect(rt.removed).toBe(1)
  })
})

describe('useDocsSelection', () => {
  it('acompanha a seleção feita em qualquer lugar', async () => {
    setDocsSelection(null)
    await render(() => useDocsSelection())
    expect(last).toBeNull()
    await act(async () => { setDocsSelection({ kind: 'page', id: 'p9' }) })
    expect(last).toEqual({ kind: 'page', id: 'p9' })
    await act(async () => { setDocsSelection({ kind: 'studies' }) })
    expect(last).toEqual({ kind: 'studies' })
  })
})

describe('useIsMobile', () => {
  let listeners: ((e: { matches: boolean }) => void)[]
  let matches: boolean
  beforeEach(() => {
    listeners = []
    matches = true
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      get matches() { return matches },
      media: query,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listeners.push(cb) },
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listeners = listeners.filter(l => l !== cb) },
    }) as unknown as MediaQueryList)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('segue o media query do breakpoint e para de ouvir ao desmontar', async () => {
    await render(() => useIsMobile(600))
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 600px)')
    expect(last).toBe(true)
    await act(async () => { matches = false; listeners.forEach(l => l({ matches: false })) })
    expect(last).toBe(false)
    act(() => root.unmount())
    root = createRoot(container)
    expect(listeners).toEqual([])
  })
})

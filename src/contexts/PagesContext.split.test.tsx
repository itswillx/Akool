// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, memo, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Page } from '../types'

// PERF-007: quem só usa as ações não re-renderiza ao navegar, e a página
// aberta sai da árvore (um rename que chega pelo refresh aparece nela).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const db = vi.hoisted(() => ({ pages: [] as Record<string, unknown>[] }))

vi.mock('../lib/supabase', () => {
  const query = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'range']) b[m] = () => b
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === 'pages' ? db.pages : [], error: null }).then(resolve)
    return b
  }
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { from: query, channel: () => channel, removeChannel: () => Promise.resolve() } }
})
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('./ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }))

import { PagesProvider } from './PagesContext'
import { usePageActions, usePageNavigation } from './pagesState'

const row = (id: string, title: string) => ({
  id, user_id: 'me', title, icon: '', type: 'note', parent_id: null, sort_order: 0,
  is_favorite: false, created_at: '', updated_at: title,
})

let actionRenders = 0
const ActionsOnly = memo(function ActionsOnly() {
  usePageActions()
  actionRenders++
  return null
})

let nav: ReturnType<typeof usePageNavigation>
let actions: ReturnType<typeof usePageActions>
const captureNav = (v: typeof nav) => { nav = v }
const captureActions = (v: typeof actions) => { actions = v }
function Probe() {
  const n = usePageNavigation()
  const a = usePageActions()
  useEffect(() => { captureNav(n); captureActions(a) })
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  actionRenders = 0
  db.pages = [row('p1', 'Antes')]
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<PagesProvider><ActionsOnly /><Probe /></PagesProvider>)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('PagesContext split (PERF-007)', () => {
  it('navigating does not re-render a consumer of the actions only', async () => {
    const before = actionRenders
    await act(async () => { nav.setActivePage({ id: 'p1' } as Page) })
    await act(async () => { nav.setActivePanel('documents') })
    expect(actionRenders).toBe(before)
  })

  it('the open page comes from the tree: a rename from a refresh shows up', async () => {
    await act(async () => { nav.setActivePage({ id: 'p1', title: 'Antes' } as Page) })
    expect(nav.activePage?.title).toBe('Antes')

    db.pages = [row('p1', 'Depois')]
    await act(async () => { await actions.refreshPages() })
    expect(nav.activePage?.title).toBe('Depois')
  })
})

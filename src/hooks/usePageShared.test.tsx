// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Page } from '../types'

// PERF-008: presence só vale em página compartilhada, e "compartilhada" inclui
// a minha página (ou subpágina dela) que eu compartilhei.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const queries: { table: string; ids: unknown; options: unknown }[] = []
let shareCount = 0
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const query = { table, ids: undefined as unknown, options: undefined as unknown }
      const b = {
        select: (_columns: string, options: unknown) => { query.options = options; return b },
        in: (_column: string, ids: unknown) => { query.ids = ids; return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          queries.push(query)
          return Promise.resolve({ count: shareCount, error: null }).then(resolve, reject)
        },
      }
      return b
    },
  },
}))
let tree: Page[] = []
vi.mock('../contexts/PagesContext', () => ({ usePages: () => ({ pages: tree }) }))

import { pageLineageIds, usePageShared } from './usePageShared'

const page = (id: string, children: Page[] = [], extra: Partial<Page> = {}): Page => ({
  id, user_id: 'me', title: id, icon: '', type: 'note', parent_id: null, sort_order: 0,
  is_favorite: false, created_at: '', updated_at: '', children, ...extra,
})

describe('pageLineageIds', () => {
  const nested = [page('a', [page('b', [page('c')])]), page('x')]

  it('lists the page and its ancestors, closest first', () => {
    expect(pageLineageIds(nested, 'c')).toEqual(['c', 'b', 'a'])
    expect(pageLineageIds(nested, 'x')).toEqual(['x'])
  })

  it('falls back to the page alone when it is not in the tree', () => {
    expect(pageLineageIds(nested, 'zz')).toEqual(['zz'])
  })
})

function Probe({ target, recheck }: { target: Page; recheck: boolean }) {
  return <span>{String(usePageShared(target, recheck))}</span>
}

let container: HTMLDivElement
let root: Root
const render = (target: Page, recheck = false) =>
  act(async () => { root.render(<Probe target={target} recheck={recheck} />) })

beforeEach(() => {
  queries.length = 0
  shareCount = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('usePageShared', () => {
  it('trusts is_shared (shared with me) without querying', async () => {
    tree = []
    await render(page('s', [], { is_shared: true }))
    expect(container.textContent).toBe('true')
    expect(queries).toHaveLength(0)
  })

  it('counts page_shares for the page and its ancestors', async () => {
    const child = page('c')
    tree = [page('a', [page('b', [child])])]
    shareCount = 1
    await render(child)
    expect(queries).toEqual([{ table: 'page_shares', ids: ['c', 'b', 'a'], options: { count: 'exact', head: true } }])
    expect(container.textContent).toBe('true')
  })

  it('a private page stays inactive until it is shared and rechecked', async () => {
    const own = page('p')
    tree = [own]
    await render(own)
    expect(container.textContent).toBe('false')

    shareCount = 1
    await render(own, true)
    expect(queries).toHaveLength(2)
    expect(container.textContent).toBe('true')
  })
})

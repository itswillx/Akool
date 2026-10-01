// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// PERF-008: presence só em página compartilhada, parado com a aba oculta, e o
// delete de saída executado de verdade (o supabase-js só envia no .then()).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Op = 'select' | 'upsert' | 'delete'
interface Call { table: string; op: Op; filters: string[]; executed: boolean }
const calls: Call[] = []
let rows: unknown[] = []

// Builder preguiçoso como o do supabase-js: só "executa" quando alguém chama then.
function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [], executed: false }
  calls.push(call)
  const filter = (name: string) => (column: string, value: unknown) => {
    call.filters.push(`${name}:${column}=${String(value)}`)
    return b
  }
  const b = {
    upsert: () => { call.op = 'upsert'; return b },
    delete: () => { call.op = 'delete'; return b },
    select: () => b,
    eq: filter('eq'),
    gte: filter('gte'),
    neq: filter('neq'),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      call.executed = true
      return Promise.resolve({ data: call.op === 'select' ? rows : null, error: null }).then(resolve, reject)
    },
  }
  return b
}
vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => builder(table) } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

import { usePagePresence } from './usePagePresence'

function Probe({ pageId, active }: { pageId: string; active: boolean }) {
  const users = usePagePresence(pageId, active)
  return <span>{users.map(u => u.display_name).join(',')}</span>
}

const ana = { user_id: 'ana', last_seen_at: '2026-09-26T12:00:00Z', profiles: { email: 'ana@x.com', display_name: 'Ana' } }
const executed = (op: Op) => calls.filter(c => c.executed && c.op === op)
let hidden = false
let container: HTMLDivElement
let root: Root

const render = (pageId: string, active: boolean) =>
  act(async () => { root.render(<Probe pageId={pageId} active={active} />) })
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const setHidden = (value: boolean) => act(async () => {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
})

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  rows = [ana]
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('usePagePresence', () => {
  it('makes no request on a page that is not shared', async () => {
    await render('p1', false)
    await advance(60_000)
    expect(calls).toHaveLength(0)
    expect(container.textContent).toBe('')
  })

  it('on a shared page, beats right away and every 15 s, listing the others', async () => {
    await render('p1', true)
    expect(executed('upsert')).toHaveLength(1)
    expect(executed('select')).toHaveLength(1)
    expect(executed('select')[0].filters).toEqual(expect.arrayContaining(['eq:page_id=p1', 'neq:user_id=me']))
    expect(container.textContent).toBe('Ana')

    await advance(15_000)
    expect(executed('upsert')).toHaveLength(2)
    expect(executed('select')).toHaveLength(2)
  })

  it('stops and leaves while the tab is hidden, and resumes when it is visible', async () => {
    await render('p1', true)
    await setHidden(true)
    expect(executed('delete')).toHaveLength(1)

    await advance(60_000)
    expect(executed('upsert')).toHaveLength(1)

    await setHidden(false)
    expect(executed('upsert')).toHaveLength(2)
    await advance(15_000)
    expect(executed('upsert')).toHaveLength(3)
  })

  it('actually sends the delete when leaving the page', async () => {
    await render('p1', true)
    act(() => root.unmount())
    const [leave] = executed('delete')
    expect(leave.filters).toEqual(['eq:page_id=p1', 'eq:user_id=me'])
    root = createRoot(container)
  })

  it('switching pages leaves the old one and does not show its people', async () => {
    await render('p1', true)
    expect(container.textContent).toBe('Ana')
    rows = []
    await render('p2', true)
    expect(executed('delete')[0].filters).toContain('eq:page_id=p1')
    expect(container.textContent).toBe('')
  })

  it('pagehide leaves once, even after the tab was already hidden', async () => {
    await render('p1', true)
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    expect(executed('delete')).toHaveLength(1)

    await setHidden(true)
    expect(executed('delete')).toHaveLength(1)
  })
})

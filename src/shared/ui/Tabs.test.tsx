// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Tabs } from '@/shared/ui/Tabs'
import { tabPanelProps } from '@/lib/tabs'
import { expectNoAxeViolations } from '@/test/axe'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ITEMS = ['overview', 'transactions', 'budgets'] as const

function Demo() {
  const [tab, setTab] = useState<(typeof ITEMS)[number]>('overview')
  return (
    <>
      <Tabs idBase="fin" items={ITEMS} selected={tab} onSelect={setTab} label="Seções"
        renderTab={(id, props) => <button key={id} type="button" {...props}>{id}</button>} />
      <div {...tabPanelProps('fin', tab)}>painel {tab}</div>
    </>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<Demo />) })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const tabs = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'))
const key = (el: HTMLElement, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

describe('Tabs (UX-008)', () => {
  it('exposes tablist, selection and the panel link', () => {
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Seções')
    const [first, second] = tabs()
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(second.getAttribute('aria-selected')).toBe('false')
    const panel = container.querySelector('[role="tabpanel"]')!
    expect(first.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(first.id)
  })

  it('is a single Tab stop', () => {
    expect(tabs().map(t => t.tabIndex)).toEqual([0, -1, -1])
  })

  it('arrows, Home and End move and select, wrapping around', () => {
    key(tabs()[0], 'ArrowRight')
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[1])
    key(tabs()[1], 'End')
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true')
    key(tabs()[2], 'ArrowRight')
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
    key(tabs()[0], 'ArrowLeft')
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true')
    key(tabs()[2], 'Home')
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe('painel overview')
  })

  it('has no axe violations', async () => {
    await expectNoAxeViolations(container)
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Page } from '../types'

// UX-002: a árvore de páginas é uma árvore ARIA navegável só pelo teclado.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pagesApi = {
  activePage: null as Page | null,
  setActivePage: vi.fn(),
  createPage: vi.fn(),
  deletePage: vi.fn(),
  updatePage: vi.fn(),
}
vi.mock('../contexts/pagesState', () => ({
  usePages: () => pagesApi,
  usePageNavigation: () => pagesApi,
  usePageActions: () => pagesApi,
}))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

import { PageItem, PageTreeRoot } from './PageTree'

function page(id: string, children: Page[] = []): Page {
  return { id, title: id, type: 'note', icon: '', is_favorite: false, children } as unknown as Page
}

const TREE = [page('A', [page('A1'), page('A2', [page('A2a')])]), page('B')]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  pagesApi.activePage = null
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderTree(opts: { readOnly?: boolean } = {}) {
  act(() => {
    root.render(
      <PageTreeRoot label="Páginas" pages={TREE}>
        {TREE.map(p => <PageItem key={p.id} page={p} depth={0} readOnly={opts.readOnly} />)}
      </PageTreeRoot>,
    )
  })
}

const item = (id: string) => {
  const el = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(e => e.getAttribute('aria-label') === id)
  if (!el) throw new Error(`item ${id} não renderizado`)
  return el
}
const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label')

function press(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

function focus(el: HTMLElement) {
  act(() => el.focus())
}

describe('árvore de páginas (UX-002)', () => {
  it('expõe tree/treeitem e tem uma única parada de Tab', () => {
    renderTree()
    expect(container.querySelector('[role="tree"]')?.getAttribute('aria-label')).toBe('Páginas')
    const tabbable = Array.from(container.querySelectorAll('[role="treeitem"]')).filter(e => e.getAttribute('tabindex') === '0')
    expect(tabbable.map(e => e.getAttribute('aria-label'))).toEqual(['A'])
    expect(item('A').getAttribute('aria-expanded')).toBe('false')
    expect(item('A').getAttribute('aria-level')).toBe('1')
    expect(item('B').hasAttribute('aria-expanded')).toBe(false)
  })

  it('↓ ↑ Home End andam pelos itens visíveis e levam a parada de Tab junto', () => {
    renderTree()
    focus(item('A'))
    press(item('A'), 'ArrowDown')
    expect(focused()).toBe('B')
    expect(item('B').getAttribute('tabindex')).toBe('0')
    expect(item('A').getAttribute('tabindex')).toBe('-1')
    press(item('B'), 'ArrowUp')
    expect(focused()).toBe('A')
    press(item('A'), 'End')
    expect(focused()).toBe('B')
    press(item('B'), 'Home')
    expect(focused()).toBe('A')
  })

  it('→ expande e depois entra no filho; ← volta ao pai e depois recolhe', () => {
    renderTree()
    focus(item('A'))
    press(item('A'), 'ArrowRight')
    expect(item('A').getAttribute('aria-expanded')).toBe('true')
    expect(item('A1').getAttribute('aria-level')).toBe('2')
    expect(focused()).toBe('A')
    press(item('A'), 'ArrowRight')
    expect(focused()).toBe('A1')
    press(item('A1'), 'ArrowDown')
    expect(focused()).toBe('A2')
    press(item('A2'), 'ArrowLeft')
    expect(focused()).toBe('A')
    press(item('A'), 'ArrowLeft')
    expect(item('A').getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('A1')
  })

  it('Enter abre a página', () => {
    renderTree()
    focus(item('B'))
    press(item('B'), 'Enter')
    expect(pagesApi.setActivePage).toHaveBeenCalledWith(expect.objectContaining({ id: 'B' }))
  })

  it('F2 renomeia; Esc cancela e devolve o foco ao item', () => {
    renderTree()
    focus(item('A'))
    press(item('A'), 'F2')
    let input = container.querySelector('input')!
    expect(input.value).toBe('A')
    press(input, 'Escape')
    expect(container.querySelector('input')).toBeNull()
    expect(focused()).toBe('A')
    expect(pagesApi.updatePage).not.toHaveBeenCalled()

    press(item('A'), 'F2')
    input = container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Novo nome')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    press(input, 'Enter')
    expect(pagesApi.updatePage).toHaveBeenCalledTimes(1)
    expect(pagesApi.updatePage).toHaveBeenCalledWith('A', { title: 'Novo nome' })
    expect(focused()).toBe('A')
  })

  it('Delete pede confirmação', () => {
    renderTree()
    focus(item('B'))
    press(item('B'), 'Delete')
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(pagesApi.deletePage).not.toHaveBeenCalled()
  })

  it('somente leitura: F2 e Delete não fazem nada', () => {
    renderTree({ readOnly: true })
    focus(item('A'))
    press(item('A'), 'F2')
    press(item('A'), 'Delete')
    expect(container.querySelector('input')).toBeNull()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('a página aberta vira a parada de Tab', () => {
    pagesApi.activePage = TREE[1]
    renderTree()
    expect(item('B').getAttribute('tabindex')).toBe('0')
    expect(item('A').getAttribute('tabindex')).toBe('-1')
  })
})

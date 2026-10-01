// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDialog } from './useDialog'

// UX-003: comportamento comum dos modais.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.style.overflow = ''
})

function Dialog({ name, onClose, closeOnEsc = true, autoFocusInput = false, children }: {
  name: string; onClose: () => void; closeOnEsc?: boolean; autoFocusInput?: boolean; children?: React.ReactNode
}) {
  const { titleId, dialogProps } = useDialog({ onClose, closeOnEsc })
  return (
    <div {...dialogProps} data-testid={name}>
      <h3 id={titleId}>{name}</h3>
      <input data-testid={`${name}-input`} autoFocus={autoFocusInput} />
      <button type="button" data-testid={`${name}-last`}>ok</button>
      {children}
    </div>
  )
}

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!

function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

describe('useDialog', () => {
  it('se anuncia como diálogo modal com título e recebe o foco', () => {
    act(() => { root.render(<Dialog name="Editar" onClose={() => {}} />) })
    const panel = byId('Editar')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)?.textContent).toBe('Editar')
    expect(document.activeElement).toBe(panel)
  })

  it('mantém o autoFocus de um campo do modal', () => {
    act(() => { root.render(<Dialog name="Form" autoFocusInput onClose={() => {}} />) })
    expect(document.activeElement).toBe(byId('Form-input'))
  })

  it('Esc fecha; com closeOnEsc=false (formulário) não fecha', () => {
    const onClose = vi.fn()
    act(() => { root.render(<Dialog name="A" onClose={onClose} />) })
    press('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)

    const keep = vi.fn()
    act(() => { root.render(<Dialog name="B" closeOnEsc={false} onClose={keep} />) })
    press('Escape')
    expect(keep).not.toHaveBeenCalled()
  })

  it('prende o Tab dentro do painel, inclusive se o foco escapou', () => {
    act(() => { root.render(<Dialog name="T" onClose={() => {}} />) })
    act(() => byId('T-last').focus())
    press('Tab')
    expect(document.activeElement).toBe(byId('T-input'))
    press('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(byId('T-last'))

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())
    press('Tab')
    expect(document.activeElement).toBe(byId('T-input'))
    outside.remove()
  })

  it('devolve o foco a quem abriu e trava o scroll enquanto aberto', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    document.body.style.overflow = 'auto'

    act(() => { root.render(<Dialog name="S" autoFocusInput onClose={() => {}} />) })
    expect(document.body.style.overflow).toBe('hidden')

    act(() => { root.render(<></>) })
    expect(document.body.style.overflow).toBe('auto')
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('aninhado: Esc fecha só o de cima; o scroll só destrava no último', () => {
    const closeOuter = vi.fn()
    function Nested() {
      const [inner, setInner] = useState(true)
      return (
        <Dialog name="outer" onClose={closeOuter}>
          {inner && <Dialog name="inner" onClose={() => setInner(false)} />}
        </Dialog>
      )
    }
    act(() => { root.render(<Nested />) })
    press('Escape')
    expect(container.querySelector('[data-testid="inner"]')).toBeNull()
    expect(closeOuter).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('hidden')

    press('Escape')
    expect(closeOuter).toHaveBeenCalledTimes(1)
  })
})

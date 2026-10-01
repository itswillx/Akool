// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { activateProps } from './a11y'

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
})

function press(target: Element, key: string) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => { target.dispatchEvent(ev) })
  return ev
}

function renderRow(label?: string) {
  const onActivate = vi.fn()
  act(() => {
    root.render(
      <div data-testid="row" {...activateProps(onActivate, { label })}>
        Linha <input data-testid="inner" /> <button type="button">ação</button>
      </div>,
    )
  })
  const row = container.querySelector('[data-testid="row"]')!
  return { onActivate, row }
}

describe('activateProps', () => {
  it('vira botão focável', () => {
    const { row } = renderRow('Editar título')
    expect(row.getAttribute('role')).toBe('button')
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(row.getAttribute('aria-label')).toBe('Editar título')
  })

  it('Enter e Espaço acionam; Espaço não rola a página', () => {
    const { row, onActivate } = renderRow()
    press(row, 'Enter')
    const space = press(row, ' ')
    expect(onActivate).toHaveBeenCalledTimes(2)
    expect(space.defaultPrevented).toBe(true)
  })

  it('ignora teclas que vêm de um input ou botão dentro da linha', () => {
    const { row, onActivate } = renderRow()
    press(row.querySelector('[data-testid="inner"]')!, 'Enter')
    press(row.querySelector('button')!, ' ')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('outras teclas não acionam', () => {
    const { row, onActivate } = renderRow()
    const tab = press(row, 'Tab')
    press(row, 'a')
    expect(onActivate).not.toHaveBeenCalled()
    expect(tab.defaultPrevented).toBe(false)
  })
})

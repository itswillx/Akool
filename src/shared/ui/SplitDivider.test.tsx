// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// UX-010: o divisor do split view funciona com pointer (mouse, toque, caneta)
// e pelo teclado, sempre entre 20% e 80%.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/LanguageContext', async () => {
  const { getT } = await import('@/i18n/translations')
  return { useLanguage: () => ({ lang: 'pt-BR', t: getT('pt-BR') }) }
})

import SplitDivider from '@/shared/ui/SplitDivider'

const onDraggingChange = vi.fn()

function Harness({ stacked = false }: { stacked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(50)
  return (
    <div ref={ref} data-testid="box">
      <SplitDivider containerRef={ref} ratio={ratio} onChange={setRatio} onDraggingChange={onDraggingChange} stacked={stacked} />
    </div>
  )
}

let container: HTMLDivElement
let root: Root

function render(stacked = false) {
  act(() => root.render(<Harness stacked={stacked} />))
  const box = container.querySelector('[data-testid="box"]') as HTMLDivElement
  // Contêiner de 400×200 na posição (100, 50).
  box.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) })
  return container.querySelector('[role="separator"]') as HTMLDivElement
}

const valueOf = (separator: HTMLElement) => Number(separator.getAttribute('aria-valuenow'))

function press(separator: HTMLElement, key: string) {
  act(() => { separator.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
}

function pointer(separator: HTMLElement, type: string, init: PointerEventInit = {}) {
  act(() => { separator.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init })) })
}

beforeEach(() => {
  onDraggingChange.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SplitDivider', () => {
  it('is a focusable separator labelled for screen readers', () => {
    const separator = render()
    expect(separator.tabIndex).toBe(0)
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.getAttribute('aria-valuemin')).toBe('20')
    expect(separator.getAttribute('aria-valuemax')).toBe('80')
    expect(separator.getAttribute('aria-label')).toBe('Redimensionar nota e desenho')
    expect(render(true).getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('arrow keys move 5% and stop at the 20–80% limits; Home and End jump to them', () => {
    const separator = render()
    press(separator, 'ArrowRight')
    expect(valueOf(separator)).toBe(55)
    press(separator, 'ArrowLeft')
    press(separator, 'ArrowUp')
    expect(valueOf(separator)).toBe(45)
    press(separator, 'End')
    press(separator, 'ArrowDown')
    expect(valueOf(separator)).toBe(80)
    press(separator, 'Home')
    press(separator, 'ArrowLeft')
    expect(valueOf(separator)).toBe(20)
  })

  it('dragging side by side follows the pointer across the width and captures it', () => {
    const separator = render()
    pointer(separator, 'pointerdown', { clientX: 300 })
    expect(separator.hasPointerCapture(1)).toBe(true)
    expect(onDraggingChange).toHaveBeenLastCalledWith(true)

    pointer(separator, 'pointermove', { clientX: 200 })
    expect(valueOf(separator)).toBe(25)
    pointer(separator, 'pointermove', { clientX: 490 })
    expect(valueOf(separator)).toBe(80)

    pointer(separator, 'pointerup', { clientX: 490 })
    expect(onDraggingChange).toHaveBeenLastCalledWith(false)
    pointer(separator, 'pointermove', { clientX: 300 })
    expect(valueOf(separator)).toBe(80)
  })

  it('stacked (phone) uses the vertical position', () => {
    const separator = render(true)
    pointer(separator, 'pointerdown', { clientY: 150 })
    pointer(separator, 'pointermove', { clientY: 170 })
    expect(valueOf(separator)).toBe(60)
  })

  it('pointercancel ends the drag, and a secondary button never starts one', () => {
    const separator = render()
    pointer(separator, 'pointerdown', { clientX: 300 })
    pointer(separator, 'pointercancel')
    expect(onDraggingChange).toHaveBeenLastCalledWith(false)
    pointer(separator, 'pointermove', { clientX: 200 })
    expect(valueOf(separator)).toBe(50)

    onDraggingChange.mockReset()
    pointer(separator, 'pointerdown', { clientX: 300, button: 2 })
    expect(onDraggingChange).not.toHaveBeenCalled()
  })
})

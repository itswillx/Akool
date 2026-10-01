// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DndContext, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { KANBAN_KEYBOARD_CODES } from '../../lib/dndAccessibility'

// UX-002: no board, Enter abre o card e Espaço pega o card para mover.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

import { BoardCardShell } from './BoardCard'

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

function Board({ onClick, onDragStart, draggable }: { onClick: () => void; onDragStart: () => void; draggable: boolean }) {
  const sensors = useSensors(
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: KANBAN_KEYBOARD_CODES }),
  )
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart}>
      <BoardCardShell id="c1" draggable={draggable} onClick={onClick}>Venda #1</BoardCardShell>
    </DndContext>
  )
}

function renderCard(draggable = true) {
  const onClick = vi.fn()
  const onDragStart = vi.fn()
  act(() => { root.render(<Board onClick={onClick} onDragStart={onDragStart} draggable={draggable} />) })
  const card = container.querySelector<HTMLElement>('[role="button"]')!
  return { card, onClick, onDragStart }
}

function press(target: Element, key: string, code = key) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
  })
}

describe('BoardCardShell (teclado)', () => {
  it('é focável e Enter abre o card', () => {
    const { card, onClick } = renderCard()
    expect(card.getAttribute('tabindex')).toBe('0')
    press(card, 'Enter')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Espaço pega o card para mover e não abre; Enter durante o arrasto não abre', () => {
    const { card, onClick, onDragStart } = renderCard()
    press(card, ' ', 'Space')
    expect(onDragStart).toHaveBeenCalledTimes(1)
    press(card, 'Enter')
    expect(onClick).not.toHaveBeenCalled()
    press(card, 'Escape')
  })

  it('card estático (sem arrasto) ainda abre com Enter', () => {
    const { card, onClick, onDragStart } = renderCard(false)
    press(card, ' ', 'Space')
    press(card, 'Enter')
    expect(onDragStart).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('Enter vindo dos botões ‹ › não abre o card', () => {
    const onClick = vi.fn()
    const onMoveNext = vi.fn()
    act(() => {
      root.render(
        <DndContext>
          <BoardCardShell id="c1" draggable={false} onClick={onClick} onMoveNext={onMoveNext}>Venda #1</BoardCardShell>
        </DndContext>,
      )
    })
    const next = container.querySelector('button[title="board_move_next"]')!
    press(next, 'Enter')
    expect(onClick).not.toHaveBeenCalled()
  })
})

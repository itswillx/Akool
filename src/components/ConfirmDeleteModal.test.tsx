// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ConfirmDeleteModal from './ConfirmDeleteModal'

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

function renderModal(props: Partial<Parameters<typeof ConfirmDeleteModal>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  act(() => {
    root.render(
      <ConfirmDeleteModal open title="Restaurar backup?" message="Isso substitui os dados atuais." onConfirm={onConfirm} onCancel={onCancel} {...props} />,
    )
  })
  const [cancel, confirm] = Array.from(container.querySelectorAll('button'))
  return { onConfirm, onCancel, cancel, confirm }
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

describe('ConfirmDeleteModal (teclado)', () => {
  it('abre com o foco em Cancelar', () => {
    const { cancel } = renderModal()
    expect(document.activeElement).toBe(cancel)
  })

  it('Enter com foco em Cancelar não confirma a ação (UX-001)', () => {
    const { onConfirm, cancel } = renderModal()
    press(cancel, 'Enter')
    press(document.body, 'Enter')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Esc cancela', () => {
    const { onCancel, onConfirm, cancel } = renderModal()
    press(cancel, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('prende o foco entre Cancelar e Confirmar', () => {
    const { cancel, confirm } = renderModal()

    act(() => confirm.focus())
    press(confirm, 'Tab')
    expect(document.activeElement).toBe(cancel)

    press(cancel, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('expõe alertdialog com título e descrição', () => {
    renderModal()
    const dialog = container.querySelector('[role="alertdialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Restaurar backup?')
    expect(document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Isso substitui os dados atuais.')
  })

  it('devolve o foco a quem abriu o modal ao fechar', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    renderModal()
    act(() => {
      root.render(<ConfirmDeleteModal open={false} onConfirm={() => {}} onCancel={() => {}} />)
    })

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

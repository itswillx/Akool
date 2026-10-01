// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

import QueueReviewBanner from './QueueReviewBanner'

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

function render() {
  const onApprove = vi.fn(async () => true)
  const onReject = vi.fn<(reason: string) => Promise<boolean>>(async () => true)
  act(() => { root.render(<QueueReviewBanner onApprove={onApprove} onReject={onReject} />) })
  return { onApprove, onReject }
}

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label)) as HTMLButtonElement

async function click(el: HTMLElement) {
  await act(async () => { el.click() })
}

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('QueueReviewBanner', () => {
  it('aprovar chama onApprove sem pedir motivo', async () => {
    const { onApprove, onReject } = render()
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('projects_queue_review_title')
    await click(button('projects_queue_approve'))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).not.toHaveBeenCalled()
  })

  it('reprovar exige o motivo, rotulado, e envia o texto sem espaços nas pontas', async () => {
    const { onApprove, onReject } = render()
    await click(button('projects_queue_reject'))

    const textarea = container.querySelector('textarea')!
    const label = container.querySelector(`label[for="${textarea.id}"]`)
    expect(label?.textContent).toBe('projects_queue_reject_reason')
    expect(button('projects_queue_reject_confirm').disabled).toBe(true)

    type(textarea, '  faltou teste  ')
    expect(button('projects_queue_reject_confirm').disabled).toBe(false)
    await click(button('projects_queue_reject_confirm'))
    expect(onReject).toHaveBeenCalledWith('faltou teste')
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('cancelar a reprovação volta aos dois botões', async () => {
    render()
    await click(button('projects_queue_reject'))
    await click(button('projects_cancel'))
    expect(container.querySelector('textarea')).toBeNull()
    expect(button('projects_queue_approve')).toBeTruthy()
  })
})

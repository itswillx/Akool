// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Field } from '@/shared/ui/Field'

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

describe('Field (UX-007)', () => {
  it('links the label to the input', () => {
    act(() => { root.render(<Field label="E-mail">{c => <input {...c} type="email" />}</Field>) })
    const label = container.querySelector('label')!
    const input = container.querySelector('input')!
    expect(label.htmlFor).toBe(input.id)
    expect(input.id).not.toBe('')
    expect(input.getAttribute('aria-describedby')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('announces the error and points the input to it and to the hint', () => {
    act(() => {
      root.render(<Field label="Senha" hint={<span>Mínimo 8</span>} error="Senha fraca">{c => <input {...c} />}</Field>)
    })
    const input = container.querySelector('input')!
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toBe('Senha fraca')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input.getAttribute('aria-describedby')!.split(' ')
    expect(described).toContain(alert.id)
    expect(described).toHaveLength(2)
  })

  it('gives each field its own id', () => {
    act(() => {
      root.render(<>
        <Field label="A">{c => <input {...c} />}</Field>
        <Field label="B">{c => <input {...c} />}</Field>
      </>)
    })
    const [a, b] = Array.from(container.querySelectorAll('input'))
    expect(a.id).not.toBe(b.id)
  })
})

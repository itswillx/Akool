// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDocumentTitle } from './useDocumentTitle'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Section({ name }: { name: string | null }) {
  useDocumentTitle(name)
  return null
}

let container: HTMLDivElement
let root: Root
const render = (name: string | null) => act(() => root.render(<Section name={name} />))

beforeEach(() => {
  document.title = 'Akool'
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

describe('useDocumentTitle', () => {
  it('shows the section before the app name and follows changes', () => {
    render('Finanças')
    expect(document.title).toBe('Finanças · Akool')
    render('Ajuda')
    expect(document.title).toBe('Ajuda · Akool')
  })

  it('falls back to the app name without a section and on unmount', () => {
    render(null)
    expect(document.title).toBe('Akool')
    render('Documentos')
    act(() => root.unmount())
    expect(document.title).toBe('Akool')
    root = createRoot(container)
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { documentTitleFor, useDocumentTitle } from '@/shared/hooks/useDocumentTitle'

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

describe('documentTitleFor (UX-006)', () => {
  const t = (key: string) => `[${key}]`
  const base = { financeOpen: false, activePanel: null, docsPage: null, activePage: null, t }

  it('finanças vence tudo', () => {
    expect(documentTitleFor({ ...base, financeOpen: true, activePanel: 'documents', docsPage: { title: 'X' } })).toBe('[sidebar_section_finance]')
  })

  it('Documentos sem página selecionada é "Documentos"', () => {
    expect(documentTitleFor({ ...base, activePanel: 'documents', activePage: { title: 'Outra' } })).toBe('[sidebar_section_documents]')
  })

  it('Documentos com página selecionada é o nome dela (ou "Sem título")', () => {
    expect(documentTitleFor({ ...base, activePanel: 'documents', docsPage: { title: 'Kubernetes' } })).toBe('Kubernetes')
    expect(documentTitleFor({ ...base, activePanel: 'documents', docsPage: { title: '' } })).toBe('[page_header_untitled]')
  })

  it('Ajuda, página aberta e Dashboard', () => {
    expect(documentTitleFor({ ...base, activePanel: 'help' })).toBe('[sidebar_help]')
    expect(documentTitleFor({ ...base, activePage: { title: 'Nota' } })).toBe('Nota')
    expect(documentTitleFor({ ...base, activePage: { title: '' } })).toBe('[page_header_untitled]')
    expect(documentTitleFor(base)).toBe('[sidebar_dashboard]')
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// PERF-009: o inglês é baixado pelo provider quando o perfil pede; até lá o
// app fica inteiro em pt-BR (lang e t do mesmo idioma).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const authState: { profile: { language: 'pt-BR' | 'en' } | null } = { profile: null }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState }))

import { LanguageProvider, useLanguage } from './LanguageContext'
import { isLangLoaded, loadLang } from './translations'

function Probe() {
  const { lang, t } = useLanguage()
  return <span>{lang}|{t('app_loading')}</span>
}

let container: HTMLDivElement
let root: Root
const renderApp = () => act(() => root.render(<LanguageProvider><Probe /></LanguageProvider>))

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LanguageProvider', () => {
  it('keeps pt-BR while the English dictionary downloads, then switches', async () => {
    authState.profile = { language: 'pt-BR' }
    renderApp()
    expect(container.textContent).toBe('pt-BR|Carregando...')
    expect(document.documentElement.lang).toBe('pt-BR')

    authState.profile = { language: 'en' }
    renderApp()
    expect(isLangLoaded('en')).toBe(false)
    expect(container.textContent).toBe('pt-BR|Carregando...')

    // Mesmo download que o provider já começou.
    await act(async () => { await loadLang('en') })
    expect(container.textContent).toBe('en|Loading...')
    // UX-006: o <html lang> acompanha o idioma que está na tela.
    expect(document.documentElement.lang).toBe('en')
  })

  it('renders straight in English once the dictionary is loaded', () => {
    authState.profile = { language: 'en' }
    renderApp()
    expect(container.textContent).toBe('en|Loading...')
  })
})

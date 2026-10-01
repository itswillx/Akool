// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

import ErrorBoundary from './ErrorBoundary'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // React e o componentDidCatch registram o erro capturado; aqui é esperado.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function Boom({ error }: { error: Error | null }) {
  if (error) throw error
  return <p>conteúdo</p>
}

const render = (ui: React.ReactNode) => act(() => root.render(ui))

describe('ErrorBoundary', () => {
  it('erro comum: "Tentar novamente" remonta os filhos', () => {
    let error: Error | null = new Error('falhou')
    const Child = () => <Boom error={error} />
    render(<ErrorBoundary><Child /></ErrorBoundary>)
    expect(container.textContent).toContain('common_error_section')

    error = null
    act(() => container.querySelector('button')!.click())
    expect(container.textContent).toBe('conteúdo')
  })

  it('erro de chunk: oferece recarregar a página, não repetir', () => {
    render(<ErrorBoundary><Boom error={new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js')} /></ErrorBoundary>)
    expect(container.textContent).toContain('common_error_chunk')
    expect(container.querySelector('button')!.textContent).toBe('common_error_reload')
    expect(container.textContent).not.toContain('common_error_retry')
  })

  it('resetKey novo limpa o erro; o mesmo resetKey mantém o fallback', () => {
    render(<ErrorBoundary resetKey="a"><Boom error={new Error('x')} /></ErrorBoundary>)
    expect(container.textContent).toContain('common_error_section')

    render(<ErrorBoundary resetKey="a"><Boom error={null} /></ErrorBoundary>)
    expect(container.textContent).toContain('common_error_section')

    render(<ErrorBoundary resetKey="b"><Boom error={null} /></ErrorBoundary>)
    expect(container.textContent).toBe('conteúdo')
  })

  it('key diferente por painel: o erro de um não aparece no outro', () => {
    render(<ErrorBoundary key="help"><Boom error={new Error('x')} /></ErrorBoundary>)
    expect(container.textContent).toContain('common_error_section')

    render(<ErrorBoundary key="documents"><Boom error={null} /></ErrorBoundary>)
    expect(container.textContent).toBe('conteúdo')
  })
})

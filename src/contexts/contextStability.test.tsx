// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, memo, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// PERF-001: um re-render do provider com as mesmas entradas não pode
// re-renderizar os consumidores (antes, `value={{ … }}` novo a cada render
// derrubava os 93 arquivos com useLanguage a cada foco da aba).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const stableUpdateProfile = vi.fn(async () => ({ error: null }))
const authState = {
  user: { id: 'u1' },
  profile: { language: 'pt-BR', theme: 'light' },
  updateProfile: stableUpdateProfile,
}
vi.mock('./AuthContext', () => ({ useAuth: () => authState }))

// Cliente falso só com o que o NotificationsProvider usa.
vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'update']) chain[m] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { from: () => chain, channel: () => channel, removeChannel: () => {} } }
})

import { LanguageProvider, useLanguage } from '../i18n/LanguageContext'
import { ThemeProvider, useTheme } from './ThemeContext'
import { OnboardingProvider, useOnboarding } from './OnboardingContext'
import { NotificationsProvider, useNotifications } from './NotificationsContext'
import { ToastProvider, useToast } from './ToastContext'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.setItem('akool_onboarding_seen_u1', '1')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Monta Provider > Consumer (memo) sob um pai que pode re-renderizar à vontade. */
async function mountWithParent(Provider: (p: { children: ReactNode }) => ReactNode, useCtx: () => unknown) {
  let renders = 0
  const Consumer = memo(function Consumer() {
    useCtx()
    renders++
    return null
  })
  let rerenderParent = () => {}
  function Parent() {
    const [, setN] = useState(0)
    rerenderParent = () => setN(n => n + 1)
    return <Provider><Consumer /></Provider>
  }
  await act(async () => { root.render(<Parent />) })
  return {
    get renders() { return renders },
    rerenderParent: async () => { await act(async () => { rerenderParent() }) },
  }
}

// Theme e Notifications avisam por toast (REL-004); no app, o ToastProvider
// fica acima deles (App.tsx).
const underToast = (Provider: (p: { children: ReactNode }) => ReactNode) =>
  function WithToast({ children }: { children: ReactNode }) {
    return <ToastProvider><Provider>{children}</Provider></ToastProvider>
  }

describe('providers estáveis (PERF-001)', () => {
  it.each([
    ['LanguageProvider', LanguageProvider, useLanguage],
    ['ThemeProvider', underToast(ThemeProvider), useTheme],
    ['OnboardingProvider', OnboardingProvider, useOnboarding],
    ['NotificationsProvider', underToast(NotificationsProvider), useNotifications],
  ] as const)('%s: re-render do provider não re-renderiza o consumidor', async (_name, Provider, useCtx) => {
    const h = await mountWithParent(Provider, useCtx)
    const before = h.renders
    await h.rerenderParent()
    await h.rerenderParent()
    await h.rerenderParent()
    expect(h.renders).toBe(before)
  })

  it('ToastProvider: mostrar e fechar toast não re-renderiza quem só usa as ações', async () => {
    let renders = 0
    let actions: ReturnType<typeof useToast> | null = null
    const ActionsConsumer = memo(function ActionsConsumer() {
      actions = useToast()
      renders++
      return null
    })
    await act(async () => { root.render(<ToastProvider><ActionsConsumer /></ToastProvider>) })
    const before = renders

    let id = ''
    await act(async () => { id = actions!.showToast('error', 'Falhou ao salvar') })
    await act(async () => { actions!.showToast('success', 'Salvo') })
    await act(async () => { actions!.dismissToast(id) })

    expect(renders).toBe(before)
    // ToastStack usa portal no body: a fila continua aparecendo.
    expect(document.body.textContent).toContain('Salvo')
  })
})

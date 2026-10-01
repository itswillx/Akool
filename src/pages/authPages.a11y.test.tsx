// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expectNoAxeViolations } from '../test/axe'

// UX-008: varredura axe nas telas que abrem sem login (login, cadastro,
// esqueci a senha e redefinir senha). As telas logadas ficam com a extensão
// axe DevTools, porque dependem de sessão.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/supabase', () => ({ supabase: {}, recoveryLinkError: null }))
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'eu@example.com' },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(),
    completePasswordReset: vi.fn(), cancelPasswordReset: vi.fn(),
  }),
}))

import AuthPage from './AuthPage'
import ResetPasswordPage from './ResetPasswordPage'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const clickButton = (text: RegExp) => act(() => {
  const button = [...container.querySelectorAll('button')].find(b => text.test(b.textContent ?? ''))
  button?.click()
})

describe('telas sem login (UX-008)', () => {
  it('login, cadastro e esqueci a senha não têm violações sérias', async () => {
    act(() => { root.render(<AuthPage />) })
    await expectNoAxeViolations(container)

    clickButton(/criar conta/i)
    expect(container.querySelectorAll('form input')).toHaveLength(3)
    await expectNoAxeViolations(container)

    clickButton(/entrar/i)
    clickButton(/esqueci/i)
    await expectNoAxeViolations(container)
  })

  it('redefinir senha não tem violações sérias, e o botão do olho tem nome', async () => {
    act(() => { root.render(<ResetPasswordPage />) })
    await expectNoAxeViolations(container)
    const toggles = [...container.querySelectorAll('button[aria-pressed]')]
    expect(toggles.map(b => b.getAttribute('aria-label'))).toEqual(['Mostrar senha', 'Mostrar senha'])
  })
})

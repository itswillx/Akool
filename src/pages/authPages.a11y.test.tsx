// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../test/rtl'
import { expectNoAxeViolations } from '../test/axe'
import { authContent } from '../i18n/authContent'
import { landingContent } from '../i18n/landingContent'

// UX-008: varredura axe nas telas que abrem sem login (página pública, login,
// cadastro, esqueci a senha e redefinir senha). As telas logadas ficam com a
// extensão axe DevTools, porque dependem de sessão.

vi.mock('../lib/supabase', () => ({ supabase: {}, recoveryLinkError: null }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'eu@example.com' },
    signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn(),
    completePasswordReset: vi.fn(), cancelPasswordReset: vi.fn(),
    verifyMfa: vi.fn(), signOut: vi.fn(),
  }),
}))

import AuthPage from './AuthPage'
import ResetPasswordPage from './ResetPasswordPage'
import MfaChallengePage from './MfaChallengePage'

const PT = authContent['pt-BR']

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('telas sem login (UX-008)', () => {
  it('página pública, login, cadastro e esqueci a senha não têm violações sérias', async () => {
    const { container } = render(<AuthPage />)
    await screen.findByRole('heading', { level: 1, name: landingContent['pt-BR'].hero.title })
    await expectNoAxeViolations(container)

    fireEvent.click(screen.getAllByRole('link', { name: 'Entrar' })[0])
    expect(screen.getByRole('heading', { level: 1, name: 'Bem-vindo de volta' })).toBeTruthy()
    // Desktop largo: o painel da tela ao lado do cartão, com a prévia do app em Entrar.
    const panel = (context: keyof typeof PT) => screen.getByRole('heading', { level: 2, name: PT[context].title })
    expect(panel('signin')).toBeTruthy()
    expect(container.querySelector('aside .pv')?.getAttribute('aria-hidden')).toBe('true')
    await expectNoAxeViolations(container)

    // As abas são links (#entrar / #cadastro) com aria-current; o painel passa aos passos do cadastro.
    fireEvent.click(screen.getByRole('link', { name: 'Criar conta' }))
    expect(container.querySelectorAll('form input')).toHaveLength(3)
    expect(panel('signup')).toBeTruthy()
    await expectNoAxeViolations(container)

    fireEvent.click(screen.getAllByRole('link', { name: 'Entrar' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    expect(container.querySelectorAll('form input')).toHaveLength(1)
    expect(panel('forgot')).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('a etapa do MFA não tem violações sérias', async () => {
    const { container } = render(<MfaChallengePage />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: PT.mfa.title })).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('redefinir senha não tem violações sérias, e o botão do olho tem nome', async () => {
    const { container } = render(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { level: 2, name: PT.reset.title })).toBeTruthy()
    await expectNoAxeViolations(container)
    // Só os olhos do formulário: no desktop o seletor PT/EN da barra também usa aria-pressed.
    const toggles = [...container.querySelectorAll('form button[aria-pressed]')]
    expect(toggles.map(b => b.getAttribute('aria-label'))).toEqual(['Mostrar senha', 'Mostrar senha'])
  })
})

// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '../test/rtl'

// Link de recuperação expirado: o Supabase devolve para `/` com `#error=…`;
// o AuthPage abre direto em "Recuperar senha" e troca o hash por #recuperar.
// Arquivo à parte porque recoveryLinkError é uma constante do módulo.

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() }, recoveryLinkError: true }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: vi.fn(), signUp: vi.fn(), sendPasswordReset: vi.fn() }),
}))

import AuthPage from './AuthPage'

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')
})

it('abre em "Recuperar senha" com a faixa do link expirado e limpa o hash', () => {
  render(<AuthPage />)
  expect(screen.getByRole('heading', { level: 1, name: 'Recuperar senha' })).toBeTruthy()
  expect(screen.getByText('O link de recuperação expirou ou já foi usado. Solicite um novo abaixo.')).toBeTruthy()
  expect(document.querySelectorAll('form input')).toHaveLength(1)
  expect(window.location.hash).toBe('#recuperar')
})

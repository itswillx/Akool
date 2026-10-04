// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/rtl'
import { getT } from '../i18n/translations'

const auth = vi.hoisted(() => ({ verifyMfa: vi.fn(), signOut: vi.fn(), cancelPasswordReset: vi.fn(), recoveryMode: false }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'eu@example.com' }, verifyMfa: auth.verifyMfa, signOut: auth.signOut,
    recoveryMode: auth.recoveryMode, cancelPasswordReset: auth.cancelPasswordReset,
  }),
}))

import MfaChallengePage from './MfaChallengePage'

const t = getT('pt-BR')

beforeEach(() => {
  localStorage.clear()
  auth.verifyMfa.mockReset()
  auth.signOut.mockReset()
  auth.cancelPasswordReset.mockReset()
  auth.recoveryMode = false
})

it('abre no shell comum com o foco no campo do código e o título da aba', () => {
  render(<MfaChallengePage />)
  expect(screen.getByRole('heading', { level: 1, name: t('mfa_challenge_title') })).toBeTruthy()
  const input = screen.getByLabelText(t('mfa_code_label'))
  expect(document.activeElement).toBe(input)
  expect(document.title).toBe(`${t('mfa_challenge_title')} · Akool`)
  expect(screen.getByText('eu@example.com')).toBeTruthy()
})

it('código incompleto para no campo; código inválido no servidor também; 6 dígitos chamam verifyMfa', async () => {
  auth.verifyMfa.mockResolvedValue({ error: 'invalid_code' })
  render(<MfaChallengePage />)
  const input = screen.getByLabelText(t('mfa_code_label'))
  fireEvent.change(input, { target: { value: '12a45' } })
  expect((input as HTMLInputElement).value).toBe('1245')
  fireEvent.submit(input.closest('form')!)
  expect(screen.getByRole('alert').textContent).toBe(t('mfa_invalid_code'))
  expect(auth.verifyMfa).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '123456' } })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(auth.verifyMfa).toHaveBeenCalledWith('123456'))
  expect(await screen.findByRole('alert')).toBeTruthy()
})

it('"Sair" na barra do topo encerra a sessão', () => {
  render(<MfaChallengePage />)
  fireEvent.click(screen.getByRole('button', { name: t('mfa_signout') }))
  expect(auth.signOut).toHaveBeenCalledTimes(1)
})

it('vindo do link de recuperação (conta com MFA), "Sair" desfaz a recuperação em vez de só sair', () => {
  auth.recoveryMode = true
  render(<MfaChallengePage />)
  fireEvent.click(screen.getByRole('button', { name: t('mfa_signout') }))
  expect(auth.cancelPasswordReset).toHaveBeenCalledTimes(1)
  expect(auth.signOut).not.toHaveBeenCalled()
})

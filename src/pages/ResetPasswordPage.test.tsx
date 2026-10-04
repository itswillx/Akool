// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/rtl'
import { getT } from '../i18n/translations'

const auth = vi.hoisted(() => ({ completePasswordReset: vi.fn(), cancelPasswordReset: vi.fn() }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'eu@example.com' }, completePasswordReset: auth.completePasswordReset, cancelPasswordReset: auth.cancelPasswordReset }),
}))

import ResetPasswordPage from './ResetPasswordPage'

const t = getT('pt-BR')
const STRONG = 'Fict1ciaForte'

beforeEach(() => {
  localStorage.clear()
  auth.completePasswordReset.mockReset()
  auth.cancelPasswordReset.mockReset()
})

it('senha fraca e senhas diferentes param no campo certo, com foco; a válida é enviada', async () => {
  auth.completePasswordReset.mockResolvedValue({ error: null })
  render(<ResetPasswordPage />)
  expect(screen.getByRole('heading', { level: 1, name: t('reset_title') })).toBeTruthy()
  expect(document.title).toBe(`${t('reset_title')} · Akool`)
  const newPwd = screen.getByLabelText(t('settings_new_password'))
  const confirm = screen.getByLabelText(t('settings_confirm_password'))
  const form = newPwd.closest('form')!

  fireEvent.change(newPwd, { target: { value: 'curta' } })
  fireEvent.submit(form)
  expect(newPwd.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(newPwd)
  expect(auth.completePasswordReset).not.toHaveBeenCalled()

  fireEvent.change(newPwd, { target: { value: STRONG } })
  expect(newPwd.getAttribute('aria-invalid')).toBeNull()
  fireEvent.change(confirm, { target: { value: 'outra' } })
  fireEvent.submit(form)
  expect(screen.getByRole('alert').textContent).toBe(t('settings_pwd_mismatch'))
  expect(document.activeElement).toBe(confirm)

  fireEvent.change(confirm, { target: { value: STRONG } })
  fireEvent.submit(form)
  await waitFor(() => expect(auth.completePasswordReset).toHaveBeenCalledWith(STRONG))
})

it('a checklist marca as regras conforme a senha é digitada', () => {
  const { container } = render(<ResetPasswordPage />)
  fireEvent.change(screen.getByLabelText(t('settings_new_password')), { target: { value: 'abcdefghij' } })
  expect(container.querySelectorAll('li[data-met="true"]')).toHaveLength(2)
})

it('"Cancelar e voltar ao login" na barra do topo cancela a recuperação', () => {
  render(<ResetPasswordPage />)
  fireEvent.click(screen.getByRole('button', { name: t('reset_cancel') }))
  expect(auth.cancelPasswordReset).toHaveBeenCalledTimes(1)
})

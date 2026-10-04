// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'

const resend = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { auth: { resend } } }))

import { resendSignupEmail } from './auth'

it('reenvia o e-mail de confirmação do cadastro com o retorno para a origem', async () => {
  resend.mockResolvedValue({ error: null })
  await resendSignupEmail('  pessoa@example.com ')
  expect(resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'pessoa@example.com',
    options: { emailRedirectTo: window.location.origin },
  })
})

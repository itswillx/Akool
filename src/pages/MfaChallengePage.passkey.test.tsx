// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '../test/rtl'

// Tela do código do MFA: quem tem passkey ganha "Entrar com o celular" junto do
// campo do código. O botão não envia o formulário do código.

const auth = vi.hoisted(() => ({
  hasPasskey: true,
  verifyMfa: vi.fn(() => Promise.resolve({ error: null })),
  verifyMfaPasskey: vi.fn(() => Promise.resolve({ error: null })),
}))
// Superconjunto do que a tela usa, hoje e no redesenho das telas de entrada.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'ana@exemplo.com' },
    verifyMfa: auth.verifyMfa,
    signOut: () => Promise.resolve(),
    recoveryMode: false,
    cancelPasswordReset: () => Promise.resolve(),
    hasPasskey: auth.hasPasskey,
    verifyMfaPasskey: auth.verifyMfaPasskey,
  }),
}))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../lib/mfa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/mfa')>(),
  supportsPasskeys: () => true,
}))

import MfaChallengePage from './MfaChallengePage'

beforeEach(() => {
  auth.hasPasskey = true
  auth.verifyMfa.mockClear()
  auth.verifyMfaPasskey.mockClear()
})

describe('MfaChallengePage: entrar com o celular', () => {
  it('com passkey, oferece o celular além do código', async () => {
    const user = userEvent.setup()
    render(<MfaChallengePage />)
    expect(screen.getByText('O navegador mostra um QR code: leia com a câmera do celular e confirme com Face ID ou digital. O Bluetooth precisa estar ligado nos dois aparelhos.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Entrar com o celular' }))
    expect(auth.verifyMfaPasskey).toHaveBeenCalledWith('phone')
    expect(auth.verifyMfa).not.toHaveBeenCalled()
  })

  it('sem passkey, fica só o código', () => {
    auth.hasPasskey = false
    render(<MfaChallengePage />)
    expect(screen.queryByRole('button', { name: 'Entrar com o celular' })).toBeNull()
    expect(screen.getByPlaceholderText('000000')).toBeTruthy()
  })
})

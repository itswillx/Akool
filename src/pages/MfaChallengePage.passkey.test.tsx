// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor } from '../test/rtl'

// Tela do código do MFA: a conta com passkey de login ganha "Entrar com o
// celular" junto do campo do código. O botão não envia o formulário do código.

const auth = vi.hoisted(() => ({
  passkeys: [{ id: 'pk1' }] as { id: string }[],
  verifyMfa: vi.fn(() => Promise.resolve({ error: null })),
  signInWithPasskey: vi.fn(() => Promise.resolve({ error: null })),
}))
const list = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: auth.passkeys, error: null })))
// Superconjunto do que a tela usa, hoje e no redesenho das telas de entrada.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'ana@exemplo.com' },
    verifyMfa: auth.verifyMfa,
    signOut: () => Promise.resolve(),
    recoveryMode: false,
    cancelPasswordReset: () => Promise.resolve(),
    signInWithPasskey: auth.signInWithPasskey,
  }),
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { passkey: { list } } } }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../lib/mfa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/mfa')>(),
  supportsPasskeys: () => true,
}))

// A passkey fica atrás de VITE_MFA_PASSKEY (ligada depois de configurar o Supabase).
const flags = vi.hoisted(() => ({ passkey: true }))
vi.mock('../lib/env', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/env')>(),
  get MFA_PASSKEY_ENABLED() { return flags.passkey },
}))

import MfaChallengePage from './MfaChallengePage'

beforeEach(() => {
  auth.passkeys = [{ id: 'pk1' }]
  auth.verifyMfa.mockClear()
  auth.signInWithPasskey.mockClear()
  list.mockClear()
})

describe('MfaChallengePage: entrar com o celular', () => {
  it('com passkey, oferece o celular além do código', async () => {
    const user = userEvent.setup()
    render(<MfaChallengePage />)
    await user.click(await screen.findByRole('button', { name: 'Entrar com o celular' }))
    expect(screen.getByText('O navegador mostra um QR code: leia com a câmera do celular e confirme com Face ID ou digital. O Bluetooth precisa estar ligado nos dois aparelhos.')).toBeTruthy()
    expect(auth.signInWithPasskey).toHaveBeenCalledTimes(1)
    expect(auth.verifyMfa).not.toHaveBeenCalled()
  })

  it('sem passkey, fica só o código', async () => {
    auth.passkeys = []
    render(<MfaChallengePage />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Entrar com o celular' })).toBeNull()
    expect(screen.getByPlaceholderText('000000')).toBeTruthy()
  })
})

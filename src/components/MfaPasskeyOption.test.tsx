// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor } from '../test/rtl'
import { expectNoAxeViolations } from '../test/axe'
import type { PasskeyErrorKind } from '../lib/mfa'

// Tela do código do MFA: "Entrar com o celular" (passkey de login) só aparece
// para a conta que tem passkey, com a flag ligada e navegador compatível; no
// computador fala do QR, no celular da biometria; cada erro tem mensagem própria.

type SignIn = () => Promise<{ error: string | null }>
const state = vi.hoisted(() => {
  const s: { passkeys: { id: string }[]; webauthn: boolean; mobile: boolean } = { passkeys: [{ id: 'pk1' }], webauthn: true, mobile: false }
  return s
})
const signIn = vi.hoisted(() => vi.fn<SignIn>())
const list = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: state.passkeys, error: null })))

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ signInWithPasskey: signIn }) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { passkey: { list } } } }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('../lib/mfa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/mfa')>(),
  supportsPasskeys: () => state.webauthn,
  hasCoarsePointer: () => false,
}))

// A passkey fica atrás de VITE_MFA_PASSKEY (ligada depois de configurar o Supabase).
const flags = vi.hoisted(() => ({ passkey: true }))
vi.mock('../lib/env', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/env')>(),
  get MFA_PASSKEY_ENABLED() { return flags.passkey },
}))

import { MfaPasskeyOption } from './MfaPasskeyOption'

const t = (key: string, vars?: Record<string, string | number>) => (vars ? [key, ...Object.values(vars)].join(' ') : key)

beforeEach(() => {
  state.passkeys = [{ id: 'pk1' }]
  state.webauthn = true
  state.mobile = false
  flags.passkey = true
  signIn.mockReset()
  signIn.mockResolvedValue({ error: null })
  list.mockClear()
})

describe('MfaPasskeyOption', () => {
  it('não aparece para a conta sem passkey', async () => {
    state.passkeys = []
    const { container } = render(<MfaPasskeyOption t={t} />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    expect(container.innerHTML).toBe('')
  })

  it('não aparece (nem consulta) com VITE_MFA_PASSKEY desligada', () => {
    flags.passkey = false
    const { container } = render(<MfaPasskeyOption t={t} />)
    expect(container.innerHTML).toBe('')
    expect(list).not.toHaveBeenCalled()
  })

  it('não aparece (nem consulta) em navegador sem WebAuthn', () => {
    state.webauthn = false
    const { container } = render(<MfaPasskeyOption t={t} />)
    expect(container.innerHTML).toBe('')
    expect(list).not.toHaveBeenCalled()
  })

  it('no computador, entra pelo QR do celular e espera a confirmação', async () => {
    let finish: (value: { error: string | null }) => void = () => {}
    signIn.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)

    const button = await screen.findByRole('button', { name: 'mfa_passkey_signin' })
    expect(screen.getByText('mfa_passkey_or')).toBeTruthy()
    const hint = screen.getByText('mfa_passkey_signin_hint')
    expect(button.getAttribute('aria-describedby')).toBe(hint.id)

    await user.click(button)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(button.textContent).toBe('mfa_passkey_waiting')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // Clicar de novo enquanto espera não abre outra passkey.
    await user.click(button)
    expect(signIn).toHaveBeenCalledTimes(1)

    finish({ error: null })
    expect(await screen.findByRole('button', { name: 'mfa_passkey_signin' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('no celular, entra com a biometria do aparelho', async () => {
    state.mobile = true
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)
    await user.click(await screen.findByRole('button', { name: 'mfa_passkey_signin_mobile' }))
    expect(screen.getByText('mfa_passkey_signin_hint_mobile')).toBeTruthy()
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it.each<[PasskeyErrorKind, string]>([
    ['cancelled', 'mfa_passkey_cancelled'],
    ['exists', 'mfa_passkey_exists'],
    ['wrong_domain', 'mfa_passkey_wrong_domain'],
    ['unavailable', 'mfa_passkey_unavailable'],
    ['not_found', 'mfa_passkey_not_found'],
    ['failed', 'mfa_passkey_failed'],
  ])('erro %s tem mensagem própria', async (kind, message) => {
    signIn.mockResolvedValue({ error: kind })
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)
    await user.click(await screen.findByRole('button', { name: 'mfa_passkey_signin' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })

  it('erro desconhecido mostra a mensagem do servidor', async () => {
    signIn.mockResolvedValue({ error: 'Failed to fetch' })
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)
    await user.click(await screen.findByRole('button', { name: 'mfa_passkey_signin' }))
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_error Failed to fetch')
  })

  it('sem violações de acessibilidade, com o erro na tela', async () => {
    signIn.mockResolvedValue({ error: 'cancelled' })
    const user = userEvent.setup()
    const { container } = render(<MfaPasskeyOption t={t} />)
    await user.click(await screen.findByRole('button', { name: 'mfa_passkey_signin' }))
    await screen.findByRole('alert')
    await expectNoAxeViolations(container)
  })
})

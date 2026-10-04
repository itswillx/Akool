// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '../test/rtl'
import { expectNoAxeViolations } from '../test/axe'
import type { PasskeyDevice, PasskeyErrorKind } from '../lib/mfa'

// Tela do código do MFA: "Entrar com o celular" só aparece para quem tem
// passkey e navegador compatível; no computador fala do QR, no celular da
// biometria; cada erro tem mensagem própria.

type Verify = (device: PasskeyDevice) => Promise<{ error: string | null }>
const state = vi.hoisted(() => ({ hasPasskey: true, webauthn: true, mobile: false, verify: null as unknown as ReturnType<typeof vi.fn<Verify>> }))
state.verify = vi.fn<Verify>()

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ hasPasskey: state.hasPasskey, verifyMfaPasskey: state.verify }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => state.mobile }))
vi.mock('../lib/mfa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/mfa')>(),
  supportsPasskeys: () => state.webauthn,
  hasCoarsePointer: () => false,
}))

import { MfaPasskeyOption } from './MfaPasskeyOption'

const t = (key: string, vars?: Record<string, string | number>) => (vars ? [key, ...Object.values(vars)].join(' ') : key)

beforeEach(() => {
  state.hasPasskey = true
  state.webauthn = true
  state.mobile = false
  state.verify.mockReset()
  state.verify.mockResolvedValue({ error: null })
})

describe('MfaPasskeyOption', () => {
  it('não aparece para quem não tem passkey', () => {
    state.hasPasskey = false
    const { container } = render(<MfaPasskeyOption t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('não aparece em navegador sem WebAuthn', () => {
    state.webauthn = false
    const { container } = render(<MfaPasskeyOption t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('no computador, entra pelo QR do celular e espera a confirmação', async () => {
    let finish: (value: { error: string | null }) => void = () => {}
    state.verify.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)

    const button = screen.getByRole('button', { name: 'mfa_passkey_signin' })
    expect(screen.getByText('mfa_passkey_or')).toBeTruthy()
    const hint = screen.getByText('mfa_passkey_signin_hint')
    expect(button.getAttribute('aria-describedby')).toBe(hint.id)

    await user.click(button)
    expect(state.verify).toHaveBeenCalledWith('phone')
    expect(button.textContent).toBe('mfa_passkey_waiting')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    // Clicar de novo enquanto espera não abre outra passkey.
    await user.click(button)
    expect(state.verify).toHaveBeenCalledTimes(1)

    finish({ error: null })
    expect(await screen.findByRole('button', { name: 'mfa_passkey_signin' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('no celular, entra com a biometria do aparelho', async () => {
    state.mobile = true
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)
    expect(screen.getByText('mfa_passkey_signin_hint_mobile')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'mfa_passkey_signin_mobile' }))
    expect(state.verify).toHaveBeenCalledWith('this')
  })

  it.each<[PasskeyErrorKind, string]>([
    ['cancelled', 'mfa_passkey_cancelled'],
    ['exists', 'mfa_passkey_exists'],
    ['wrong_domain', 'mfa_passkey_wrong_domain'],
    ['unavailable', 'mfa_passkey_unavailable'],
    ['failed', 'mfa_passkey_failed'],
  ])('erro %s tem mensagem própria', async (kind, message) => {
    state.verify.mockResolvedValue({ error: kind })
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)
    await user.click(screen.getByRole('button', { name: 'mfa_passkey_signin' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })

  it('erro desconhecido mostra a mensagem do servidor', async () => {
    state.verify.mockResolvedValue({ error: 'Failed to fetch' })
    const user = userEvent.setup()
    render(<MfaPasskeyOption t={t} />)
    await user.click(screen.getByRole('button', { name: 'mfa_passkey_signin' }))
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_error Failed to fetch')
  })

  it('sem violações de acessibilidade, com o erro na tela', async () => {
    state.verify.mockResolvedValue({ error: 'cancelled' })
    const user = userEvent.setup()
    const { container } = render(<MfaPasskeyOption t={t} />)
    await user.click(screen.getByRole('button', { name: 'mfa_passkey_signin' }))
    await screen.findByRole('alert')
    await expectNoAxeViolations(container)
  })
})

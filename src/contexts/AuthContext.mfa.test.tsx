// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { render, screen, userEvent } from '../test/rtl'

// MFA no login: o código vale para qualquer app autenticador cadastrado, e a
// passkey de login ("Entrar com o celular") abre uma sessão que dispensa o código.

type Listener = (event: string, session: unknown) => void
type Factor = { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' }

const auth = vi.hoisted(() => {
  const state: { session: unknown; listener: Listener | null } = { session: null, listener: null }
  return state
})
const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(() => Promise.resolve({ data: { all: [], totp: [{ id: 'f1' }, { id: 'f2' }], phone: [], webauthn: [] }, error: null })),
  challengeAndVerify: vi.fn(({ factorId }: { factorId: string; code: string }) => Promise.resolve(factorId === 'f2'
    ? { data: {}, error: null }
    : { data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } })),
}))
const passkeySignIn = vi.hoisted(() => vi.fn<() => Promise<{ data: unknown; error: unknown }>>())
const passwordSignIn = vi.hoisted(() => vi.fn<() => Promise<{ data: unknown; error: unknown }>>())
vi.mock('../lib/supabase', () => ({
  recoveryLinkDetected: false,
  createEphemeralAuthClient: () => ({}),
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: auth.session } }),
      onAuthStateChange: (cb: Listener) => {
        auth.listener = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithPassword: passwordSignIn,
      signInWithPasskey: passkeySignIn,
      mfa,
    },
    rpc: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }),
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  },
}))

import { AuthProvider, useAuth } from './AuthContext'

/** JWT montado na hora (o gitleaks não vê token fixo no código). */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.assinatura`
}

function session(aal: 'aal1' | 'aal2', factors: Factor[], amr?: { method: string }[]) {
  return { access_token: jwt({ sub: 'u1', aal, ...(amr ? { amr } : {}) }), user: { id: 'u1', email: 'ana@exemplo.com', factors } }
}

const TOTP: Factor = { id: 't1', factor_type: 'totp', status: 'verified' }

function Probe() {
  const { signIn, verifyMfa, signInWithPasskey, mfaPending } = useAuth()
  const [result, setResult] = useState('')
  return (
    <div>
      <span>{`pendente: ${String(mfaPending)}`}</span>
      <button type="button" onClick={() => { void signIn('ana@exemplo.com', 'senha-forte').then(r => setResult(`senha: ${String(r.error)}`)) }}>senha</button>
      <button type="button" onClick={() => { void verifyMfa(' 123456 ').then(r => setResult(`totp: ${String(r.error)}`)) }}>totp</button>
      <button type="button" onClick={() => { void signInWithPasskey().then(r => setResult(`passkey: ${String(r.error)}`)) }}>celular</button>
      <span>{result}</span>
    </div>
  )
}

async function setup(initial: unknown) {
  auth.session = initial
  const user = userEvent.setup()
  render(<AuthProvider><Probe /></AuthProvider>)
  await act(async () => { await Promise.resolve() })
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.session = null
  auth.listener = null
})

describe('AuthProvider: verifyMfa com dois aparelhos', () => {
  it('aceita o código do 2º aparelho depois de o 1º recusar', async () => {
    const user = await setup(null)
    await user.click(screen.getByRole('button', { name: 'totp' }))
    expect(await screen.findByText('totp: null')).toBeTruthy()
    expect(mfa.challengeAndVerify.mock.calls.map(([args]) => args)).toEqual([
      { factorId: 'f1', code: '123456' },
      { factorId: 'f2', code: '123456' },
    ])
  })
})

describe('AuthProvider: entrar com a passkey de login', () => {
  it('e-mail e senha abrem a tela do código, e o celular entra sem ele', async () => {
    // Como no supabase-js, o SIGNED_IN da senha chega antes de a promessa resolver.
    passwordSignIn.mockImplementation(() => {
      auth.listener?.('SIGNED_IN', session('aal1', [TOTP]))
      return Promise.resolve({ data: { user: { id: 'u1' }, session: null }, error: null })
    })
    passkeySignIn.mockResolvedValue({ data: { session: session('aal1', [TOTP], [{ method: 'passkey' }]), user: null }, error: null })
    const user = await setup(null)
    expect(screen.getByText('pendente: false')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'senha' }))
    expect(await screen.findByText('senha: null')).toBeTruthy()
    expect(screen.getByText('pendente: true')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'celular' }))
    expect(await screen.findByText('passkey: null')).toBeTruthy()
    expect(screen.getByText('pendente: false')).toBeTruthy()
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled()
  })

  it('na tela do código, a sessão aberta com passkey libera o app sem o código', async () => {
    passkeySignIn.mockResolvedValue({ data: { session: session('aal1', [TOTP], [{ method: 'passkey' }]), user: null }, error: null })
    const user = await setup(session('aal1', [TOTP]))
    expect(await screen.findByText('pendente: true')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'celular' }))
    expect(await screen.findByText('passkey: null')).toBeTruthy()
    expect(screen.getByText('pendente: false')).toBeTruthy()
    expect(passkeySignIn).toHaveBeenCalledTimes(1)
  })

  it('o SIGNED_IN da sessão por passkey também tira a tela do código', async () => {
    await setup(session('aal1', [TOTP]))
    expect(await screen.findByText('pendente: true')).toBeTruthy()
    await act(async () => { auth.listener?.('SIGNED_IN', session('aal1', [TOTP], [{ method: 'passkey' }])) })
    expect(screen.getByText('pendente: false')).toBeTruthy()
  })

  it('cancelar a passkey volta como "cancelled" e a tela do código continua', async () => {
    const notAllowed = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
    passkeySignIn.mockResolvedValue({ data: null, error: Object.assign(new Error(notAllowed.message), { name: 'NotAllowedError', code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: notAllowed }) })
    const user = await setup(session('aal1', [TOTP]))
    await user.click(await screen.findByRole('button', { name: 'celular' }))
    expect(await screen.findByText('passkey: cancelled')).toBeTruthy()
    expect(screen.getByText('pendente: true')).toBeTruthy()
  })

  it('passkey que não é do Akool volta como "not_found"', async () => {
    passkeySignIn.mockResolvedValue({ data: null, error: { code: 'webauthn_credential_not_found', message: 'Credential not found' } })
    const user = await setup(session('aal1', [TOTP]))
    await user.click(await screen.findByRole('button', { name: 'celular' }))
    expect(await screen.findByText('passkey: not_found')).toBeTruthy()
  })
})

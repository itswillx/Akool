// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { render, screen, userEvent } from '../test/rtl'

// MFA no login: o código vale para qualquer app autenticador cadastrado, e a
// passkey ("Entrar com o celular") sobe a sessão sem ida extra à rede.

type Listener = (event: string, session: unknown) => void
type Factor = { id: string; factor_type: 'totp' | 'webauthn'; status: 'verified' | 'unverified' }

const auth = vi.hoisted(() => {
  const state: { session: unknown; listener: Listener | null } = { session: null, listener: null }
  return state
})
const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(() => Promise.resolve({ data: { all: [], totp: [{ id: 'f1' }, { id: 'f2' }], phone: [], webauthn: [] }, error: null })),
  challengeAndVerify: vi.fn(({ factorId }: { factorId: string; code: string }) => Promise.resolve(factorId === 'f2'
    ? { data: {}, error: null }
    : { data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } })),
  webauthn: { authenticate: vi.fn<(params: { factorId: string }, overrides?: unknown) => Promise<{ data: unknown; error: unknown }>>() },
}))
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
      mfa,
    },
    rpc: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }),
  },
}))

import { AuthProvider, useAuth } from './AuthContext'

/** JWT montado na hora (o gitleaks não vê token fixo no código). */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.assinatura`
}

function session(aal: 'aal1' | 'aal2', factors: Factor[]) {
  return { access_token: jwt({ sub: 'u1', aal }), user: { id: 'u1', email: 'ana@exemplo.com', factors } }
}

const TOTP: Factor = { id: 't1', factor_type: 'totp', status: 'verified' }
const PASSKEY: Factor = { id: 'pk1', factor_type: 'webauthn', status: 'verified' }

function Probe() {
  const { verifyMfa, verifyMfaPasskey, hasPasskey, mfaPending } = useAuth()
  const [result, setResult] = useState('')
  return (
    <div>
      <span>{`passkey: ${String(hasPasskey)}`}</span>
      <span>{`pendente: ${String(mfaPending)}`}</span>
      <button type="button" onClick={() => { void verifyMfa(' 123456 ').then(r => setResult(`totp: ${String(r.error)}`)) }}>totp</button>
      <button type="button" onClick={() => { void verifyMfaPasskey('phone').then(r => setResult(`resultado: ${String(r.error)}`)) }}>celular</button>
      <button type="button" onClick={() => { void verifyMfaPasskey('this').then(r => setResult(`resultado: ${String(r.error)}`)) }}>aparelho</button>
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

describe('AuthProvider: entrar com a passkey', () => {
  it('sem passkey, não oferece e não tenta', async () => {
    const user = await setup(session('aal1', [TOTP]))
    expect(await screen.findByText('passkey: false')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'celular' }))
    expect(await screen.findByText('resultado: no_factor')).toBeTruthy()
    expect(mfa.webauthn.authenticate).not.toHaveBeenCalled()
  })

  it('no computador, pede o QR do celular sem listFactors antes e libera o app', async () => {
    mfa.webauthn.authenticate.mockImplementation(() => {
      auth.session = session('aal2', [TOTP, PASSKEY])
      return Promise.resolve({ data: {}, error: null })
    })
    const user = await setup(session('aal1', [TOTP, PASSKEY]))
    expect(await screen.findByText('passkey: true')).toBeTruthy()
    expect(screen.getByText('pendente: true')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'celular' }))
    expect(await screen.findByText('resultado: null')).toBeTruthy()
    expect(screen.getByText('pendente: false')).toBeTruthy()
    expect(mfa.webauthn.authenticate).toHaveBeenCalledWith({ factorId: 'pk1' }, { hints: ['hybrid'], userVerification: 'required' })
    expect(mfa.listFactors).not.toHaveBeenCalled()
  })

  it('no próprio celular, usa a passkey do aparelho', async () => {
    mfa.webauthn.authenticate.mockResolvedValue({ data: {}, error: null })
    const user = await setup(session('aal1', [TOTP, PASSKEY]))
    await user.click(await screen.findByRole('button', { name: 'aparelho' }))
    await screen.findByText(/^resultado:/)
    expect(mfa.webauthn.authenticate).toHaveBeenCalledWith({ factorId: 'pk1' }, { hints: ['client-device'], userVerification: 'required' })
  })

  it('cancelar a passkey volta como "cancelled" e a tela do código continua', async () => {
    const notAllowed = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
    mfa.webauthn.authenticate.mockResolvedValue({ data: null, error: Object.assign(new Error(notAllowed.message), { name: 'NotAllowedError', code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: notAllowed }) })
    const user = await setup(session('aal1', [TOTP, PASSKEY]))
    await user.click(await screen.findByRole('button', { name: 'celular' }))
    expect(await screen.findByText('resultado: cancelled')).toBeTruthy()
    expect(screen.getByText('pendente: true')).toBeTruthy()
  })

  it('os fatores vêm da sessão de cada evento, não do usuário guardado no login', async () => {
    await setup(session('aal2', [TOTP]))
    expect(await screen.findByText('passkey: false')).toBeTruthy()
    await act(async () => { auth.listener?.('TOKEN_REFRESHED', session('aal2', [TOTP, PASSKEY])) })
    expect(screen.getByText('passkey: true')).toBeTruthy()
  })
})

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, userEvent } from '../test/rtl'

// MFA com mais de um aparelho: o código do login vale para qualquer fator
// verificado, não só para o primeiro da lista.

const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(() => Promise.resolve({ data: { all: [], totp: [{ id: 'f1' }, { id: 'f2' }], phone: [], webauthn: [] }, error: null })),
  challengeAndVerify: vi.fn(({ factorId }: { factorId: string; code: string }) => Promise.resolve(factorId === 'f2'
    ? { data: {}, error: null }
    : { data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } })),
}))
vi.mock('../lib/supabase', () => ({
  recoveryLinkDetected: false,
  createEphemeralAuthClient: () => ({}),
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      mfa,
    },
  },
}))

import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const { verifyMfa } = useAuth()
  const [result, setResult] = useState('')
  return (
    <button type="button" onClick={() => { void verifyMfa(' 123456 ').then(r => setResult(`erro: ${String(r.error)}`)) }}>
      {result || 'verificar'}
    </button>
  )
}

describe('AuthProvider: verifyMfa com dois aparelhos', () => {
  it('aceita o código do 2º aparelho depois de o 1º recusar', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><Probe /></AuthProvider>)
    await user.click(await screen.findByRole('button', { name: 'verificar' }))
    expect(await screen.findByRole('button', { name: 'erro: null' })).toBeTruthy()
    expect(mfa.challengeAndVerify.mock.calls.map(([args]) => args)).toEqual([
      { factorId: 'f1', code: '123456' },
      { factorId: 'f2', code: '123456' },
    ])
  })
})

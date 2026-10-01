// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { render } from '../test/rtl'

// SEC-017: todo SIGNED_OUT (botão, outra aba, sessão revogada) limpa o
// navegador; outros eventos, não.

const auth = vi.hoisted(() => ({ listener: null as ((event: string, session: unknown) => void) | null }))
vi.mock('../lib/supabase', () => ({
  recoveryLinkDetected: false,
  createEphemeralAuthClient: () => ({}),
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        auth.listener = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}))
const clearLocalUserData = vi.fn<() => void>()
vi.mock('../lib/localData', () => ({ clearLocalUserData: () => clearLocalUserData() }))

import { AuthProvider } from './AuthContext'

describe('AuthProvider: logout limpa o navegador', () => {
  it('SIGNED_OUT chama a limpeza; TOKEN_REFRESHED, não', async () => {
    render(<AuthProvider><span /></AuthProvider>)
    await act(async () => { await Promise.resolve() })
    expect(auth.listener).not.toBeNull()

    await act(async () => { auth.listener?.('TOKEN_REFRESHED', null) })
    expect(clearLocalUserData).not.toHaveBeenCalled()

    await act(async () => { auth.listener?.('SIGNED_OUT', null) })
    expect(clearLocalUserData).toHaveBeenCalledTimes(1)
  })
})

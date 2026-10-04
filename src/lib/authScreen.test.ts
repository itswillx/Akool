import { describe, expect, it } from 'vitest'
import { authScreen } from './authScreen'

const base = { loading: false, recoveryMode: false, signedIn: false, mfaPending: false }

describe('authScreen', () => {
  it.each([
    [{ loading: true }, 'boot'],
    [{}, 'signin'],
    [{ signedIn: true }, 'app'],
    [{ signedIn: true, mfaPending: true }, 'mfa'],
    [{ recoveryMode: true }, 'reset'],
    [{ recoveryMode: true, signedIn: true }, 'reset'],
    // Conta com MFA vinda do link de recuperação: o código antes da senha nova
    // (em AAL1 o Supabase recusa a troca de senha).
    [{ recoveryMode: true, signedIn: true, mfaPending: true }, 'mfa'],
  ] as const)('%o → %s', (state, screen) => {
    expect(authScreen({ ...base, ...state })).toBe(screen)
  })
})

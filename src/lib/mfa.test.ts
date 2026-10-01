import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { assuranceFromSession, isTotpCode, needsMfaChallenge } from './mfa'

function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.assinatura`
}

function session(aal: string, factors: { status: string }[] = []): Pick<Session, 'access_token' | 'user'> {
  return { access_token: jwt({ sub: 'u1', aal }), user: { id: 'u1', factors } as unknown as Session['user'] }
}

describe('MFA: nível de autenticação (SEC-004)', () => {
  it('sem sessão não pede código', () => {
    expect(assuranceFromSession(null)).toBeNull()
    expect(needsMfaChallenge(null)).toBe(false)
  })

  it('sem fator verificado, AAL1 é o máximo e o app abre direto', () => {
    const a = assuranceFromSession(session('aal1', [{ status: 'unverified' }]))
    expect(a).toEqual({ currentLevel: 'aal1', nextLevel: 'aal1' })
    expect(needsMfaChallenge(a)).toBe(false)
  })

  it('com fator verificado e sessão AAL1, pede o código', () => {
    const a = assuranceFromSession(session('aal1', [{ status: 'verified' }]))
    expect(a).toEqual({ currentLevel: 'aal1', nextLevel: 'aal2' })
    expect(needsMfaChallenge(a)).toBe(true)
  })

  it('depois do código (AAL2), não pede de novo', () => {
    expect(needsMfaChallenge(assuranceFromSession(session('aal2', [{ status: 'verified' }])))).toBe(false)
  })

  it('JWT ilegível não trava o app nem inventa nível', () => {
    const a = assuranceFromSession({ access_token: 'nao-e-jwt', user: { id: 'u1', factors: [] } as unknown as Session['user'] })
    expect(a).toEqual({ currentLevel: null, nextLevel: null })
    expect(needsMfaChallenge(a)).toBe(false)
  })

  it('aceita só códigos TOTP de 6 dígitos', () => {
    expect(isTotpCode('123456')).toBe(true)
    expect(isTotpCode(' 123456 ')).toBe(true)
    expect(isTotpCode('12345')).toBe(false)
    expect(isTotpCode('12a456')).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import {
  assuranceFromSession, formatTotpSecret, isInvalidTotpError, isOtpauthUri, isTotpCode, needsMfaChallenge,
  totpFriendlyName, verifyWithAnyFactor,
} from './mfa'

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

describe('MFA: cadastro de um aparelho', () => {
  it('mostra a chave em grupos de 4, sem perder caracteres', () => {
    expect(formatTotpSecret('AAAABBBBCCCCDDDD')).toBe('AAAA BBBB CCCC DDDD')
    expect(formatTotpSecret('AAAABBBBCC')).toBe('AAAA BBBB CC')
    expect(formatTotpSecret('AAAA BBBB\nCC')).toBe('AAAA BBBB CC')
    expect(formatTotpSecret('')).toBe('')
  })

  it('só aceita URI de cadastro TOTP no QR e no link', () => {
    expect(isOtpauthUri('otpauth://totp/Akool:ana@exemplo.com?secret=AAAA&issuer=Akool')).toBe(true)
    expect(isOtpauthUri('OTPAUTH://TOTP/Akool:ana')).toBe(true)
    expect(isOtpauthUri('')).toBe(false)
    expect(isOtpauthUri('otpauth://hotp/Akool:ana?secret=AAAA')).toBe(false)
    expect(isOtpauthUri('javascript:alert(1)//otpauth://totp/')).toBe(false)
    expect(isOtpauthUri('https://exemplo.com/otpauth://totp/')).toBe(false)
  })

  it('nomeia o fator com data e hora até os segundos (nome único no Supabase)', () => {
    expect(totpFriendlyName(new Date('2026-10-04T17:01:32.123Z'))).toBe('Akool 2026-10-04 17:01:32')
    expect(totpFriendlyName(new Date('2026-10-04T17:01:33Z'))).not.toBe(totpFriendlyName(new Date('2026-10-04T17:01:32Z')))
  })

  it('separa código recusado de outros erros', () => {
    expect(isInvalidTotpError({ code: 'mfa_verification_failed', message: 'x' })).toBe(true)
    expect(isInvalidTotpError({ message: 'Invalid TOTP code entered' })).toBe(true)
    expect(isInvalidTotpError({ message: 'Challenge expired' })).toBe(true)
    expect(isInvalidTotpError({ code: 'over_request_rate_limit', message: 'Too many requests' })).toBe(false)
  })
})

describe('MFA: login com mais de um aparelho', () => {
  const invalid = { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }

  it('sem fator verificado, não tenta nada', async () => {
    const verify = vi.fn()
    expect(await verifyWithAnyFactor([], verify)).toEqual({ error: 'no_factor' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('para no primeiro aparelho que aceita o código', async () => {
    const verify = vi.fn(() => Promise.resolve({ error: null }))
    expect(await verifyWithAnyFactor(['a', 'b'], verify)).toEqual({ error: null })
    expect(verify.mock.calls).toEqual([['a']])
  })

  it('código do 2º aparelho: o 1º recusa e o 2º aceita', async () => {
    const verify = vi.fn((id: string) => Promise.resolve({ error: id === 'a' ? invalid : null }))
    expect(await verifyWithAnyFactor(['a', 'b'], verify)).toEqual({ error: null })
    expect(verify.mock.calls).toEqual([['a'], ['b']])
  })

  it('todos recusam: código inválido', async () => {
    const verify = vi.fn(() => Promise.resolve({ error: invalid }))
    expect(await verifyWithAnyFactor(['a', 'b'], verify)).toEqual({ error: 'invalid_code' })
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('erro que não é de código volta na hora, sem gastar tentativa no 2º', async () => {
    const verify = vi.fn(() => Promise.resolve({ error: { message: 'Failed to fetch' } }))
    expect(await verifyWithAnyFactor(['a', 'b'], verify)).toEqual({ error: 'Failed to fetch' })
    expect(verify.mock.calls).toEqual([['a']])
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import {
  assuranceFromSession, formatTotpSecret, isInvalidTotpError, isOtpauthUri, isPasskeyErrorKind, isTotpCode, needsMfaChallenge,
  PASSKEY_ERROR_KEYS, passkeyDevice, passkeyErrorKind, supportsPasskeys, totpFriendlyName, verifyWithAnyFactor,
} from './mfa'

function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.assinatura`
}

function session(aal: string, factors: { status: string }[] = [], amr?: unknown): Pick<Session, 'access_token' | 'user'> {
  return { access_token: jwt({ sub: 'u1', aal, ...(amr === undefined ? {} : { amr }) }), user: { id: 'u1', factors } as unknown as Session['user'] }
}

describe('MFA: nível de autenticação (SEC-004)', () => {
  it('sem sessão não pede código', () => {
    expect(assuranceFromSession(null)).toBeNull()
    expect(needsMfaChallenge(null)).toBe(false)
  })

  it('sem fator verificado, AAL1 é o máximo e o app abre direto', () => {
    const a = assuranceFromSession(session('aal1', [{ status: 'unverified' }]))
    expect(a).toEqual({ currentLevel: 'aal1', nextLevel: 'aal1', passkey: false })
    expect(needsMfaChallenge(a)).toBe(false)
  })

  it('com fator verificado e sessão AAL1, pede o código', () => {
    const a = assuranceFromSession(session('aal1', [{ status: 'verified' }]))
    expect(a).toEqual({ currentLevel: 'aal1', nextLevel: 'aal2', passkey: false })
    expect(needsMfaChallenge(a)).toBe(true)
  })

  it('depois do código (AAL2), não pede de novo', () => {
    expect(needsMfaChallenge(assuranceFromSession(session('aal2', [{ status: 'verified' }])))).toBe(false)
  })

  it('JWT ilegível não trava o app nem inventa nível', () => {
    const a = assuranceFromSession({ access_token: 'nao-e-jwt', user: { id: 'u1', factors: [] } as unknown as Session['user'] })
    expect(a).toEqual({ currentLevel: null, nextLevel: null, passkey: false })
    expect(needsMfaChallenge(a)).toBe(false)
  })

  it('sessão aberta com passkey de login dispensa o código (o GoTrue a deixa em AAL1)', () => {
    const a = assuranceFromSession(session('aal1', [{ status: 'verified' }], [{ method: 'passkey', timestamp: 1 }]))
    expect(a).toEqual({ currentLevel: 'aal1', nextLevel: 'aal2', passkey: true })
    expect(needsMfaChallenge(a)).toBe(false)
  })

  it('só o método passkey no amr conta como passkey', () => {
    expect(assuranceFromSession(session('aal1', [{ status: 'verified' }], [{ method: 'password' }]))?.passkey).toBe(false)
    expect(assuranceFromSession(session('aal1', [{ status: 'verified' }], 'passkey'))?.passkey).toBe(false)
    expect(assuranceFromSession(session('aal1', [{ status: 'verified' }], [null, { method: 'otp' }]))?.passkey).toBe(false)
    expect(needsMfaChallenge(assuranceFromSession(session('aal1', [{ status: 'verified' }], [{ method: 'password' }])))).toBe(true)
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

describe('MFA: passkey de login (entrar com o celular)', () => {
  it('celular e tablet usam a passkey do próprio aparelho; o computador, a do celular via QR', () => {
    expect(passkeyDevice(true, false)).toBe('this')
    expect(passkeyDevice(false, true)).toBe('this')
    expect(passkeyDevice(false, false)).toBe('phone')
  })

  it('só oferece passkey com a API WebAuthn do navegador', () => {
    const credentials = { create: () => null, get: () => null }
    expect(supportsPasskeys({ PublicKeyCredential: class {}, navigator: { credentials } as unknown as Navigator })).toBe(true)
    expect(supportsPasskeys({ navigator: { credentials } as unknown as Navigator })).toBe(false)
    expect(supportsPasskeys({ PublicKeyCredential: class {}, navigator: { credentials: null } as unknown as Navigator })).toBe(false)
    expect(supportsPasskeys(undefined)).toBe(false)
  })

  it('traduz os erros do navegador e do Supabase em poucos casos', () => {
    const domError = (name: string) => Object.assign(new Error('x'), { name })
    // Cancelar: o auth-js copia o nome do DOMException e guarda o original em cause.
    expect(passkeyErrorKind(Object.assign(new Error('x'), { name: 'NotAllowedError', code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: domError('NotAllowedError') }))).toBe('cancelled')
    expect(passkeyErrorKind({ code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', message: 'x', cause: domError('NotAllowedError') })).toBe('cancelled')
    expect(passkeyErrorKind({ code: 'ERROR_CEREMONY_ABORTED', message: 'x' })).toBe('cancelled')
    expect(passkeyErrorKind({ code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'x' })).toBe('exists')
    expect(passkeyErrorKind({ code: 'webauthn_credential_exists', message: 'x' })).toBe('exists')
    expect(passkeyErrorKind({ code: 'ERROR_INVALID_RP_ID', message: 'x' })).toBe('wrong_domain')
    expect(passkeyErrorKind(domError('SecurityError'))).toBe('wrong_domain')
    expect(passkeyErrorKind({ code: 'passkey_disabled', message: 'Passkey authentication is disabled' })).toBe('unavailable')
    expect(passkeyErrorKind({ message: 'Browser does not support WebAuthn' })).toBe('unavailable')
    expect(passkeyErrorKind({ message: 'Passkey support is experimental; enable it in the client' })).toBe('unavailable')
    expect(passkeyErrorKind({ code: 'webauthn_credential_not_found', message: 'x' })).toBe('not_found')
    expect(passkeyErrorKind({ code: 'webauthn_challenge_expired', message: 'x' })).toBe('failed')
    expect(passkeyErrorKind({ code: 'webauthn_verification_failed', message: 'x' })).toBe('failed')
    expect(passkeyErrorKind({ message: 'Failed to validate WebAuthn response' })).toBe('failed')
    expect(passkeyErrorKind({ code: 'insufficient_aal', message: 'AAL2 required' })).toBeNull()
    expect(passkeyErrorKind(null)).toBeNull()
  })

  it('cada tipo de erro tem mensagem', () => {
    expect(Object.keys(PASSKEY_ERROR_KEYS).sort()).toEqual(['cancelled', 'exists', 'failed', 'not_found', 'unavailable', 'wrong_domain'])
    expect(isPasskeyErrorKind('cancelled')).toBe(true)
    expect(isPasskeyErrorKind('Failed to fetch')).toBe(false)
    expect(isPasskeyErrorKind('toString')).toBe(false)
  })
})

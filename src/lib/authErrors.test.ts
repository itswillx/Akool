import { describe, expect, it } from 'vitest'
import { authErrorKey, isEmailCooldown } from './authErrors'

describe('authErrorKey', () => {
  it.each([
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'auth_err_invalid_credentials'],
    [{ code: 'email_not_confirmed', message: 'Email not confirmed' }, 'auth_err_email_not_confirmed'],
    [{ code: 'user_already_exists', message: 'User already registered' }, 'auth_err_user_exists'],
    [{ code: 'email_exists', message: 'x' }, 'auth_err_user_exists'],
    [{ code: 'over_request_rate_limit', message: 'x' }, 'auth_err_rate_limited'],
    [{ code: 'over_email_send_rate_limit', message: 'x' }, 'auth_err_rate_limited'],
    [{ code: 'weak_password', message: 'x' }, 'auth_password_weak'],
    [{ status: 429, message: 'whatever' }, 'auth_err_rate_limited'],
    [{ name: 'AuthRetryableFetchError', message: 'Service unavailable' }, 'auth_err_network'],
    [{ message: 'TypeError: Failed to fetch' }, 'auth_err_network'],
    // Sem `code` (GoTrue antigo e o reset, que só devolve a mensagem).
    ['Invalid login credentials', 'auth_err_invalid_credentials'],
    ['Email not confirmed', 'auth_err_email_not_confirmed'],
    ['For security purposes, you can only request this after 42 seconds.', 'auth_err_rate_limited'],
  ])('%j → %s', (error, key) => {
    expect(authErrorKey(error)).toBe(key)
  })

  it('erro desconhecido volta null (a tela mostra o texto cru)', () => {
    expect(authErrorKey({ message: 'Email ou senha incorretos.' })).toBeNull()
    expect(authErrorKey('algo inesperado')).toBeNull()
    expect(authErrorKey(null)).toBeNull()
    expect(authErrorKey(undefined)).toBeNull()
  })
})

describe('isEmailCooldown', () => {
  it.each([
    [{ code: 'over_email_send_rate_limit' }, true],
    ['For security purposes, you can only request this after 42 seconds.', true],
    [{ code: 'over_request_rate_limit', message: 'Request rate limit reached' }, false],
    ['Invalid login credentials', false],
    [null, false],
  ] as const)('%o → %s', (error, expected) => {
    expect(isEmailCooldown(error)).toBe(expected)
  })
})

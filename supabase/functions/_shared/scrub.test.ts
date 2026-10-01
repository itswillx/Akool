import { describe, expect, it } from 'vitest'
import { scrubDeep, scrubString } from './scrub.ts'

describe('scrubString', () => {
  it.each([
    ['falhou para ana.souza@exemplo.com.br', 'falhou para [email]'],
    ['Authorization: Bearer abcdefghijklmnop', 'Authorization: Bearer [token]'],
    ['token akool_pat_' + 'a'.repeat(64), 'token [token]'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ', 'jwt [jwt]'],
    ['chave sk-proj-ABCDEFGHIJKLMNOPQRST', 'chave [api-key]'],
    ['https://x.dev/cb?code=abc123&state=ok#access_token=xyz', 'https://x.dev/cb?code=[redacted]&state=ok#access_token=[redacted]'],
    ['CPF 123.456.789-09', 'CPF [cpf]'],
    ['cartão 4111 1111 1111 1111', 'cartão [number]'],
  ])('%j', (input, expected) => {
    expect(scrubString(input)).toBe(expected)
  })

  it('deixa texto comum em paz', () => {
    expect(scrubString('Failed to fetch dynamically imported module: /assets/a-1.js')).toBe('Failed to fetch dynamically imported module: /assets/a-1.js')
  })
})

describe('scrubDeep', () => {
  it('limpa strings em qualquer nível e esconde chaves sensíveis', () => {
    const out = scrubDeep({
      message: 'erro de a@b.com',
      extra: { password: 'hunter2', apiKey: 'x', note: 'ok', nested: [{ email: 'c@d.com' }] },
      request: { headers: { Authorization: 'Bearer abcdefghijklmnop' } },
      count: 3,
    })
    expect(out).toEqual({
      message: 'erro de [email]',
      extra: { password: '[redacted]', apiKey: '[redacted]', note: 'ok', nested: [{ email: '[email]' }] },
      request: { headers: { Authorization: '[redacted]' } },
      count: 3,
    })
  })

  it('não altera o original', () => {
    const original = { message: 'a@b.com' }
    scrubDeep(original)
    expect(original.message).toBe('a@b.com')
  })
})

import { describe, expect, it } from 'vitest'
import { sanitizeIlikeTerm } from './profileSearch'

describe('sanitizeIlikeTerm', () => {
  it('keeps normal name/email search text', () => {
    expect(sanitizeIlikeTerm('john')).toBe('john')
    expect(sanitizeIlikeTerm('  Maria Silva  ')).toBe('Maria Silva')
    expect(sanitizeIlikeTerm('a@b.com')).toBe('a@b.com')
    expect(sanitizeIlikeTerm('jean-luc.x')).toBe('jean-luc.x')
  })

  it('strips ilike wildcards and the OR-filter meta-characters', () => {
    expect(sanitizeIlikeTerm('%')).toBe('')
    expect(sanitizeIlikeTerm('_')).toBe('')
    expect(sanitizeIlikeTerm('a,b')).toBe('ab')
    expect(sanitizeIlikeTerm('a*b\\c:d"e')).toBe('abcde')
    // `_` is a single-character ilike wildcard just like `%` — must not survive.
    expect(sanitizeIlikeTerm('jean-luc_x')).toBe('jean-lucx')
  })

  it('neutralizes an OR-filter injection payload', () => {
    // Attempt to break out and add `id.eq.<x>` as a new OR condition.
    expect(sanitizeIlikeTerm('x%),id.eq.00000000-0000-0000-0000-000000000000,(')).toBe(
      'xid.eq.00000000-0000-0000-0000-000000000000',
    )
    // The result contains no `,` `(` `)` `%` so it stays a single ilike value.
    expect(/[%,()*\\:"]/.test(sanitizeIlikeTerm('x%),id.eq.1,('))).toBe(false)
  })
})

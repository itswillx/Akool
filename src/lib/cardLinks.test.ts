import { describe, expect, it } from 'vitest'
import { normalizeLinkUrl, linkDisplay } from './cardLinks'

describe('normalizeLinkUrl', () => {
  it('keeps a full https url', () => {
    expect(normalizeLinkUrl('https://example.com/x')).toBe('https://example.com/x')
  })
  it('prefixes https:// when the scheme is missing', () => {
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com/')
  })
  it('trims surrounding whitespace', () => {
    expect(normalizeLinkUrl('  https://a.com  ')).toBe('https://a.com/')
  })
  it('rejects empty input', () => {
    expect(normalizeLinkUrl('')).toBeNull()
    expect(normalizeLinkUrl('   ')).toBeNull()
  })
  it('rejects non-web schemes', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkUrl('mailto:a@b.com')).toBeNull()
    expect(normalizeLinkUrl('data:text/html,x')).toBeNull()
  })
})

describe('linkDisplay', () => {
  it('uses the title when set', () => {
    expect(linkDisplay({ url: 'https://example.com', title: 'Docs' })).toBe('Docs')
  })
  it('falls back to the hostname without www', () => {
    expect(linkDisplay({ url: 'https://www.example.com/path', title: '' })).toBe('example.com')
  })
  it('falls back to the raw url when it is not parseable', () => {
    expect(linkDisplay({ url: 'not a url', title: '' })).toBe('not a url')
  })
})

import { describe, expect, it } from 'vitest'
import { hasUrlScheme, safeHref, safeWebHref } from './safeHref'

describe('safeHref', () => {
  it('accepts http, https and mailto (any case), trimmed', () => {
    expect(safeHref('https://a.com/x?y=1')).toBe('https://a.com/x?y=1')
    expect(safeHref('HTTP://a.com')).toBe('HTTP://a.com')
    expect(safeHref('  mailto:a@b.com ')).toBe('mailto:a@b.com')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '\u0001javascript:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    '&#106;avascript:alert(1)',
    'src/a.ts',
    '//evil.example/x',
    'https:/a.com',
    '',
  ])('rejects %j', url => {
    expect(safeHref(url)).toBeNull()
  })
})

describe('safeWebHref', () => {
  it('accepts only http(s)', () => {
    expect(safeWebHref('https://a.com')).toBe('https://a.com')
    expect(safeWebHref('mailto:a@b.com')).toBeNull()
    expect(safeWebHref('javascript:alert(1)')).toBeNull()
    expect(safeWebHref('data:text/html,oi')).toBeNull()
  })
})

describe('hasUrlScheme', () => {
  it('sees schemes the way the browser does', () => {
    expect(hasUrlScheme('javascript:x')).toBe(true)
    expect(hasUrlScheme('\u0001java\tscript:x')).toBe(true)
    expect(hasUrlScheme('data:,x')).toBe(true)
    expect(hasUrlScheme('web+foo:x')).toBe(true)
  })

  it('treats paths and file:line references as relative', () => {
    expect(hasUrlScheme('src/a.ts')).toBe(false)
    expect(hasUrlScheme('src/a.ts:12')).toBe(false)
    expect(hasUrlScheme('ProjectsPanel.tsx:972')).toBe(false)
    expect(hasUrlScheme('#secao')).toBe(false)
    expect(hasUrlScheme('&#106;avascript:x')).toBe(false)
  })
})

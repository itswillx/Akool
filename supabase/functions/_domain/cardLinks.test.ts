import { describe, expect, it } from 'vitest'
import { linkDisplay, normalizeLinkUrl } from './cardLinks.ts'

// API-027: os casos que a API recebe e a tela raramente manda (o resto está em
// src/lib/cardLinks.test.ts, pelo reexport).

describe('normalizeLinkUrl: o que não é URL web vira null', () => {
  it('URL que o parser recusa', () => {
    expect(normalizeLinkUrl('https://')).toBeNull()
    expect(normalizeLinkUrl('http://exa mple.com')).toBeNull()
    expect(normalizeLinkUrl('https://[::1')).toBeNull()
  })

  it('outro esquema ou vazio', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkUrl('   ')).toBeNull()
  })
})

describe('linkDisplay', () => {
  it('URL inválida guardada aparece como está', () => {
    expect(linkDisplay({ url: 'nao é url', title: '  ' })).toBe('nao é url')
  })
})

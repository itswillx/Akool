import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getT, isLangLoaded, loadLang, subscribeLangs } from './translations'
import type { Lang } from './translations'
import { ptBR } from './translations.pt-BR'
import en from './translations.en'

describe('translations key parity', () => {
  it('pt-BR and en declare exactly the same keys', () => {
    const pt = Object.keys(ptBR).sort()
    const enKeys = Object.keys(en).sort()
    const missingInEn = pt.filter(k => !enKeys.includes(k))
    const missingInPt = enKeys.filter(k => !pt.includes(k))
    expect(missingInEn, `keys missing in en: ${missingInEn.join(', ')}`).toEqual([])
    expect(missingInPt, `keys missing in pt-BR: ${missingInPt.join(', ')}`).toEqual([])
  })
})

// PERF-009: o inglês não vem no boot; estes testes rodam antes de qualquer
// loadLang('en') do arquivo.
describe('loadLang', () => {
  it('answers in pt-BR until the English dictionary loads', () => {
    expect(isLangLoaded('en')).toBe(false)
    expect(getT('en')('app_loading')).toBe('Carregando...')
  })

  it('shares one download between simultaneous calls and notifies subscribers', async () => {
    const tBefore = getT('en')
    const onChange = vi.fn()
    const unsubscribe = subscribeLangs(onChange)
    const first = loadLang('en')
    expect(loadLang('en')).toBe(first)
    await first
    unsubscribe()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(isLangLoaded('en')).toBe(true)
    // Um t criado antes do download passa a responder em inglês.
    expect(tBefore('app_loading')).toBe('Loading...')
  })

  it('resolves right away for pt-BR and for languages without a dictionary', async () => {
    await expect(loadLang('pt-BR')).resolves.toBeUndefined()
    await expect(loadLang('fr' as Lang)).resolves.toBeUndefined()
    expect(isLangLoaded('fr' as Lang)).toBe(false)
  })
})

describe('getT', () => {
  beforeAll(() => loadLang('en'))

  it('returns Portuguese strings for pt-BR', () => {
    const t = getT('pt-BR')
    expect(t('app_loading')).toBe('Carregando...')
  })

  it('returns English strings for en', () => {
    const t = getT('en')
    expect(t('app_loading')).toBe('Loading...')
  })

  it('substitutes variables in translated strings', () => {
    const t = getT('pt-BR')
    expect(t('backup_failed', { error: 'timeout' })).toBe('Falha na operação: timeout')
  })

  it('substitutes variables in English strings', () => {
    const t = getT('en')
    expect(t('backup_failed', { error: 'network' })).toBe('Operation failed: network')
  })

  it('falls back to pt-BR when key is missing in en', () => {
    // All keys should exist in both; test fallback via unknown lang
    const tUnknown = getT('fr' as 'en')
    expect(tUnknown('app_loading')).toBe('Carregando...')
  })

  it('returns key name when translation is completely missing', () => {
    const t = getT('pt-BR')
    // @ts-expect-error testing unknown key fallback
    expect(t('nonexistent_key_xyz')).toBe('nonexistent_key_xyz')
  })
})

import { describe, expect, it } from 'vitest'
import { getT } from './translations'

describe('getT', () => {
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
    const t = getT('en')
    // app_loading exists in both; use a key that only exists in pt-BR if any
    // All keys should exist in both, so test fallback via unknown lang
    const tUnknown = getT('fr' as 'en')
    expect(tUnknown('app_loading')).toBe('Carregando...')
  })

  it('returns key name when translation is completely missing', () => {
    const t = getT('pt-BR')
    // @ts-expect-error testing unknown key fallback
    expect(t('nonexistent_key_xyz')).toBe('nonexistent_key_xyz')
  })
})

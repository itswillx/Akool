// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_KEYS } from './localKeys'
import { clearLocalUserData } from './localData'
import { isCategoryMuted, readNotificationPrefs, writeNotificationPrefs } from './notificationPrefs'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('notificationPrefs', () => {
  it('sem nada gravado, nenhuma categoria silenciada', () => {
    expect(readNotificationPrefs()).toEqual({ muted: [] })
    expect(isCategoryMuted('finance')).toBe(false)
  })

  it('grava e lê as categorias silenciadas, ignorando lixo', () => {
    writeNotificationPrefs({ muted: ['projects', 'system'] })
    expect(isCategoryMuted('projects')).toBe(true)
    expect(isCategoryMuted('pages')).toBe(false)
    localStorage.setItem(LOCAL_KEYS.notificationPrefs, JSON.stringify({ muted: ['pages', 'nada', 3] }))
    expect(readNotificationPrefs()).toEqual({ muted: ['pages'] })
    localStorage.setItem(LOCAL_KEYS.notificationPrefs, '{quebrado')
    expect(readNotificationPrefs()).toEqual({ muted: [] })
    localStorage.setItem(LOCAL_KEYS.notificationPrefs, JSON.stringify({ outra: 1 }))
    expect(readNotificationPrefs()).toEqual({ muted: [] })
  })

  it('é do aparelho: o logout (inclusive o do login diário) não apaga', () => {
    writeNotificationPrefs({ muted: ['finance'] })
    clearLocalUserData()
    expect(readNotificationPrefs()).toEqual({ muted: ['finance'] })
  })

  it('sem storage (modo privado restrito), não quebra', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => writeNotificationPrefs({ muted: ['finance'] })).not.toThrow()
  })
})

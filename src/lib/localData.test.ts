// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// SEC-017: depois do logout, nada do usuário fica no navegador.

const createSignedUrl = vi.fn((path: string, expiresIn: number) => Promise.resolve({ data: { signedUrl: `https://signed/${path}?e=${expiresIn}` }, error: null }))
const removeAllChannels = vi.fn(() => Promise.resolve([]))
vi.mock('./supabase', () => ({ supabase: { removeAllChannels, storage: { from: () => ({ createSignedUrl }) } } }))

const { KEEP_ON_SIGN_OUT, clearLocalUserData } = await import('./localData')
const { defaultExpiresIn, resolveSignedUrl } = await import('./storageUrl')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  createSignedUrl.mockClear()
  removeAllChannels.mockClear()
})

describe('clearLocalUserData', () => {
  it('apaga tudo do localStorage menos as exceções, e o sessionStorage inteiro', () => {
    for (const key of ['finance_active_tab', 'projects_card_draft:b1', 'excalinotion_expanded_pages', 'akool_onboarding_seen_u1', 'chave_que_ainda_nao_existe']) {
      localStorage.setItem(key, 'x')
    }
    for (const key of KEEP_ON_SIGN_OUT) localStorage.setItem(key, 'fica')
    sessionStorage.setItem('projects_card_modal_state', '{"cardId":"c1"}')

    clearLocalUserData()

    expect(Object.keys(localStorage).sort()).toEqual([...KEEP_ON_SIGN_OUT].sort())
    expect(sessionStorage.length).toBe(0)
    expect(removeAllChannels).toHaveBeenCalledTimes(1)
  })

  it('esquece as signed URLs em cache', async () => {
    await resolveSignedUrl('avatars', 'u1/a.png')
    await resolveSignedUrl('avatars', 'u1/a.png')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    clearLocalUserData()
    await resolveSignedUrl('avatars', 'u1/a.png')
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })
})

describe('validade das signed URLs', () => {
  it('arquivos financeiros valem 5 min; o resto, 1 h', async () => {
    expect(defaultExpiresIn('transaction-photos')).toBe(300)
    expect(defaultExpiresIn('store-files')).toBe(300)
    expect(defaultExpiresIn('avatars')).toBe(3600)
    await resolveSignedUrl('transaction-photos', 'u1/recibo.jpg')
    expect(createSignedUrl).toHaveBeenCalledWith('u1/recibo.jpg', 300)
  })
})

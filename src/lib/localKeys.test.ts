// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { KEEP_ON_SIGN_OUT, LOCAL_KEYS, SESSION_KEYS, legacyKeyTarget, localKey, migrateLocalKeys, sessionKey } from './localKeys'

// QA-006: uma chave só por nome, todas sob akool:, e a migração dos nomes antigos.
describe('inventário de chaves (QA-006)', () => {
  it('toda chave fixa está sob akool: e nenhuma repete', () => {
    const all = [...Object.values(LOCAL_KEYS), ...Object.values(SESSION_KEYS)]
    for (const k of all) expect(k).toMatch(/^akool:[a-z][a-z0-9.-]*$/)
    expect(new Set(all).size).toBe(all.length)
  })

  it('as dinâmicas também', () => {
    expect(localKey.onboardingSeen('u1')).toBe('akool:onboarding.seen:u1')
    expect(localKey.boardPrefs('finance-sales').hidden).toBe('akool:board.finance-sales.hidden')
    expect(sessionKey.cardDraft('b1', null, 'c1')).toBe('akool:projects.card-draft:b1:new:c1')
    expect(sessionKey.compactColumn('b1')).toMatch(/^akool:/)
  })

  it('o que sobrevive ao logout é só do aparelho', () => {
    // NOTIF-001: as categorias sem aviso ao chegar são do aparelho (só nomes de categoria, nada do usuário).
    expect([...KEEP_ON_SIGN_OUT].sort()).toEqual([LOCAL_KEYS.authLang, LOCAL_KEYS.chunkReloadAt, LOCAL_KEYS.theme, LOCAL_KEYS.notificationPrefs].sort())
  })
})

describe('migrateLocalKeys', () => {
  beforeEach(() => localStorage.clear())

  it('renomeia as fixas, as por prefixo e as dos kanbans do financeiro, apagando as antigas', () => {
    localStorage.setItem('excalinotion_auth_lang', 'en')
    localStorage.setItem('projects_active_board', 'b1')
    localStorage.setItem('akool_onboarding_seen_u1', '1')
    localStorage.setItem('projects_filters:b1', '{"q":"x"}')
    localStorage.setItem('finance_board_sales:hidden', '["cancelled"]')
    localStorage.setItem('finance_view_mode', 'individual')
    localStorage.setItem('sb-proj-auth-token', 'não é nossa')

    expect(migrateLocalKeys()).toBe(6)
    expect(localStorage.getItem(LOCAL_KEYS.authLang)).toBe('en')
    expect(localStorage.getItem(LOCAL_KEYS.projectsActiveBoard)).toBe('b1')
    expect(localStorage.getItem(localKey.onboardingSeen('u1'))).toBe('1')
    expect(localStorage.getItem(localKey.projectFilters('b1'))).toBe('{"q":"x"}')
    expect(localStorage.getItem(localKey.boardPrefs('finance-sales').hidden)).toBe('["cancelled"]')
    expect(localStorage.getItem('sb-proj-auth-token')).toBe('não é nossa')
    expect(Object.keys(localStorage).filter(k => !k.startsWith('akool:') && !k.startsWith('sb-'))).toEqual([])
  })

  it('é idempotente e não sobrescreve a chave nova que já existe', () => {
    localStorage.setItem(LOCAL_KEYS.theme, 'dark')
    localStorage.setItem('excalinotion_theme', 'light')
    expect(migrateLocalKeys()).toBe(1)
    expect(localStorage.getItem(LOCAL_KEYS.theme)).toBe('dark')
    expect(localStorage.getItem('excalinotion_theme')).toBeNull()
    expect(migrateLocalKeys()).toBe(0)
  })

  it('legacyKeyTarget ignora o que não é nosso', () => {
    expect(legacyKeyTarget('sb-x-auth-token')).toBeNull()
    expect(legacyKeyTarget('excalidraw-theme')).toBeNull()
    expect(legacyKeyTarget('projects_filters:')).toBeNull()
  })
})

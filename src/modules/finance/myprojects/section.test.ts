import { describe, expect, it } from 'vitest'
import { isProjectsSection, parseFinanceLocation, PROJECTS_SECTIONS } from './section'

describe('parseFinanceLocation', () => {
  it('passes an ordinary tab through untouched', () => {
    expect(parseFinanceLocation('transactions')).toEqual({ tab: 'transactions', section: null })
  })

  it('keeps the current sub-tab when none is asked for', () => {
    expect(parseFinanceLocation('myprojects')).toEqual({ tab: 'myprojects', section: null })
  })

  it('deep-links to a sub-tab', () => {
    expect(parseFinanceLocation('myprojects:store')).toEqual({ tab: 'myprojects', section: 'store' })
  })

  it('maps every legacy tab id to its sub-tab', () => {
    // Isto é o que salva quem tinha 'store' gravado no localStorage antes da
    // unificação: sem o mapa, cairia no Resumo geral sem entender o porquê.
    expect(parseFinanceLocation('projects')).toEqual({ tab: 'myprojects', section: 'works' })
    expect(parseFinanceLocation('store')).toEqual({ tab: 'myprojects', section: 'store' })
    expect(parseFinanceLocation('investments')).toEqual({ tab: 'myprojects', section: 'investments' })
    expect(parseFinanceLocation('goals')).toEqual({ tab: 'myprojects', section: 'goals' })
  })

  it('never resolves the tab id itself to the legacy Obras sub-tab', () => {
    // É por isto que o TabId continua 'myprojects' mesmo com o rótulo
    // "Projetos": se ele fosse 'projects', o mesmo texto significaria "abra a
    // seção" e "abra Obras", e quem tem 'projects' gravado cairia no lugar errado.
    expect(parseFinanceLocation('projects')?.section).toBe('works')
    expect(parseFinanceLocation('myprojects')?.section).toBeNull()
  })

  it('ignores an unknown sub-tab instead of navigating nowhere', () => {
    expect(parseFinanceLocation('myprojects:lixo')).toEqual({ tab: 'myprojects', section: null })
  })

  it('returns null for empty input', () => {
    expect(parseFinanceLocation(null)).toBeNull()
    expect(parseFinanceLocation('')).toBeNull()
    expect(parseFinanceLocation(undefined)).toBeNull()
  })

  it('lets an unknown tab through for the caller to reject', () => {
    // parseFinanceLocation não conhece TAB_IDS; quem valida é resolveTabRequest.
    expect(parseFinanceLocation('lixo')).toEqual({ tab: 'lixo', section: null })
  })
})

describe('isProjectsSection', () => {
  it('accepts every declared section and nothing else', () => {
    for (const s of PROJECTS_SECTIONS) expect(isProjectsSection(s)).toBe(true)
    expect(isProjectsSection('works ')).toBe(false)
    expect(isProjectsSection(null)).toBe(false)
    expect(isProjectsSection(42)).toBe(false)
  })
})

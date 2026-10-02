import { describe, expect, it } from 'vitest'
import { ptBR } from '../i18n/translations.pt-BR'
import { isProjectPriority, PROJECT_PRIORITIES, PROJECT_PRIORITY_COLORS, projectPriorityLabelKey, TODO_PRIORITIES, TODO_PRIORITY_COLORS, todoPriorityLabelKey } from './priorities'

describe('prioridades (QA-004)', () => {
  it('toda prioridade de projeto tem cor e chave de tradução', () => {
    for (const p of PROJECT_PRIORITIES) {
      expect(PROJECT_PRIORITY_COLORS[p]).toMatch(/^#[0-9a-f]{6}$/)
      expect(ptBR[projectPriorityLabelKey(p)]).toBeTruthy()
    }
    expect(Object.keys(PROJECT_PRIORITY_COLORS).sort()).toEqual([...PROJECT_PRIORITIES].sort())
  })

  it('toda prioridade de tarefa tem cor e chave de tradução', () => {
    for (const p of TODO_PRIORITIES) {
      expect(TODO_PRIORITY_COLORS[p]).toMatch(/^#[0-9a-f]{6}$/)
      expect(ptBR[todoPriorityLabelKey(p)]).toBeTruthy()
    }
  })

  it('isProjectPriority aceita só os 4 níveis', () => {
    expect(isProjectPriority('urgent')).toBe(true)
    expect(isProjectPriority('P0')).toBe(false)
  })
})

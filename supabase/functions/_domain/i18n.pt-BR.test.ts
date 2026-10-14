import { describe, expect, it } from 'vitest'
import { DOMAIN_PT_BR, tPtBR } from './i18n.pt-BR.ts'

// API-027: o `t` do _domain. A paridade dos textos com o app fica em
// src/lib/projectDomain.test.ts (aqui não se importa src/).

describe('tPtBR', () => {
  it('sem variáveis, o texto da chave', () => {
    expect(tPtBR('projects_new_card')).toBe('Novo card')
    expect(tPtBR('projects_priority_medium')).toBe(DOMAIN_PT_BR.projects_priority_medium)
  })

  it('troca {nome} pelo valor, numa passada só', () => {
    expect(tPtBR('projects_import_issue_id_mismatch', { id: 'A-001', detail: 'A-002' }))
      .toBe('A-001: o ID da tabela (A-002) é diferente do cabeçalho')
    // Valor de usuário não vira padrão de replace nem placeholder.
    expect(tPtBR('projects_import_issue_no_effort', { id: '$& {detail}' })).toBe('$& {detail}: sem esforço')
  })

  it('placeholder sem valor fica como está', () => {
    expect(tPtBR('projects_import_issue_id_mismatch', { id: 'A-001' })).toBe('A-001: o ID da tabela ({detail}) é diferente do cabeçalho')
    expect(tPtBR('projects_import_issue_no_topic', {})).toBe('{id}: sem seção Tópico')
  })

  it('todo texto é não vazio', () => {
    expect(Object.entries(DOMAIN_PT_BR).filter(([, v]) => !v.trim())).toEqual([])
  })
})

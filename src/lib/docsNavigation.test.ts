import { describe, expect, it } from 'vitest'
import { migrateLegacyProjects, normalizeActivePanel, normalizeWorkspaceMode, parseDocsSelection } from './docsNavigation'

// Só as funções puras: o suite roda com environment 'node', sem localStorage.
// O store e runLegacyProjectsMigration são cascas finas sobre estas.

describe('parseDocsSelection', () => {
  it('lê o JSON atual de cada seção', () => {
    expect(parseDocsSelection('{"kind":"projects"}')).toEqual({ kind: 'projects' })
    expect(parseDocsSelection('{"kind":"quick-notes"}')).toEqual({ kind: 'quick-notes' })
    expect(parseDocsSelection('{"kind":"studies"}')).toEqual({ kind: 'studies' })
    expect(parseDocsSelection('{"kind":"page","id":"abc"}')).toEqual({ kind: 'page', id: 'abc' })
  })

  it('lê a string solta de builds antigos como id de página', () => {
    expect(parseDocsSelection('4f2b9c')).toEqual({ kind: 'page', id: '4f2b9c' })
  })

  it('rejeita lixo sem quebrar', () => {
    expect(parseDocsSelection(null)).toBeNull()
    expect(parseDocsSelection('')).toBeNull()
    expect(parseDocsSelection('{"kind":"investments"}')).toBeNull() // kind desconhecido
    expect(parseDocsSelection('{"kind":"page"}')).toBeNull() // page sem id
    // JSON sem 'kind' cai no caminho legado — mesmo comportamento do
    // readSelected() original, que só entrava no branch de objeto com a chave.
    expect(parseDocsSelection('{"foo":1}')).toEqual({ kind: 'page', id: '{"foo":1}' })
  })
})

describe('normalizeWorkspaceMode', () => {
  it('mantém modos válidos', () => {
    expect(normalizeWorkspaceMode('all')).toBe('all')
    expect(normalizeWorkspaceMode('finance')).toBe('finance')
    expect(normalizeWorkspaceMode('documents')).toBe('documents')
  })
  it("migra 'projects' para 'documents'", () => {
    expect(normalizeWorkspaceMode('projects')).toBe('documents')
  })
  it("cai em 'all' para lixo ou ausência", () => {
    expect(normalizeWorkspaceMode(null)).toBe('all')
    expect(normalizeWorkspaceMode('banana')).toBe('all')
  })
})

describe('normalizeActivePanel', () => {
  it('mantém painéis válidos', () => {
    for (const p of ['users', 'finance', 'help', 'backup', 'documents'] as const) {
      expect(normalizeActivePanel(p)).toBe(p)
    }
  })
  it("migra 'projects' para 'documents'", () => {
    expect(normalizeActivePanel('projects')).toBe('documents')
  })
  it('devolve null para lixo ou ausência', () => {
    expect(normalizeActivePanel(null)).toBeNull()
    expect(normalizeActivePanel('banana')).toBeNull()
  })
})

describe('migrateLegacyProjects', () => {
  it('painel e modo legados → Documentos com Projetos selecionado', () => {
    expect(migrateLegacyProjects({ mode: 'projects', panel: 'projects', docsSelection: null })).toEqual({
      mode: 'documents', panel: 'documents', docsSelection: { kind: 'projects' },
    })
  })

  it('painel legado sobrescreve uma seleção de página existente (o usuário estava olhando o kanban)', () => {
    expect(migrateLegacyProjects({ mode: 'all', panel: 'projects', docsSelection: '{"kind":"page","id":"x"}' })).toEqual({
      mode: 'all', panel: 'documents', docsSelection: { kind: 'projects' },
    })
  })

  it('só o modo legado: troca o modo e não toca no resto', () => {
    expect(migrateLegacyProjects({ mode: 'projects', panel: 'finance', docsSelection: '{"kind":"studies"}' })).toEqual({
      mode: 'documents', panel: 'finance', docsSelection: { kind: 'studies' },
    })
  })

  it('estado limpo passa intocado (idempotente)', () => {
    const clean = { mode: 'documents', panel: 'documents', docsSelection: '{"kind":"projects"}' }
    const once = migrateLegacyProjects(clean)
    expect(once).toEqual({ mode: 'documents', panel: 'documents', docsSelection: { kind: 'projects' } })
    const twice = migrateLegacyProjects({ mode: once.mode, panel: once.panel, docsSelection: JSON.stringify(once.docsSelection) })
    expect(twice).toEqual(once)
  })
})

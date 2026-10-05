import { describe, expect, it } from 'vitest'
import { COMPOSITE_VIEWS, describeScope, LEGACY_SCOPES, SECTIONS, SUBSECTIONS } from './catalog.ts'
import { allows, effectiveScopes, hasAdminScope, hasWriteScope, maxTokenDays, normalizeScopes } from './scopes.ts'

describe('catálogo', () => {
  it('tem 7 seções e 27 subseções, com chaves únicas no formato secao.subsecao', () => {
    expect(SECTIONS).toHaveLength(7)
    expect(SUBSECTIONS).toHaveLength(27)
    const keys = SUBSECTIONS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of SUBSECTIONS) {
      expect(s.key).toMatch(/^[a-z]+\.[a-z_]+$/)
      expect(s.key.split('.')[0]).toBe(s.section)
    }
  })

  it('administração é só leitura e só para admin; o resto não é admin', () => {
    for (const s of SUBSECTIONS) {
      expect(s.adminOnly).toBe(s.section === 'admin')
      if (s.adminOnly) expect(s.maxLevel).toBe('read')
    }
  })

  it('visões compostas só apontam para subseções reais e não colidem com elas', () => {
    const keys = new Set(SUBSECTIONS.map(s => s.key))
    for (const v of COMPOSITE_VIEWS) {
      expect(keys.has(v.key)).toBe(false)
      for (const sub of v.anyOf) expect(keys.has(sub)).toBe(true)
    }
  })

  it('o preset legado é o da fila, sem validação', () => {
    expect(LEGACY_SCOPES).toEqual({ 'projetos.quadros': 'read', 'projetos.cards': 'read', 'projetos.fila': 'write' })
    expect(normalizeScopes(LEGACY_SCOPES).issues).toEqual([])
  })

  it('descreve a permissão em português', () => {
    expect(describeScope('projetos.validacao', 'write')).toBe('Projetos › Validação (aprovar/reprovar): Escrever')
  })
})

describe('allows', () => {
  const scopes = { 'projetos.fila': 'write', 'projetos.quadros': 'delete', 'projetos.cards': 'read' }

  it('excluir ⊃ escrever ⊃ ler', () => {
    expect(allows(scopes, 'projetos.quadros', 'read')).toBe(true)
    expect(allows(scopes, 'projetos.quadros', 'delete')).toBe(true)
    expect(allows(scopes, 'projetos.fila', 'read')).toBe(true)
    expect(allows(scopes, 'projetos.fila', 'write')).toBe(true)
    expect(allows(scopes, 'projetos.fila', 'delete')).toBe(false)
    expect(allows(scopes, 'projetos.cards', 'write')).toBe(false)
  })

  it('nega o que falta e o que vier malformado (fail-closed)', () => {
    expect(allows(scopes, 'projetos.validacao', 'read')).toBe(false)
    expect(allows(null, 'projetos.fila', 'read')).toBe(false)
    expect(allows([], 'projetos.fila', 'read')).toBe(false)
    expect(allows({ 'projetos.fila': 'admin' }, 'projetos.fila', 'read')).toBe(false)
    expect(allows({ 'projetos.fila': true }, 'projetos.fila', 'read')).toBe(false)
  })
})

describe('normalizeScopes', () => {
  it('aceita os níveis em português, descarta Nenhum e ordena as chaves', () => {
    const { scopes, issues } = normalizeScopes({ 'projetos.fila': 'Escrever', 'documentos.paginas': 'ler', 'financas.loja': 'nenhum' })
    expect(issues).toEqual([])
    expect(Object.keys(scopes)).toEqual(['documentos.paginas', 'projetos.fila'])
    expect(scopes).toEqual({ 'documentos.paginas': 'read', 'projetos.fila': 'write' })
  })

  it('aponta subseção inexistente, nível inválido e nível acima do máximo', () => {
    const { scopes, issues } = normalizeScopes({ 'projetos.tudo': 'read', 'perfil.dados': 'admin', 'projetos.fila': 'delete' })
    expect(scopes).toEqual({})
    expect(issues).toEqual([
      { code: 'invalid_level', key: 'perfil.dados', value: 'admin' },
      { code: 'above_max', key: 'projetos.fila', level: 'delete', max: 'write' },
      { code: 'unknown_subsection', key: 'projetos.tudo' },
    ])
  })

  it('admin.* só para admin', () => {
    expect(normalizeScopes({ 'admin.auditoria': 'read' }).issues).toEqual([{ code: 'admin_only', key: 'admin.auditoria' }])
    expect(normalizeScopes({ 'admin.auditoria': 'read' }, { isAdmin: true })).toEqual({ scopes: { 'admin.auditoria': 'read' }, issues: [] })
  })

  it('recusa o que não é objeto', () => {
    expect(normalizeScopes(null).issues).toEqual([{ code: 'not_object' }])
    expect(normalizeScopes(['projetos.fila']).issues).toEqual([{ code: 'not_object' }])
  })
})

describe('escopos efetivos e classificação', () => {
  it('tira admin.* de quem deixou de ser admin', () => {
    const scopes = { 'admin.usuarios': 'read', 'projetos.cards': 'read' } as const
    expect(effectiveScopes(scopes, false)).toEqual({ 'projetos.cards': 'read' })
    expect(effectiveScopes(scopes, true)).toEqual(scopes)
  })

  it('detecta escrita e administração', () => {
    expect(hasWriteScope({ 'projetos.cards': 'read' })).toBe(false)
    expect(hasWriteScope(LEGACY_SCOPES)).toBe(true)
    expect(hasWriteScope({ 'documentos.paginas': 'delete' })).toBe(true)
    expect(hasAdminScope({ 'admin.backups': 'read' })).toBe(true)
    expect(hasAdminScope(LEGACY_SCOPES)).toBe(false)
  })

  it('validade máxima pelo nível: 30 dias com Administração, 90 com escrita, senão 365', () => {
    expect(maxTokenDays({})).toBe(365)
    expect(maxTokenDays({ 'projetos.cards': 'read' })).toBe(365)
    expect(maxTokenDays(LEGACY_SCOPES)).toBe(90)
    expect(maxTokenDays({ 'documentos.paginas': 'delete' })).toBe(90)
    expect(maxTokenDays({ 'admin.auditoria': 'read', 'projetos.fila': 'write' })).toBe(30)
  })
})

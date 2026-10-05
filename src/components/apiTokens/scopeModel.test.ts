import { describe, expect, it } from 'vitest'
import harness from '../../../supabase/checks/api009-token-screen.sql?raw'
import { COMPOSITE_VIEWS, LEGACY_SCOPES, SECTIONS, SUBSECTIONS } from '../../../supabase/functions/_api/catalog'
import { normalizeScopes } from '../../../supabase/functions/_api/scopes'
import { API_TOKEN_COLUMNS } from '../../lib/data/apiTokens'
import en from '../../i18n/translations.en'
import { ptBR } from '../../i18n/translations.pt-BR'
import { PRESET_CHOICES, PRESETS, presetOf } from './presets'
import {
  clampExpiry, createLimits, editLimits, expiryOptions, fitsLimits, levelAllowed, levelLabelKey, levelsFor, PICKER_LEVELS,
  prefillScopes, sameScopes, scopeWarnings, sectionBulkLevel, sectionLabelKey, sectionMaxLevel, setLevel, setSectionLevel,
  subsectionLabelKey, subsectionsOf, summarizeScopes, viewLabelKey, viewStatuses, visibleSections,
} from './scopeModel'

// API-009: a lógica do seletor de permissões, os presets e a paridade entre o
// catálogo (supabase/functions/_api/catalog.ts) e as traduções.

const NOW = Date.parse('2026-10-05T12:00:00Z')
const DAY = 86_400_000
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString()
const sub = (key: string) => {
  const found = SUBSECTIONS.find(s => s.key === key)
  if (!found) throw new Error(key)
  return found
}
const ALL = createLimits(true)

describe('traduções do catálogo', () => {
  it('cada seção, subseção, nível e visão tem texto nas duas línguas', () => {
    const keys = [
      ...SECTIONS.map(s => sectionLabelKey(s.key)),
      ...SUBSECTIONS.map(s => subsectionLabelKey(s.key)),
      ...PICKER_LEVELS.map(levelLabelKey),
      ...COMPOSITE_VIEWS.map(v => viewLabelKey(v.key)),
    ]
    expect(keys.filter(k => !(k in ptBR))).toEqual([])
    expect(keys.filter(k => !(k in en))).toEqual([])
  })

  it('nenhuma chave api_scope_* sobra sem item no catálogo', () => {
    const fromCatalog = new Set<string>([
      ...SECTIONS.map(s => sectionLabelKey(s.key)),
      ...SUBSECTIONS.map(s => subsectionLabelKey(s.key)),
      ...PICKER_LEVELS.map(levelLabelKey),
      ...COMPOSITE_VIEWS.map(v => viewLabelKey(v.key)),
    ])
    expect(Object.keys(ptBR).filter(k => k.startsWith('api_scope_') && !fromCatalog.has(k))).toEqual([])
  })

  it('o rótulo da subseção é o do catálogo sem a seção', () => {
    for (const s of SUBSECTIONS) expect(s.label.endsWith(`› ${ptBR[subsectionLabelKey(s.key)]}`)).toBe(true)
  })
})

describe('seções e níveis', () => {
  it('Administração só aparece para admin', () => {
    expect(visibleSections(false)).not.toContain('admin')
    expect(visibleSections(true)).toEqual(SECTIONS.map(s => s.key))
  })

  it('cada subseção vai de Nenhum até o máximo dela; a seção vai até o maior', () => {
    expect(levelsFor(sub('projetos.fila'))).toEqual(['none', 'read', 'write'])
    expect(levelsFor(sub('admin.usuarios'))).toEqual(['none', 'read'])
    expect(levelsFor(sub('projetos.cards'))).toEqual(['none', 'read', 'write', 'delete'])
    expect(sectionMaxLevel('admin')).toBe('read')
    expect(sectionMaxLevel('perfil')).toBe('delete')
    expect(subsectionsOf('projetos').map(s => s.key)).toEqual(['projetos.quadros', 'projetos.cards', 'projetos.fila', 'projetos.validacao'])
  })

  it('limites: máximo da subseção, trava de nível e Administração', () => {
    expect(levelAllowed(sub('projetos.fila'), 'delete', ALL)).toBe(false)
    expect(levelAllowed(sub('projetos.cards'), 'delete', ALL)).toBe(true)
    expect(levelAllowed(sub('projetos.cards'), 'write', { maxLevel: 'read', admin: true })).toBe(false)
    expect(levelAllowed(sub('admin.backups'), 'read', { maxLevel: 'delete', admin: false })).toBe(false)
    expect(levelAllowed(sub('admin.backups'), 'none', { maxLevel: 'read', admin: false })).toBe(true)
  })

  it('setLevel troca ou tira a chave sem mexer no mapa recebido', () => {
    const before = { 'projetos.cards': 'read' } as const
    expect(setLevel(before, 'projetos.fila', 'write')).toEqual({ 'projetos.cards': 'read', 'projetos.fila': 'write' })
    expect(setLevel(before, 'projetos.cards', 'none')).toEqual({})
    expect(before).toEqual({ 'projetos.cards': 'read' })
  })
})

describe('nível em lote', () => {
  it('Excluir na seção limita cada subseção ao máximo dela', () => {
    const next = setSectionLevel({}, 'projetos', 'delete', ALL)
    expect(next).toEqual({ 'projetos.quadros': 'delete', 'projetos.cards': 'delete', 'projetos.fila': 'write', 'projetos.validacao': 'write' })
    expect(sectionBulkLevel(next, 'projetos')).toBe('delete')
  })

  it('a trava da edição limita o lote; Nenhum limpa a seção e não toca nas outras', () => {
    const locked = setSectionLevel({ 'financas.contas': 'read' }, 'projetos', 'delete', { maxLevel: 'read', admin: false })
    expect(locked).toEqual({ 'financas.contas': 'read', 'projetos.quadros': 'read', 'projetos.cards': 'read', 'projetos.fila': 'read', 'projetos.validacao': 'read' })
    expect(setSectionLevel(locked, 'projetos', 'none', ALL)).toEqual({ 'financas.contas': 'read' })
  })

  it('Administração sem permissão de admin fica de fora do lote', () => {
    expect(setSectionLevel({}, 'admin', 'read', { maxLevel: 'delete', admin: false })).toEqual({})
    expect(setSectionLevel({}, 'admin', 'delete', ALL)).toEqual({ 'admin.usuarios': 'read', 'admin.convites': 'read', 'admin.auditoria': 'read', 'admin.backups': 'read' })
  })

  it('o lote mostra o nível comum, Nenhum ou Misto', () => {
    expect(sectionBulkLevel({}, 'projetos')).toBe('none')
    expect(sectionBulkLevel(LEGACY_SCOPES, 'projetos')).toBe('mixed')
    expect(sectionBulkLevel(setSectionLevel({}, 'admin', 'read', ALL), 'admin')).toBe('read')
    expect(sectionBulkLevel(setSectionLevel({}, 'perfil', 'write', ALL), 'perfil')).toBe('write')
  })
})

describe('avisos, chips e visões', () => {
  it('avisa sobre Excluir, Validação, Compartilhamento e Administração', () => {
    expect(scopeWarnings(LEGACY_SCOPES)).toEqual([])
    expect(scopeWarnings({ 'documentos.paginas': 'delete', 'projetos.validacao': 'write', 'compartilhamento.pessoas': 'read', 'admin.usuarios': 'read' }))
      .toEqual(['delete', 'validacao', 'sharing', 'admin'])
  })

  it('um chip por seção, com o maior nível, a contagem e se é uniforme', () => {
    expect(summarizeScopes(LEGACY_SCOPES)).toEqual([{ section: 'projetos', top: 'write', count: 3, total: 4, uniform: false }])
    expect(summarizeScopes(setSectionLevel({}, 'estudos', 'read', ALL))).toEqual([{ section: 'estudos', top: 'read', count: 3, total: 3, uniform: true }])
    expect(summarizeScopes({})).toEqual([])
  })

  it('visões compostas: quantas fontes o token lê; "meta" não exige nada', () => {
    const byKey = Object.fromEntries(viewStatuses(LEGACY_SCOPES).map(s => [s.view.key, `${s.granted}/${s.total}`]))
    expect(byKey).toEqual({ meta: '0/0', painel: '1/7', 'documentos.rede': '2/5', 'financas.relatorios': '0/7' })
  })
})

describe('edição', () => {
  it('preenche com o nível guardado, sem chave desconhecida e sem admin.* de quem deixou de ser admin', () => {
    const stored = { 'projetos.cards': 'read', 'admin.usuarios': 'read', 'sumiu.daqui': 'write', 'projetos.fila': 'write' }
    expect(prefillScopes(stored, false)).toEqual({ 'projetos.cards': 'read', 'projetos.fila': 'write' })
    expect(prefillScopes(stored, true)).toEqual({ 'admin.usuarios': 'read', 'projetos.cards': 'read', 'projetos.fila': 'write' })
    expect(prefillScopes(null, true)).toEqual({})
  })

  it('a validade que resta trava o nível como o banco: 90 dias para escrita, 30 para admin', () => {
    expect(editLimits(inDays(91), true, NOW)).toEqual({ maxLevel: 'read', admin: false })
    expect(editLimits(inDays(90), true, NOW)).toEqual({ maxLevel: 'delete', admin: false })
    expect(editLimits(inDays(30), true, NOW)).toEqual({ maxLevel: 'delete', admin: true })
    expect(editLimits(inDays(30), false, NOW)).toEqual({ maxLevel: 'delete', admin: false })
  })

  it('compara mapas pelo conteúdo, não pela ordem', () => {
    expect(sameScopes({ a: 'read', b: 'write' }, { b: 'write', a: 'read' })).toBe(true)
    expect(sameScopes({ a: 'read' }, { a: 'write' })).toBe(false)
    expect(sameScopes({ a: 'read' }, { a: 'read', b: 'read' })).toBe(false)
  })

  it('fitsLimits recusa nível acima da trava, admin sem permissão e chave fora do catálogo', () => {
    expect(fitsLimits(LEGACY_SCOPES, { maxLevel: 'read', admin: true })).toBe(false)
    expect(fitsLimits(PRESETS.read_only, { maxLevel: 'read', admin: false })).toBe(true)
    expect(fitsLimits({ 'admin.usuarios': 'read' }, { maxLevel: 'delete', admin: false })).toBe(false)
    expect(fitsLimits({ 'x.y': 'read' }, ALL)).toBe(false)
  })
})

describe('validade na criação', () => {
  it('as opções acima do teto ficam desligadas, e a escolha desce até ele', () => {
    expect(expiryOptions({ 'projetos.cards': 'read' }).every(o => o.allowed)).toBe(true)
    expect(expiryOptions(LEGACY_SCOPES)).toEqual([
      { days: 7, allowed: true }, { days: 30, allowed: true }, { days: 90, allowed: true }, { days: 365, allowed: false },
    ])
    expect(clampExpiry(365, LEGACY_SCOPES)).toBe(90)
    expect(clampExpiry(365, { 'admin.auditoria': 'read' })).toBe(30)
    expect(clampExpiry(7, { 'admin.auditoria': 'read' })).toBe(7)
    expect(clampExpiry(365, {})).toBe(365)
  })
})

describe('presets', () => {
  it('todos passam pelo catálogo sem problema e nenhum dá Administração', () => {
    for (const key of PRESET_CHOICES) {
      if (key === 'custom') continue
      const { issues } = normalizeScopes(PRESETS[key])
      expect(issues, key).toEqual([])
      expect(scopeWarnings(PRESETS[key]), key).not.toContain('admin')
    }
  })

  it('Somente leitura lê tudo, menos Administração e Compartilhamento', () => {
    expect(Object.values(PRESETS.read_only).every(level => level === 'read')).toBe(true)
    expect(Object.keys(PRESETS.read_only)).toHaveLength(SUBSECTIONS.filter(s => !s.adminOnly).length - 1)
    expect(PRESETS.read_only['compartilhamento.pessoas']).toBeUndefined()
  })

  it('Claude Code: fila é o conjunto dos tokens migrados; Entrada de dados financeiros escreve só onde precisa', () => {
    expect(PRESETS.claude_fila).toEqual(LEGACY_SCOPES)
    expect(PRESETS.finance_entry).toEqual({
      'financas.transacoes': 'write', 'financas.orcamentos_metas': 'write', 'financas.recorrentes': 'write',
      'financas.contas': 'read', 'financas.categorias': 'read',
    })
  })

  it('o harness SQL (supabase/checks/api009-token-screen.sql) usa os mesmos presets e o select da lista', () => {
    const line = harness.split('\n').find(l => l.trim().startsWith('presets jsonb :='))
    expect(JSON.parse(line?.match(/'(.+)';/)?.[1] ?? 'null')).toEqual(PRESETS)
    expect(harness).toContain(`select ${API_TOKEN_COLUMNS} from public.api_tokens`)
  })

  it('presetOf reconhece o preset; mexer vira Personalizado; vazio é null', () => {
    expect(presetOf({ ...LEGACY_SCOPES })).toBe('claude_fila')
    expect(presetOf(setLevel(LEGACY_SCOPES, 'projetos.validacao', 'write'))).toBe('custom')
    expect(presetOf({})).toBeNull()
  })
})

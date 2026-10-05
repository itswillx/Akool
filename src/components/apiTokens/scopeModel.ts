import {
  COMPOSITE_VIEWS, MAX_DAYS_WITH_ADMIN, MAX_DAYS_WITH_WRITE, SCOPE_LEVELS, SECTIONS, SUBSECTIONS, TOKEN_EXPIRY_DAYS,
  type CompositeView, type ScopeLevel, type ScopeSubsection, type SectionKey,
} from '../../../supabase/functions/_api/catalog'
import { effectiveScopes, hasAdminScope, levelRank, maxTokenDays, normalizeScopes, type ScopeMap } from '../../../supabase/functions/_api/scopes'
import type { TranslationKey } from '../../i18n/translations'

// API-009: a lógica do seletor de permissões, sem React. O catálogo
// (supabase/functions/_api/catalog.ts) é a fonte; o banco confere tudo de novo
// (private.api_validate_scopes e private.api_token_policy).

export type { ScopeMap }

/** Nível no seletor: sem a chave no mapa = Nenhum. */
export type PickerLevel = ScopeLevel | 'none'
export const PICKER_LEVELS: readonly PickerLevel[] = ['none', ...SCOPE_LEVELS]

export interface PickerLimits {
  /** Nível mais alto aceito; na edição, a validade restante pode travar em Ler. */
  maxLevel: ScopeLevel
  /** Administração: só admin e, com escrita ou não, só em token de até 30 dias. */
  admin: boolean
}

const DAY_MS = 86_400_000

// Chaves de tradução. scopeModel.test.ts confere a paridade com o catálogo.
export const sectionLabelKey = (section: SectionKey): TranslationKey => `api_scope_section_${section}`
export const subsectionLabelKey = (key: string) => `api_scope_${key.replace('.', '_')}` as TranslationKey
export const levelLabelKey = (level: PickerLevel): TranslationKey => `api_scope_level_${level}`
export const viewLabelKey = (key: string) => `api_scope_view_${key.replace('.', '_')}` as TranslationKey

/** Seções na ordem do catálogo; Administração só para admin. */
export function visibleSections(isAdmin: boolean): SectionKey[] {
  return SECTIONS.map(s => s.key).filter(key => isAdmin || key !== 'admin')
}

export function subsectionsOf(section: SectionKey): ScopeSubsection[] {
  return SUBSECTIONS.filter(s => s.section === section)
}

const cap = (level: ScopeLevel, max: ScopeLevel): ScopeLevel => (levelRank(level) > levelRank(max) ? max : level)

/** Níveis que a subseção aceita, de Nenhum até o máximo dela. */
export function levelsFor(sub: ScopeSubsection): PickerLevel[] {
  return PICKER_LEVELS.filter(level => level === 'none' || levelRank(level) <= levelRank(sub.maxLevel))
}

/** Maior nível entre as subseções: o seletor em lote vai até ele. */
export function sectionMaxLevel(section: SectionKey): ScopeLevel {
  return subsectionsOf(section).reduce<ScopeLevel>((max, sub) => (levelRank(sub.maxLevel) > levelRank(max) ? sub.maxLevel : max), 'read')
}

/** O nível pode ser escolhido nesta subseção com estes limites? */
export function levelAllowed(sub: ScopeSubsection, level: PickerLevel, limits: PickerLimits): boolean {
  if (level === 'none') return true
  if (sub.adminOnly && !limits.admin) return false
  return levelRank(level) <= levelRank(sub.maxLevel) && levelRank(level) <= levelRank(limits.maxLevel)
}

/** Novo mapa com a subseção no nível pedido (Nenhum tira a chave). */
export function setLevel(scopes: ScopeMap, key: string, level: PickerLevel): ScopeMap {
  const rest = Object.fromEntries(Object.entries(scopes).filter(([k]) => k !== key))
  return level === 'none' ? rest : { ...rest, [key]: level }
}

/** Nível em lote: cada subseção recebe o nível pedido, limitado ao máximo dela e aos limites. */
export function setSectionLevel(scopes: ScopeMap, section: SectionKey, level: PickerLevel, limits: PickerLimits): ScopeMap {
  return subsectionsOf(section).reduce((next, sub) => {
    if (sub.adminOnly && !limits.admin) return next
    const target = level === 'none' ? 'none' : cap(cap(level, sub.maxLevel), limits.maxLevel)
    return setLevel(next, sub.key, target)
  }, scopes)
}

/**
 * O que o seletor em lote mostra: o menor nível L com cada subseção em
 * min(L, máximo dela). Nenhum serve → 'mixed' (as subseções diferem).
 */
export function sectionBulkLevel(scopes: ScopeMap, section: SectionKey): PickerLevel | 'mixed' {
  const subs = subsectionsOf(section)
  const found = PICKER_LEVELS.find(level => subs.every(sub => scopes[sub.key] === (level === 'none' ? undefined : cap(level, sub.maxLevel))))
  return found ?? 'mixed'
}

export type ScopeWarning = 'delete' | 'validacao' | 'sharing' | 'admin'

/** Avisos do que pede atenção: Excluir, Validação, Compartilhamento e Administração. */
export function scopeWarnings(scopes: ScopeMap): ScopeWarning[] {
  const warnings: ScopeWarning[] = []
  if (Object.values(scopes).includes('delete')) warnings.push('delete')
  // Validação em Ler não libera nada; o aviso é para aprovar e reprovar (Escrever).
  if (levelRank(scopes['projetos.validacao']) >= levelRank('write')) warnings.push('validacao')
  if (scopes['compartilhamento.pessoas']) warnings.push('sharing')
  if (hasAdminScope(scopes)) warnings.push('admin')
  return warnings
}

export interface SectionSummary {
  section: SectionKey
  /** O maior nível dado na seção. */
  top: ScopeLevel
  count: number
  total: number
  /** Todas as subseções dadas têm o mesmo nível. */
  uniform: boolean
}

/** Um chip por seção com alguma permissão, na ordem do catálogo. */
export function summarizeScopes(scopes: ScopeMap): SectionSummary[] {
  return SECTIONS.flatMap(({ key: section }) => {
    const subs = subsectionsOf(section)
    const levels = subs.flatMap(sub => scopes[sub.key] ?? [])
    if (levels.length === 0) return []
    const top = levels.reduce((a, b) => (levelRank(b) > levelRank(a) ? b : a))
    return [{ section, top, count: levels.length, total: subs.length, uniform: levels.every(l => l === top) }]
  })
}

export interface ViewStatus {
  view: CompositeView
  /** Quantas fontes da visão o token pode ler. */
  granted: number
  total: number
}

/** As leituras compostas: cada bloco sai com a leitura da subseção de origem. */
export function viewStatuses(scopes: ScopeMap): ViewStatus[] {
  return COMPOSITE_VIEWS.map(view => ({ view, granted: view.anyOf.filter(key => scopes[key] !== undefined).length, total: view.anyOf.length }))
}

/** Escopos guardados → mapa do seletor: só chaves do catálogo e sem admin.* de quem deixou de ser admin. */
export function prefillScopes(stored: unknown, isAdmin: boolean): ScopeMap {
  return effectiveScopes(normalizeScopes(stored, { isAdmin: true }).scopes, isAdmin)
}

export function createLimits(isAdmin: boolean): PickerLimits {
  return { maxLevel: 'delete', admin: isAdmin }
}

// created_at e expires_at saem do mesmo now() do servidor; a folga cobre o arredondamento.
const SPAN_SLACK_MS = 1_000

/**
 * Na edição, a validade que resta limita o nível, como o banco faz: Escrever e
 * Excluir só em token que vence em até 90 dias; Administração, em até 30. Um
 * token emitido com validade dentro do teto passa sempre (o banco mede com o
 * relógio dele, e o do navegador pode estar atrasado); o resto depende do que
 * falta para vencer.
 */
export function editLimits(token: { created_at: string; expires_at: string }, isAdmin: boolean, now = Date.now()): PickerLimits {
  const expires = Date.parse(token.expires_at)
  const span = expires - Date.parse(token.created_at)
  const left = expires - now
  const within = (days: number) => span <= days * DAY_MS + SPAN_SLACK_MS || left <= days * DAY_MS
  return {
    maxLevel: within(MAX_DAYS_WITH_WRITE) ? 'delete' : 'read',
    admin: isAdmin && within(MAX_DAYS_WITH_ADMIN),
  }
}

/** Um preset ou um mapa cabe nestes limites? */
export function fitsLimits(scopes: ScopeMap, limits: PickerLimits): boolean {
  return Object.entries(scopes).every(([key, level]) => {
    const sub = SUBSECTIONS.find(s => s.key === key)
    return !!sub && !!level && levelAllowed(sub, level, limits)
  })
}

export function sameScopes(a: ScopeMap, b: ScopeMap): boolean {
  const keys = (m: ScopeMap) => Object.keys(m).filter(k => m[k] !== undefined).sort()
  const ka = keys(a)
  const kb = keys(b)
  return ka.length === kb.length && ka.every((key, i) => key === kb[i] && a[key] === b[key])
}

/** Validades que o token aceita com estes escopos (até 90 com escrita, até 30 com admin). */
export function expiryOptions(scopes: ScopeMap): { days: number; allowed: boolean }[] {
  const max = maxTokenDays(scopes)
  return TOKEN_EXPIRY_DAYS.map(days => ({ days, allowed: days <= max }))
}

/** A validade escolhida, reduzida ao teto dos escopos quando passa dele. */
export function clampExpiry(days: number, scopes: ScopeMap): number {
  const max = maxTokenDays(scopes)
  return days <= max ? days : Math.max(...TOKEN_EXPIRY_DAYS.filter(d => d <= max))
}

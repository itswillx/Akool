// API-001: níveis de permissão por subseção (excluir ⊃ escrever ⊃ ler).
// Mesmas regras de private.api_validate_scopes na migration api001_token_scopes;
// o banco é quem decide, isto aqui serve à cards-api, à tela de tokens e aos testes.
// Só aqui os níveis em português são aceitos: o banco recebe read/write/delete.

import { getSubsection, SCOPE_LEVELS, type ScopeLevel } from './catalog.ts'

export type ScopeMap = Partial<Record<string, ScopeLevel>>

export type ScopeIssue =
  | { code: 'not_object' }
  | { code: 'unknown_subsection'; key: string }
  | { code: 'invalid_level'; key: string; value: unknown }
  | { code: 'above_max'; key: string; level: ScopeLevel; max: ScopeLevel }
  | { code: 'admin_only'; key: string }

const RANK: Record<ScopeLevel, number> = { read: 1, write: 2, delete: 3 }

// A tela e as IAs podem mandar o nível em português; o banco guarda em inglês.
const ALIASES: Record<string, ScopeLevel | null> = {
  read: 'read', write: 'write', delete: 'delete',
  ler: 'read', escrever: 'write', excluir: 'delete',
  none: null, nenhum: null,
}

export function levelRank(level: ScopeLevel | null | undefined): number {
  return level ? RANK[level] : 0
}

export function isScopeLevel(value: unknown): value is ScopeLevel {
  return typeof value === 'string' && (SCOPE_LEVELS as readonly string[]).includes(value)
}

/** O token tem `level` (ou mais) em `sub`? Escopo ausente ou malformado nega. */
export function allows(scopes: unknown, sub: string, level: ScopeLevel): boolean {
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) return false
  const granted = (scopes as Record<string, unknown>)[sub]
  return isScopeLevel(granted) && RANK[granted] >= RANK[level]
}

/**
 * Valida contra o catálogo e devolve o mapa limpo: sem "Nenhum", chaves em
 * ordem. Qualquer problema vai em `issues`; quem chama decide se recusa.
 */
export function normalizeScopes(input: unknown, opts: { isAdmin?: boolean } = {}): { scopes: ScopeMap; issues: ScopeIssue[] } {
  const issues: ScopeIssue[] = []
  const scopes: ScopeMap = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { scopes, issues: [{ code: 'not_object' }] }
  }
  for (const key of Object.keys(input).sort()) {
    const raw = (input as Record<string, unknown>)[key]
    const sub = getSubsection(key)
    if (!sub) {
      issues.push({ code: 'unknown_subsection', key })
      continue
    }
    const alias = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (!Object.hasOwn(ALIASES, alias)) {
      issues.push({ code: 'invalid_level', key, value: raw })
      continue
    }
    const level = ALIASES[alias]
    if (level === null) continue
    if (RANK[level] > RANK[sub.maxLevel]) {
      issues.push({ code: 'above_max', key, level, max: sub.maxLevel })
      continue
    }
    if (sub.adminOnly && !opts.isAdmin) {
      issues.push({ code: 'admin_only', key })
      continue
    }
    scopes[key] = level
  }
  return { scopes, issues }
}

/** Tira admin.* de quem deixou de ser admin (como resolve_api_token_v2). */
export function effectiveScopes(scopes: ScopeMap, isAdmin: boolean): ScopeMap {
  if (isAdmin) return { ...scopes }
  return Object.fromEntries(Object.entries(scopes).filter(([key]) => !getSubsection(key)?.adminOnly))
}

/** Algum nível acima de Ler (pede validade menor e AAL2 de quem tem MFA). */
export function hasWriteScope(scopes: ScopeMap): boolean {
  return Object.values(scopes).some(level => levelRank(level) >= RANK.write)
}

export function hasAdminScope(scopes: ScopeMap): boolean {
  return Object.keys(scopes).some(key => getSubsection(key)?.adminOnly)
}

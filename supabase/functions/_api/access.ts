// API-008: a ação pode ser chamada com estas permissões? Fica fora do
// registry.ts para as ações (meta.acoes.listar) usarem sem import circular.

import type { ScopeLevel } from './catalog.ts'
import type { ActionRequires } from './types.ts'

/** Todas as de `allOf` e, se houver `anyOf` não vazio, ao menos uma dele. */
export function isAllowed(requires: ActionRequires, can: (sub: string, level: ScopeLevel) => boolean): boolean {
  const all = requires.allOf ?? []
  const any = requires.anyOf ?? []
  return all.every(r => can(r.sub, r.level)) && (any.length === 0 || any.some(r => can(r.sub, r.level)))
}

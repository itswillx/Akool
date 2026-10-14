import { LEGACY_SCOPES, SUBSECTIONS, type ScopeLevel } from '../../../supabase/functions/_api/catalog'
import { sameScopes, type ScopeMap } from './scopeModel'

// API-009: pontos de partida do seletor. Escolher um preset troca as
// permissões; mexer depois em qualquer subseção vira Personalizado.

export type PresetKey = 'read_only' | 'claude_fila' | 'finance_entry'
export type PresetChoice = PresetKey | 'custom'

export const PRESETS: Record<PresetKey, ScopeMap> = {
  // Ler tudo, menos Administração e Compartilhamento (que alcança conteúdo de outras pessoas).
  read_only: Object.fromEntries(
    SUBSECTIONS.filter(s => !s.adminOnly && s.section !== 'compartilhamento').map((s): [string, ScopeLevel] => [s.key, 'read']),
  ),
  // O que o /fila usa, igual aos tokens migrados: sem Validação, que é sua.
  claude_fila: { ...LEGACY_SCOPES },
  finance_entry: {
    'financas.transacoes': 'write',
    'financas.orcamentos_metas': 'write',
    'financas.recorrentes': 'write',
    'financas.contas': 'read',
    'financas.categorias': 'read',
  },
}

export const PRESET_CHOICES: readonly PresetChoice[] = ['read_only', 'claude_fila', 'finance_entry', 'custom']

/** O preset que bate com as permissões; Personalizado quando nenhum bate; null sem permissão. */
export function presetOf(scopes: ScopeMap): PresetChoice | null {
  if (Object.keys(scopes).length === 0) return null
  return PRESET_CHOICES.find((key): key is PresetKey => key !== 'custom' && sameScopes(PRESETS[key], scopes)) ?? 'custom'
}

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEGACY_SCOPES } from '../_api/catalog.ts'
import { allows } from '../_api/scopes.ts'
import { ACTION_SCOPES, insufficientScope } from './scopeMap.ts'

// As ações saem do próprio index.ts (o mapa ACTIONS), que o Vitest não importa
// porque usa Deno.serve e jsr:.
const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const actionsBlock = index.slice(index.indexOf('const ACTIONS'), index.indexOf('Deno.serve'))
const ACTIONS = [...actionsBlock.matchAll(/^ {2}"([a-z_.]+)":/gm)].map(m => m[1])

describe('mapa de escopos da cards-api', () => {
  it('cobre exatamente as 17 ações do index.ts', () => {
    expect(ACTIONS).toHaveLength(17)
    expect(Object.keys(ACTION_SCOPES).sort()).toEqual([...ACTIONS].sort())
  })

  it('o token migrado roda o /fila, mas não valida nem converte quadro', () => {
    const allowed = ACTIONS.filter(a => allows(LEGACY_SCOPES, ACTION_SCOPES[a].sub, ACTION_SCOPES[a].level))
    expect(allowed.sort()).toEqual(ACTIONS.filter(a => a !== 'card.validate' && a !== 'board.setup_flow').sort())
  })

  it('validar exige Validação e converter o quadro exige Quadros: Excluir', () => {
    expect(ACTION_SCOPES['card.validate']).toEqual({ sub: 'projetos.validacao', level: 'write' })
    expect(ACTION_SCOPES['board.setup_flow']).toEqual({ sub: 'projetos.quadros', level: 'delete' })
    expect(allows({ ...LEGACY_SCOPES, 'projetos.validacao': 'write' }, 'projetos.validacao', 'write')).toBe(true)
  })

  it('leituras pedem só Ler', () => {
    for (const a of ['boards', 'cards.list', 'card.get', 'queue.list']) expect(ACTION_SCOPES[a].level).toBe('read')
  })

  it('o 403 diz a permissão e onde liberar', () => {
    expect(insufficientScope(ACTION_SCOPES['card.validate'])).toEqual({
      error: 'Este token não tem a permissão Projetos › Validação (aprovar/reprovar): Escrever. Libere editando o token ou gerando outro em Configurações → API.',
      code: 'insufficient_scope',
      required: 'projetos.validacao:write',
    })
  })
})

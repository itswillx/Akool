import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COVERAGE, coverageProblems, pendingByCard } from './coverage.ts'
import { REGISTRY } from './registry.ts'

// API-008: o manifesto bate 1:1 com o inventário (docs/api-inventario.json),
// todo id de ação existe no registro e o total pendente por card aparece na
// saída do teste. O API-063 exige zero pendentes.

interface Operation { id: string; target: string; never_reason?: string }
const inventory = JSON.parse(readFileSync(new URL('../../../docs/api-inventario.json', import.meta.url), 'utf8')) as { total: number; operacoes: Operation[] }
const actionIds = new Set(REGISTRY.map(a => a.id))

describe('manifesto de cobertura', () => {
  it('tem exatamente as operações do inventário', () => {
    expect(inventory.operacoes).toHaveLength(inventory.total)
    expect(Object.keys(COVERAGE).sort()).toEqual(inventory.operacoes.map(op => op.id).sort())
  })

  it('cada linha segue o inventário: never com o motivo, pending com o card, ou já entregue', () => {
    const drift = inventory.operacoes.flatMap(op => {
      const target = COVERAGE[op.id]
      if (op.target === 'never') return target === `never:${op.never_reason}` ? [] : [`${op.id}: esperava never`]
      if (target === `pending:${op.target}`) return []
      return actionIds.has(target) ? [] : [`${op.id}: esperava pending:${op.target} ou uma ação do registro`]
    })
    expect(drift).toEqual([])
  })

  it('todo id de ação existe no registro e todo alvo tem formato válido', () => {
    expect(coverageProblems(COVERAGE, actionIds)).toEqual([])
    expect(COVERAGE['api.meta.actions']).toBe('meta.acoes.listar')
  })

  it('id de ação inexistente e alvo mal formado são acusados', () => {
    expect(coverageProblems({ 'x.y': 'meta.acoes.sumiu', 'x.z': 'pending:API-8', 'x.w': 'never:' }, actionIds)).toEqual([
      'x.y: ação inexistente no registro (meta.acoes.sumiu)',
      'x.z: alvo mal formado (pending:API-8)',
      'x.w: alvo mal formado (never:)',
    ])
  })

  it('mostra o que falta por card', () => {
    const pending = pendingByCard(COVERAGE)
    const total = Object.values(pending).reduce((a, b) => a + b, 0)
    const lines = Object.entries(pending).sort(([a], [b]) => a.localeCompare(b)).map(([card, n]) => `${card}: ${n}`)
    console.log(`Cobertura da API: ${total} operações pendentes\n  ${lines.join('\n  ')}`)
    expect(pending['API-008']).toBeUndefined()
    expect(total).toBe(inventory.operacoes.filter(op => op.target !== 'never').length - 1)
    expect(pendingByCard({ a: 'pending:API-034', b: 'pending:API-034', c: 'never:x', d: 'meta.token.obter' })).toEqual({ 'API-034': 2 })
  })
})

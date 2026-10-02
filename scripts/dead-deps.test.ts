import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { evaluate, importedPackages, packageOf } from './dead-deps.mjs'

// DEV-010: a trava de dependências mortas acusa pacote sem uso e só aceita
// exceção com motivo e de pacote que existe.
describe('dead-deps', () => {
  it('reconhece o pacote de um especificador', () => {
    expect(packageOf('@scope/x/sub')).toBe('@scope/x')
    expect(packageOf('lodash-es/get')).toBe('lodash-es')
    expect(packageOf('./local')).toBeNull()
    expect(packageOf('node:fs')).toBeNull()
  })

  it('lê imports estáticos, dinâmicos e require', () => {
    const text = "import a from 'pkg-a'\nimport type { T } from '@s/b/types'\nconst c = await import('pkg-c')\nconst d = require('pkg-d')\nimport './local.css'"
    expect([...importedPackages(text)].sort()).toEqual(['@s/b', 'pkg-a', 'pkg-c', 'pkg-d'])
  })

  it('acusa dependência sem import e devDependency sem menção; aceita exceção com motivo', () => {
    const pkg = { dependencies: { used: '1', dead: '1', peer: '1' }, devDependencies: { tool: '1', unused: '1' } }
    const allow = [{ name: 'peer', motivo: 'peer dependency de outro pacote' }]
    const r = evaluate(pkg, allow, new Set(['used']), new Set(['tool']))
    expect(r.ok).toBe(false)
    expect(r.dead.map(d => d.name).sort()).toEqual(['dead', 'unused'])
    expect(r.badAllow).toEqual([])
  })

  it('exceção sem motivo ou de pacote inexistente é erro; exceção de pacote usado vira aviso', () => {
    const pkg = { dependencies: { used: '1' }, devDependencies: {} }
    const r = evaluate(pkg, [{ name: 'used', motivo: 'motivo longo o bastante' }, { name: 'ghost', motivo: 'motivo longo o bastante' }, { name: 'used', motivo: '' }], new Set(['used']), new Set())
    expect(r.stale).toEqual(['used'])
    expect(r.badAllow.map(b => b.reason).sort()).toEqual(['não está no package.json', 'sem motivo'])
    expect(r.ok).toBe(false)
  })
})

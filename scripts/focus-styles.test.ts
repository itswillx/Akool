import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// UX-004: o foco do teclado vem da regra global do src/index.css. Estilo
// inline vence qualquer regra de CSS, então um outline:none inline apaga o
// foco daquele elemento sem ninguém perceber. Foco próprio vai no CSS.

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.(ts|tsx)$/.test(p) && !p.includes('.test.') ? [p] : []
  })
}

describe('foco visível', () => {
  it('nenhum estilo inline zera o outline', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/outline:\s*(['"](none|0)['"]|0\b)/.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('o index.css tem o anel global de controles e de campos', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8')
    const rules = [...css.matchAll(/(:where\([^{]+\)):focus-visible\s*\{([^}]*)\}/g)]
    const controls = rules.find(([, selector]) => selector.includes('button') && selector.includes('a[href]'))
    const fields = rules.find(([, selector]) => selector.includes('textarea') && selector.includes('select'))
    for (const rule of [controls, fields]) {
      expect(rule?.[2]).toContain('outline: 2px solid var(--color-primary)')
    }
  })
})

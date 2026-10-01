import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// ARCH-001/002: nenhum arquivo dos módulos grandes passa de 600 linhas. O
// FinancePanel chegou a 5 mil; quebrar de novo custa mais do que manter.

const ROOT = join(__dirname, '..')
const LIMIT = 600
const MODULES = ['src/modules/finance', 'src/modules/projects']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(name) && !/\.(test|bench)\./.test(name) ? [path] : []
  })
}

describe('tamanho dos módulos', () => {
  it.each(MODULES)('%s: nenhum arquivo acima de 600 linhas', dir => {
    const big = files(join(ROOT, dir))
      .map(f => ({ file: relative(ROOT, f), lines: readFileSync(f, 'utf8').split('\n').length }))
      .filter(f => f.lines > LIMIT)
    expect(big).toEqual([])
  })
})

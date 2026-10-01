import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// ARCH-003: trava da camada de dados. Consultas ao banco (supabase.from/.rpc)
// ficam em src/lib (em especial src/lib/data/<domínio>.ts), num lugar só por
// domínio, e não espalhadas pelas telas. As chamadas que ainda existem fora de
// lá estão contadas por arquivo em scripts/data-layer-baseline.json: o número não
// pode subir. Pages e Projetos já estão em 0. Quando cair, rode
// `UPDATE_DATA_LAYER_BASELINE=1 npx vitest run scripts/data-layer.test.ts`.

const ROOT = join(__dirname, '..')
const BASELINE_PATH = join(ROOT, 'scripts/data-layer-baseline.json')

/** Chamadas `supabase.from(` / `supabase.rpc(` (também com quebra de linha antes do ponto). */
export function countDirectCalls(source: string): number {
  return source.match(/\bsupabase\s*\.\s*(from|rpc)\s*\(/g)?.length ?? 0
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(path) && !path.includes('.test.') ? [path] : []
  })
}

function currentCounts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file)
    if (rel.startsWith('src/lib/')) continue
    const n = countDirectCalls(readFileSync(file, 'utf8'))
    if (n > 0) out[rel] = n
  }
  return out
}

describe('countDirectCalls', () => {
  it('counts from/rpc on the client, across a line break too', () => {
    expect(countDirectCalls("supabase.from('t')\nawait supabase\n  .rpc('f')\nsupabase.storage.from('b')")).toBe(2)
  })
})

describe('camada de dados (ARCH-003)', () => {
  it('nenhum arquivo fora de src/lib ganha chamadas diretas', () => {
    const current = currentCounts()
    if (process.env.UPDATE_DATA_LAYER_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n')
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>
    const worse = Object.entries(current)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => `${file}: ${baseline[file] ?? 0} → ${n}`)
    expect(worse, 'use/crie funções em src/lib/data/<domínio>.ts').toEqual([])
  })

  it('Pages e Projetos continuam sem chamadas diretas', () => {
    const current = currentCounts()
    for (const file of [
      'src/contexts/PagesContext.tsx', 'src/modules/projects/ProjectsPanel.tsx',
      'src/modules/projects/QueueModal.tsx', 'src/modules/projects/boardLoader.ts',
    ]) {
      expect(current[file] ?? 0, file).toBe(0)
    }
  })
})

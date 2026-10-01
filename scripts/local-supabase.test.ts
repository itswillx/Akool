import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// DEV-006: o seed local e o .env.example das functions não podem sair de
// sincronia com o schema e o código.

const ROOT = join(__dirname, '..')
const seed = readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8')
const types = readFileSync(join(ROOT, 'src/types/database.ts'), 'utf8')

/** Colunas da linha (Row) de uma tabela de public no arquivo gerado. */
function rowColumns(table: string): Set<string> | null {
  const start = types.indexOf(`\n      ${table}: {\n        Row: {`)
  if (start === -1) return null
  const block = types.slice(start, types.indexOf('\n        }', start + 1))
  return new Set([...block.matchAll(/^ {10}([a-z0-9_]+):/gm)].map(m => m[1]))
}

describe('supabase/seed.sql', () => {
  it('só insere em tabelas e colunas que existem no schema', () => {
    const inserts = [...seed.matchAll(/insert into public\.([a-z_]+) \(([^)]+)\)/g)]
    expect(inserts.length).toBeGreaterThan(5)
    for (const [, table, cols] of inserts) {
      const known = rowColumns(table)
      expect(known, table).not.toBeNull()
      const missing = cols.split(',').map(c => c.trim()).filter(c => !known!.has(c))
      expect(missing, table).toEqual([])
    }
  })

  it('usa só domínios reservados (.test) nos e-mails', () => {
    const emails = [...seed.matchAll(/[a-z0-9._+-]+@[a-z0-9.-]+/gi)].map(m => m[0])
    expect(emails.length).toBeGreaterThan(0)
    expect(emails.filter(e => !e.endsWith('.test'))).toEqual([])
  })

  it('o staging:reset nunca lê o seed', () => {
    expect(readFileSync(join(ROOT, 'scripts/staging-reset.mjs'), 'utf8')).not.toMatch(/seed/i)
  })
})

describe('supabase/functions/.env.example', () => {
  const example = readFileSync(join(ROOT, 'supabase/functions/.env.example'), 'utf8')
  const declared = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map(m => m[1]))
  // Injetadas pelo Supabase em todo projeto (local e remoto).
  const INJECTED = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return path.endsWith('.ts') && !path.includes('.test.') ? [readFileSync(path, 'utf8')] : []
    })
  }

  it('declara toda variável que as functions leem', () => {
    const used = new Set(sources(join(ROOT, 'supabase/functions'))
      .flatMap(src => [...src.matchAll(/(?:Deno\.env\.get|\benv)\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)].map(m => m[1])))
    const missing = [...used].filter(name => !INJECTED.has(name) && !declared.has(name)).sort()
    expect(missing).toEqual([])
    expect(used.size).toBeGreaterThan(3)
  })
})

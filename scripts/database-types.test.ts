import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: módulo .mjs sem tipos
import { HEADER, TYPES_FILE } from './gen-db-types.mjs'
import { publicTablesFromMigrations } from './migrationTables'

// ARCH-004: src/types/database.ts vem do banco (npm run gen:types). Sem acesso
// ao banco no teste, a trava é pelo lado das migrations: tabela criada numa
// migration e ausente dos tipos = alguém aplicou a migration e não regenerou.

const source = readFileSync(TYPES_FILE, 'utf8')

/** Nomes das tabelas em `public.Tables` do arquivo gerado. */
export function generatedTables(text: string): Set<string> {
  const start = text.indexOf('    Tables: {')
  const end = text.indexOf('    Views: {', start)
  const block = text.slice(start, end)
  return new Set([...block.matchAll(/^ {6}([a-z0-9_]+): \{$/gm)].map(m => m[1]))
}

describe('tipos gerados do Supabase', () => {
  it('têm o cabeçalho do gerador', () => {
    expect(source.startsWith(HEADER)).toBe(true)
  })

  it('cobrem toda tabela de public criada pelas migrations', () => {
    const generated = generatedTables(source)
    const missing = [...publicTablesFromMigrations()].filter(t => !generated.has(t)).sort()
    expect(missing, 'rode `npm run gen:types`').toEqual([])
  })

  it('não têm tabela que as migrations já removeram', () => {
    const fromMigrations = publicTablesFromMigrations()
    const stale = [...generatedTables(source)].filter(t => !fromMigrations.has(t)).sort()
    expect(stale, 'rode `npm run gen:types`').toEqual([])
  })
})

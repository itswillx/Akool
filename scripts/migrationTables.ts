import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Leitura das migrations para os testes de paridade: site-backup (REL-001) e
// tipos gerados (ARCH-004).

export const MIGRATIONS_DIR = join(__dirname, '../supabase/migrations')

export function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }))
}

// Remove comentários de linha para não casar "create table" citado em prosa.
export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

// Tabelas de public criadas pelas migrations, menos as dropadas depois.
export function publicTablesFromMigrations(): Set<string> {
  const tables = new Set<string>()
  const name = String.raw`(?:public\.)?"?([a-z0-9_]+)"?`
  for (const { sql } of migrations()) {
    const clean = stripComments(sql)
    for (const m of clean.matchAll(new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?!private\.|storage\.|auth\.)${name}`, 'gi'))) {
      tables.add(m[1].toLowerCase())
    }
    for (const m of clean.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([^;]+);/gi)) {
      for (const part of m[1].split(',')) {
        const t = part.trim().replace(/\s+cascade$/i, '').replace(/^public\./i, '').replace(/"/g, '')
        tables.delete(t.toLowerCase())
      }
    }
  }
  return tables
}

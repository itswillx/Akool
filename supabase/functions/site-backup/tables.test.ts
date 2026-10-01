import { describe, expect, it } from 'vitest'
import { migrations, publicTablesFromMigrations, stripComments } from '../../../scripts/migrationTables.ts'
import { BACKUP_TABLES, EXCLUDED_TABLES } from './tables.ts'

// REL-001: paridade entre as listas do site-backup e as migrations. Um drift
// (tabela nova sem classificação, ou restore_order fora de ordem) passa a
// quebrar `npm test` em vez de derrubar o backup em produção em silêncio.

function latestRestoreOrder(): { file: string; order: string[] } {
  const withRestore = migrations().filter(m => /function\s+public\.restore_site_backup/i.test(m.sql))
  const latest = withRestore[withRestore.length - 1]
  const match = stripComments(latest.sql).match(/restore_order\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/i)
  if (!match) throw new Error(`restore_order não encontrado em ${latest.file}`)
  return { file: latest.file, order: [...match[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]) }
}

describe('site-backup: listas de tabelas', () => {
  it('não têm duplicatas nem interseção', () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length)
    expect(new Set(EXCLUDED_TABLES).size).toBe(EXCLUDED_TABLES.length)
    const excluded = new Set<string>(EXCLUDED_TABLES)
    expect(BACKUP_TABLES.filter(t => excluded.has(t))).toEqual([])
  })

  it('BACKUP_TABLES segue exatamente o restore_order da migration mais recente', () => {
    const { order } = latestRestoreOrder()
    expect([...BACKUP_TABLES]).toEqual(order)
  })

  it('toda tabela de public criada pelas migrations está classificada', () => {
    const known = new Set<string>([...BACKUP_TABLES, ...EXCLUDED_TABLES])
    const unclassified = [...publicTablesFromMigrations()].filter(t => !known.has(t)).sort()
    expect(unclassified).toEqual([])
  })

  it('nenhuma tabela listada deixou de existir nas migrations', () => {
    const existing = publicTablesFromMigrations()
    const gone = [...BACKUP_TABLES, ...EXCLUDED_TABLES].filter(t => !existing.has(t)).sort()
    expect(gone).toEqual([])
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEGACY_SCOPES, SUBSECTIONS } from './catalog.ts'

// O catálogo vive em dois lugares: aqui (canônico) e em private.api_scope_catalog,
// semeada pela migration do API-001. Mudou um, muda o outro (numa migration nova
// que também entre aqui).
const MIGRATIONS = new URL('../../migrations/', import.meta.url)

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find(f => f.endsWith(suffix))
  if (!file) throw new Error(`migration *${suffix} não encontrada`)
  return readFileSync(new URL(file, MIGRATIONS), 'utf8')
}

const sql = migration('_api001_token_scopes.sql')

describe('paridade do catálogo com a migration api001_token_scopes', () => {
  it('as linhas semeadas batem com SUBSECTIONS, na mesma ordem', () => {
    const insert = sql.match(/insert into private\.api_scope_catalog \(key, section, label, max_level, admin_only\) values([\s\S]+?);\n/)
    expect(insert).not.toBeNull()
    const rows = [...insert![1].matchAll(/\('([^']+)', '([^']+)', '([^']+)', '([^']+)', (true|false)\)/g)].map(m => ({
      key: m[1],
      section: m[2],
      label: m[3],
      maxLevel: m[4],
      adminOnly: m[5] === 'true',
    }))
    expect(rows).toEqual(SUBSECTIONS.map(s => ({ ...s })))
  })

  it('o preset legado da migration é LEGACY_SCOPES', () => {
    const body = sql.match(/function private\.api_legacy_scopes\(\)[\s\S]+?select '([^']+)'::jsonb/)
    expect(body).not.toBeNull()
    expect(JSON.parse(body![1])).toEqual(LEGACY_SCOPES)
  })
})

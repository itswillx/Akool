import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos; a lógica pura é o que importa aqui.
import { compareFunctions, compareMigrations, diffSnapshot, repoFunctionSlugs, summarizeAdvisors } from './supabase-drift.mjs'

// DEV-005: o check de drift entre o Supabase remoto e o repositório.

const ROOT = join(__dirname, '..')
const toml = '[functions.site-backup]\nverify_jwt = false\n'

describe('supabase-drift: functions', () => {
  const slugs = repoFunctionSlugs([
    { name: '_shared', isDir: true, hasIndex: false },
    { name: 'admin-ops', isDir: true, hasIndex: true },
    { name: 'site-backup', isDir: true, hasIndex: true },
    { name: 'README.md', isDir: false, hasIndex: false },
  ])

  it('lista só as pastas com index.ts, sem as de _', () => {
    expect(slugs).toEqual(['admin-ops', 'site-backup'])
  })

  it('acusa órfã, não publicada e verify_jwt diferente do config.toml', () => {
    const problems = compareFunctions(slugs, [
      { slug: 'site-backup', verify_jwt: true },
      { slug: 'google-calendar', verify_jwt: true },
    ], toml)
    expect(problems).toEqual([
      'function admin-ops: está no repo e não foi publicada',
      'function site-backup: verify_jwt remoto=true, config.toml=false',
      'function google-calendar: publicada sem fonte no repo (órfã)',
    ])
  })

  it('órfã na lista de exceções não acusa', () => {
    expect(compareFunctions(slugs, [
      { slug: 'admin-ops', verify_jwt: true }, { slug: 'site-backup', verify_jwt: false }, { slug: 'legado', verify_jwt: true },
    ], toml, { remoteOnlyFunctions: ['legado'] })).toEqual([])
  })
})

describe('supabase-drift: migrations', () => {
  const allowlist = { repoOnlyMigrations: ['baseline_remote_schema'], remoteOnlyMigrationsUntil: '20260627015918' }

  it('pelo nome; histórico antigo e baseline são exceção', () => {
    expect(compareMigrations(['baseline_remote_schema', 'a', 'b'], [
      { version: '20260101000000', name: 'antiga_sem_arquivo' },
      { version: '20260901000000', name: 'a' },
      { version: '20260902000000', name: 'b' },
    ], allowlist)).toEqual([])
  })

  it('acusa migration pendente e migration aplicada fora do repo', () => {
    expect(compareMigrations(['a', 'nova'], [
      { version: '20260901000000', name: 'a' },
      { version: '20260930000000', name: 'feita_no_painel' },
    ], allowlist)).toEqual([
      'migration nova: está no repo e não foi aplicada',
      'migration feita_no_painel (20260930000000): aplicada sem arquivo no repo',
    ])
  })

  it('a lista de exceções bate com o repositório', () => {
    const real = JSON.parse(readFileSync(join(ROOT, 'supabase/drift-allowlist.json'), 'utf8')) as { repoOnlyMigrations: string[] }
    const files = readdirSync(join(ROOT, 'supabase/migrations'))
    for (const name of real.repoOnlyMigrations) expect(files.some(f => f.endsWith(`_${name}.sql`)), name).toBe(true)
  })
})

describe('supabase-drift: schema', () => {
  it('aponta o que surgiu, sumiu e mudou', () => {
    expect(diffSnapshot(
      { policies: { 'public.pages.select': 'x', 'public.pages.old': 'y' }, cron: {} },
      { policies: { 'public.pages.select': 'z', 'public.pages.new': 'w' }, cron: {} },
    )).toEqual([
      'policies: public.pages.new surgiu fora do repo',
      'policies: public.pages.select mudou',
      'policies: public.pages.old sumiu',
    ])
  })

  it('o retrato versionado tem todas as seções da consulta', () => {
    const snapshot = JSON.parse(readFileSync(join(ROOT, 'supabase/schema-snapshot.json'), 'utf8')) as Record<string, object>
    const sql = readFileSync(join(ROOT, 'supabase/checks/schema-snapshot.sql'), 'utf8')
    const sections = [...sql.matchAll(/^ {2}'([a-z]+)', \(/gm)].map(m => m[1]).sort()
    expect(Object.keys(snapshot).sort()).toEqual(sections)
    expect(Object.keys(snapshot.tables).length).toBeGreaterThan(40)
  })
})

describe('supabase-drift: advisors', () => {
  it('conta por nível e lista as regras de ERROR', () => {
    expect(summarizeAdvisors([
      { level: 'WARN', name: 'function_search_path_mutable' },
      { level: 'ERROR', name: 'rls_disabled_in_public' },
      { level: 'ERROR', name: 'rls_disabled_in_public' },
    ])).toEqual({ byLevel: { WARN: 1, ERROR: 2 }, errors: ['rls_disabled_in_public'] })
  })
})

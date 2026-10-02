#!/usr/bin/env node
// DEV-005: o Supabase remoto ainda é o que o repositório diz? Compara, pela
// Management API (só leitura):
//   • functions: pastas de supabase/functions/ × publicadas, e verify_jwt × config.toml;
//   • migrations: nomes dos arquivos × ledger remoto (o fluxo é MCP-only, então as
//     versões antigas não batem por desenho; ver supabase/migrations/README.md);
//   • schema: supabase/checks/schema-snapshot.sql × supabase/schema-snapshot.json;
//   • advisors de segurança e performance (só relatório).
//
//   npm run drift                          produção
//   npm run drift -- --project-ref=<ref>   outro projeto (ex.: staging)
//   npm run drift -- --write               regrava supabase/schema-snapshot.json a
//                                          partir da produção (depois de uma migration)
//
// Sai com erro se houver drift. Lê SUPABASE_ACCESS_TOKEN do ambiente/.env.local.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PRODUCTION_REF, migrationFiles, verifyJwtFor } from './staging-reset.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.supabase.com/v1'

/** Slugs das functions do repositório (pastas com index.ts, sem as de `_`). */
export function repoFunctionSlugs(entries) {
  return entries.filter(e => e.isDir && !e.name.startsWith('_') && e.hasIndex).map(e => e.name).sort()
}

export function compareFunctions(repoSlugs, remote, toml, allowlist = {}) {
  const allowed = new Set(allowlist.remoteOnlyFunctions ?? [])
  const remoteBySlug = new Map(remote.map(f => [f.slug, f]))
  const problems = []
  for (const slug of repoSlugs) {
    const fn = remoteBySlug.get(slug)
    if (!fn) problems.push(`function ${slug}: está no repo e não foi publicada`)
    else if (fn.verify_jwt !== verifyJwtFor(slug, toml)) {
      problems.push(`function ${slug}: verify_jwt remoto=${fn.verify_jwt}, config.toml=${verifyJwtFor(slug, toml)}`)
    }
  }
  for (const fn of remote) {
    if (!repoSlugs.includes(fn.slug) && !allowed.has(fn.slug)) problems.push(`function ${fn.slug}: publicada sem fonte no repo (órfã)`)
  }
  return problems
}

export function compareMigrations(repoNames, remote, allowlist = {}) {
  const repoOnlyOk = new Set(allowlist.repoOnlyMigrations ?? [])
  const until = allowlist.remoteOnlyMigrationsUntil ?? ''
  const remoteNames = new Set(remote.map(m => m.name))
  const repo = new Set(repoNames)
  const problems = []
  for (const name of repoNames) {
    if (!remoteNames.has(name) && !repoOnlyOk.has(name)) problems.push(`migration ${name}: está no repo e não foi aplicada`)
  }
  for (const m of remote) {
    if (!repo.has(m.name) && !(until && m.version <= until)) problems.push(`migration ${m.name} (${m.version}): aplicada sem arquivo no repo`)
  }
  return problems
}

/** Diferença entre dois retratos: o que surgiu, sumiu ou mudou, por seção. */
export function diffSnapshot(expected, actual) {
  const problems = []
  for (const section of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    const a = expected[section] ?? {}
    const b = actual[section] ?? {}
    for (const key of Object.keys(b).sort()) {
      if (!(key in a)) problems.push(`${section}: ${key} surgiu fora do repo`)
      else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) problems.push(`${section}: ${key} mudou`)
    }
    for (const key of Object.keys(a).sort()) {
      if (!(key in b)) problems.push(`${section}: ${key} sumiu`)
    }
  }
  return problems
}

/** Advisors por nível (ERROR/WARN/INFO), com os nomes das regras de ERROR. */
export function summarizeAdvisors(lints) {
  const byLevel = {}
  const errors = new Set()
  for (const l of lints) {
    byLevel[l.level] = (byLevel[l.level] ?? 0) + 1
    if (l.level === 'ERROR') errors.add(l.name)
  }
  return { byLevel, errors: [...errors].sort() }
}

async function api(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${typeof data === 'object' ? data?.message ?? '' : data}`)
  return data
}

async function main() {
  try { process.loadEnvFile(join(ROOT, '.env.local')) } catch { /* só o ambiente */ }
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN não definido.')
  const ref = process.argv.find(a => a.startsWith('--project-ref='))?.split('=')[1] ?? PRODUCTION_REF
  const write = process.argv.includes('--write')
  if (write && ref !== PRODUCTION_REF) throw new Error('--write regrava o retrato versionado, que é o da produção: use sem --project-ref.')
  const allowlist = JSON.parse(readFileSync(join(ROOT, 'supabase/drift-allowlist.json'), 'utf8'))
  const toml = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8')
  const functionsDir = join(ROOT, 'supabase/functions')
  const slugs = repoFunctionSlugs(readdirSync(functionsDir, { withFileTypes: true }).map(d => ({
    name: d.name, isDir: d.isDirectory(), hasIndex: existsSync(join(functionsDir, d.name, 'index.ts')),
  })))
  const repoMigrations = migrationFiles(readdirSync(join(ROOT, 'supabase/migrations'))).map(m => m.name)

  const [functions, migrations, snapshotRows, security, performance] = await Promise.all([
    api(token, `/projects/${ref}/functions`),
    api(token, `/projects/${ref}/database/migrations`),
    api(token, `/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: readFileSync(join(ROOT, 'supabase/checks/schema-snapshot.sql'), 'utf8') }),
    }),
    api(token, `/projects/${ref}/advisors/security`).catch(err => ({ lints: [], error: String(err) })),
    api(token, `/projects/${ref}/advisors/performance`).catch(err => ({ lints: [], error: String(err) })),
  ])

  const problems = [
    ...compareFunctions(slugs, functions, toml, allowlist),
    ...compareMigrations(repoMigrations, migrations, allowlist),
  ]
  // O retrato versionado é o da produção; em outro projeto ele só vale se o
  // schema for o mesmo (é o caso do staging recriado pelo staging:reset).
  const actual = snapshotRows?.[0]?.snapshot ?? {}
  if (write) {
    // Ordem natural do jsonb (chaves por tamanho e depois bytes): é como a API
    // devolve, e a comparação acima é por JSON.stringify.
    writeFileSync(join(ROOT, 'supabase/schema-snapshot.json'), JSON.stringify(actual, null, 2) + '\n')
    console.log('Retrato regravado em supabase/schema-snapshot.json a partir da produção.')
  }
  const expected = JSON.parse(readFileSync(join(ROOT, 'supabase/schema-snapshot.json'), 'utf8'))
  // O staging desliga o cron de backup de propósito (staging:reset).
  if (ref !== PRODUCTION_REF) { delete expected.cron; delete actual.cron }
  problems.push(...diffSnapshot(expected, actual))

  console.log(`Projeto ${ref}: ${functions.length} functions, ${migrations.length} migrations no ledger.`)
  for (const [name, report] of [['segurança', security], ['performance', performance]]) {
    if (report.error) { console.log(`Advisors de ${name}: indisponível (${report.error})`); continue }
    const { byLevel, errors } = summarizeAdvisors(report.lints ?? [])
    console.log(`Advisors de ${name}: ${JSON.stringify(byLevel)}${errors.length ? ` · ERROR: ${errors.join(', ')}` : ''}`)
  }
  if (problems.length > 0) {
    console.error(`\n✗ Drift (${problems.length}):`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('\nMudança legítima? Versione no repo (migration/function) e regrave o retrato (supabase/schema-snapshot.json).')
    process.exit(1)
  }
  console.log('✓ Sem drift: o remoto bate com o repositório.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(`✗ ${err instanceof Error ? err.message : String(err)}`); process.exit(1) })
}

#!/usr/bin/env node
// DEV-002: monta o projeto de STAGING a partir do repositório, pela Management
// API do Supabase. Nunca toca na produção: o ref da produção é recusado.
//
//   npm run staging:reset                 migrations + passos do staging + functions
//   npm run staging:reset -- --migrations só as migrations (pula as já aplicadas, pelo nome)
//   npm run staging:reset -- --from=<arquivo.sql>   retoma a partir desse arquivo
//   npm run staging:reset -- --functions [--only=<slug>]
//   npm run staging:reset -- --post       só os passos do staging (cron de backup desligado)
//
// Lê do .env.local: SUPABASE_ACCESS_TOKEN (token pessoal, supabase.com/dashboard/
// account/tokens) e STAGING_PROJECT_REF. O token nunca é impresso.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions')
const CONFIG_TOML = join(ROOT, 'supabase', 'config.toml')
const API = 'https://api.supabase.com/v1'

export const PRODUCTION_REF = 'nhfftophadasiezrzlsv'

/** O ref precisa existir, ter o formato de um ref e NÃO ser o da produção. */
export function assertStagingRef(ref) {
  if (!ref) throw new Error('STAGING_PROJECT_REF não definido (.env.local).')
  if (!/^[a-z]{20}$/.test(ref)) throw new Error(`STAGING_PROJECT_REF inválido: ${ref}`)
  if (ref === PRODUCTION_REF) throw new Error('STAGING_PROJECT_REF é o da PRODUÇÃO: recusado.')
  return ref
}

/** Arquivos de migration em ordem, com versão e nome (o que vai para o ledger). */
export function migrationFiles(names) {
  return names
    .filter(f => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map(file => ({ file, version: file.slice(0, 14), name: file.slice(15, -4) }))
}

/** O que falta aplicar: nomes fora do ledger, a partir de `from` (se houver). */
export function pendingMigrations(files, appliedNames, from) {
  const start = from ? files.findIndex(m => m.file === from || m.name === from) : 0
  if (start === -1) throw new Error(`--from: ${from} não está em supabase/migrations/`)
  const applied = new Set(appliedNames)
  return files.slice(start).filter(m => !applied.has(m.name))
}

/** `verify_jwt` de cada function no config.toml (o padrão do Supabase é true). */
export function verifyJwtFor(slug, toml) {
  const section = toml.match(new RegExp(String.raw`^\[functions\.${slug}\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))`, 'm'))
  const value = section?.[1].match(/^verify_jwt\s*=\s*(true|false)/m)?.[1]
  return value !== 'false'
}

/** Imports relativos de um arquivo .ts (`from "./x.ts"`, `from "../_shared/y.ts"`). */
export function relativeImports(source) {
  return [...source.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(m => m[1])
}

/**
 * Os arquivos que uma function precisa, com o caminho relativo a
 * supabase/functions/ (ex.: `admin-ops/index.ts`, `_shared/cors.ts`): o
 * entrypoint e tudo o que ele importa por caminho relativo. `read(path)` lê do
 * disco (trocável no teste).
 */
export function functionBundle(slug, read) {
  const files = new Map()
  const visit = relPath => {
    if (files.has(relPath)) return
    const source = read(relPath)
    files.set(relPath, source)
    for (const spec of relativeImports(source)) {
      visit(posix.normalize(posix.join(posix.dirname(relPath), spec)))
    }
  }
  visit(`${slug}/index.ts`)
  return files
}

// ── Management API ───────────────────────────────────────────────────────────

function client(token, ref) {
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${API}/projects/${ref}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }
  return {
    listMigrations: () => call('GET', '/database/migrations'),
    applyMigration: (name, query) => call('POST', '/database/migrations', { name, query }, { 'Idempotency-Key': name }),
    query: sql => call('POST', '/database/query', { query: sql }),
    deployFunction: (slug, form) => call('POST', `/functions/deploy?slug=${encodeURIComponent(slug)}`, form),
  }
}

const errorText = r => (typeof r.data === 'object' && r.data?.message) || (typeof r.data === 'string' ? r.data : JSON.stringify(r.data))
const sqlString = s => `'${s.replace(/'/g, "''")}'`

async function applyMigrations(api, from) {
  const files = migrationFiles(readdirSync(MIGRATIONS_DIR))
  const ledger = await api.listMigrations()
  if (!ledger.ok) throw new Error(`listar migrations: HTTP ${ledger.status} ${errorText(ledger)}`)
  const pending = pendingMigrations(files, (ledger.data ?? []).map(m => m.name), from)
  console.log(`Migrations: ${files.length} no repo, ${pending.length} a aplicar.`)
  let useQueryFallback = false
  for (const [i, m] of pending.entries()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, m.file), 'utf8')
    let r = useQueryFallback ? null : await api.applyMigration(m.name, sql)
    // O endpoint de migrations pode não estar liberado para o token: roda o SQL
    // pelo /database/query e grava o ledger à mão (mesma tabela do CLI).
    if (r && (r.status === 403 || r.status === 404)) {
      useQueryFallback = true
      console.log('  (endpoint de migrations indisponível: usando /database/query)')
      r = null
    }
    if (!r) {
      r = await api.query(sql)
      if (r.ok) {
        const ledgerRow = await api.query(
          'create schema if not exists supabase_migrations; ' +
          'create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text); ' +
          `insert into supabase_migrations.schema_migrations (version, name) values (${sqlString(m.version)}, ${sqlString(m.name)}) on conflict (version) do nothing;`)
        if (!ledgerRow.ok) throw new Error(`ledger de ${m.file}: HTTP ${ledgerRow.status} ${errorText(ledgerRow)}`)
      }
    }
    if (!r.ok) {
      console.error(`✗ ${m.file}: HTTP ${r.status} ${errorText(r)}`)
      console.error(`  Corrija o arquivo e retome com: npm run staging:reset -- --migrations --from=${m.file}`)
      process.exit(1)
    }
    console.log(`✓ ${i + 1}/${pending.length} ${m.file}`)
  }
}

// Passos que só fazem sentido no staging.
const STAGING_ONLY_SQL = [
  // REL-008: sem os segredos no Vault o backup automático só falharia.
  "select cron.unschedule(jobid) from cron.job where jobname = 'site-backup-auto'",
]

async function stagingSteps(api) {
  for (const sql of STAGING_ONLY_SQL) {
    const r = await api.query(sql)
    if (!r.ok) throw new Error(`passo do staging falhou: HTTP ${r.status} ${errorText(r)}`)
  }
  console.log('✓ Passos do staging (cron de backup desligado).')
}

async function deployFunctions(api, only) {
  const toml = readFileSync(CONFIG_TOML, 'utf8')
  const slugs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(FUNCTIONS_DIR, d.name, 'index.ts')))
    .map(d => d.name)
    .filter(slug => !only || slug === only)
  if (only && slugs.length === 0) throw new Error(`--only: function ${only} não existe em supabase/functions/`)
  for (const slug of slugs) {
    const bundle = functionBundle(slug, rel => readFileSync(join(FUNCTIONS_DIR, rel), 'utf8'))
    const form = new FormData()
    form.append('metadata', JSON.stringify({ name: slug, entrypoint_path: `${slug}/index.ts`, verify_jwt: verifyJwtFor(slug, toml) }))
    for (const [rel, source] of bundle) form.append('file', new Blob([source], { type: 'application/typescript' }), rel)
    const r = await api.deployFunction(slug, form)
    if (!r.ok) throw new Error(`deploy de ${slug}: HTTP ${r.status} ${errorText(r)}`)
    console.log(`✓ function ${slug} (${bundle.size} arquivo(s), verify_jwt=${verifyJwtFor(slug, toml)})`)
  }
}

async function main() {
  try { process.loadEnvFile(join(ROOT, '.env.local')) } catch { /* sem .env.local: só o ambiente */ }
  const args = process.argv.slice(2)
  const arg = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN não definido (.env.local).')
  const ref = assertStagingRef(process.env.STAGING_PROJECT_REF)
  const api = client(token, ref)
  const only = flag => args.includes(`--${flag}`)
  const all = !only('migrations') && !only('functions') && !only('post') && !arg('from')

  console.log(`Staging: ${ref}`)
  if (all || only('migrations') || arg('from')) await applyMigrations(api, arg('from'))
  if (all || only('post')) await stagingSteps(api)
  if (all || only('functions')) await deployFunctions(api, arg('only'))
  console.log(`Pronto. Confira os tipos: o generate_typescript_types do staging deve bater com ${relative(ROOT, join(ROOT, 'src/types/database.ts'))}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(`✗ ${err instanceof Error ? err.message : String(err)}`); process.exit(1) })
}

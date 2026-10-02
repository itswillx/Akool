#!/usr/bin/env node
// DEV-010: dependência que ninguém importa não fica no package.json (11 delas
// saíram em 01/10/2026). Sem dependência nova: varre o repo e exige que cada
// `dependency` tenha um import/require em src/, scripts/, e2e/,
// supabase/functions/ ou nos configs da raiz, e que cada `devDependency` seja
// mencionada em algum script, config ou workflow. Exceções, com motivo, em
// scripts/dead-deps-allowlist.json (peers, tipos implícitos, plugins).
//
// Uso: node scripts/dead-deps.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const CODE_DIRS = ['src', 'scripts', 'e2e', 'supabase/functions']
const CONFIG_FILES = ['vite.config.ts', 'eslint.config.js', 'playwright.config.ts', 'postcss.config.js', 'index.html',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.e2e.json', 'nixpacks.toml']
const MENTION_DIRS = ['.github', '.githooks']
const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.html', '.css'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') && dir.endsWith('scripts')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Nome do pacote num especificador de import (`@scope/x/sub` → `@scope/x`). */
export function packageOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Pacotes importados num texto (import … from, import(), require()). */
export function importedPackages(text) {
  const out = new Set()
  for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s*)['"]([^'"\n]+)['"]/gm)) {
    const pkg = packageOf(m[1])
    if (pkg) out.add(pkg)
  }
  return out
}

/**
 * O veredito: `dead` = dependências sem import e devDependencies sem menção,
 * fora das exceções; `badAllow` = exceção sem motivo ou de pacote que não
 * existe mais; `stale` = exceção de pacote que voltou a ser usado (aviso).
 */
export function evaluate({ dependencies = {}, devDependencies = {} }, allowlist, imported, mentioned) {
  const all = { ...dependencies, ...devDependencies }
  const allowed = new Map()
  const badAllow = []
  for (const e of allowlist) {
    if (!e || typeof e.name !== 'string' || typeof e.motivo !== 'string' || e.motivo.trim().length < 10) { badAllow.push({ name: e?.name ?? '?', reason: 'sem motivo' }); continue }
    if (!(e.name in all)) { badAllow.push({ name: e.name, reason: 'não está no package.json' }); continue }
    allowed.set(e.name, e)
  }
  const dead = []
  const stale = []
  for (const name of Object.keys(dependencies)) {
    const used = imported.has(name)
    if (used && allowed.has(name)) stale.push(name)
    if (!used && !allowed.has(name)) dead.push({ name, kind: 'dependency', reason: 'nenhum import' })
  }
  for (const name of Object.keys(devDependencies)) {
    const used = mentioned.has(name)
    if (used && allowed.has(name)) stale.push(name)
    if (!used && !allowed.has(name)) dead.push({ name, kind: 'devDependency', reason: 'nenhuma menção' })
  }
  return { ok: dead.length === 0 && badAllow.length === 0, dead, badAllow, stale }
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const allowlist = JSON.parse(readFileSync(join(root, 'scripts/dead-deps-allowlist.json'), 'utf8'))

  const codeFiles = [...CODE_DIRS.flatMap(d => walk(join(root, d))).filter(f => CODE_EXTS.has(extname(f))), ...CONFIG_FILES.map(f => join(root, f))]
  const imported = new Set()
  for (const f of codeFiles) {
    try { for (const p of importedPackages(readFileSync(f, 'utf8'))) imported.add(p) } catch { /* arquivo opcional */ }
  }

  const mentionFiles = [...codeFiles, ...MENTION_DIRS.flatMap(d => walk(join(root, d)))]
  const scriptsText = Object.values(pkg.scripts ?? {}).join('\n')
  const mentioned = new Set()
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  const texts = [scriptsText, ...mentionFiles.map(f => { try { return readFileSync(f, 'utf8') } catch { return '' } })]
  for (const name of names) if (texts.some(t => t.includes(name))) mentioned.add(name)

  const { ok, dead, badAllow, stale } = evaluate(pkg, allowlist, imported, mentioned)
  for (const s of stale) console.log(`  · aviso: ${s} está na allowlist mas é usado; a exceção pode sair`)
  if (!ok) {
    for (const d of dead) console.error(`✗ ${d.name} (${d.kind}): ${d.reason} em ${CODE_DIRS.join(', ')} nem nos configs`)
    for (const b of badAllow) console.error(`✗ exceção inválida: ${b.name} — ${b.reason}`)
    console.error('Remova o pacote (npm uninstall) ou registre a exceção com motivo em scripts/dead-deps-allowlist.json.')
    process.exit(1)
  }
  console.log(`✓ ${names.length} pacotes do package.json em uso (${allowlist.length} exceção(ões)); ${relative(root, codeFiles[0])}… varridos.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()

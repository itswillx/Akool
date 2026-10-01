#!/usr/bin/env node
// DEV-008: gate do `npm audit` no CI, sem dependências. Falha em advisory
// `high` ou `critical` nas dependências de produção (`--omit=dev`) que não
// esteja em scripts/audit-allowlist.json. Cada exceção tem o GHSA, o pacote, o
// motivo e uma validade (`ate`, AAAA-MM-DD): vencida, volta a falhar. O
// Dependabot abre os PRs de correção; conforme entram, as exceções saem.
//
// Uso: node scripts/audit-gate.mjs            (roda o npm audit)
//      node scripts/audit-gate.mjs --report=audit.json --today=2026-10-01
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BLOCKING = new Set(['high', 'critical'])

/** Advisories bloqueantes do relatório do `npm audit --json`: id (GHSA), pacote, severidade, título. */
export function blockingAdvisories(report) {
  const out = new Map()
  for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue
      const id = String(via.url ?? '').split('/').pop() || `source-${via.source}`
      if (!out.has(id)) out.set(id, { id, package: via.name ?? pkg, severity: via.severity, title: via.title ?? '' })
    }
  }
  return [...out.values()]
}

/** O veredito: `ok` sem bloqueio, senão as falhas (novo, ou exceção vencida). */
export function evaluate(report, allowlist, today) {
  const allowed = new Map(allowlist.map(e => [e.id, e]))
  const failures = []
  const ignored = []
  for (const adv of blockingAdvisories(report)) {
    const entry = allowed.get(adv.id)
    if (!entry) { failures.push({ ...adv, reason: 'sem exceção' }); continue }
    if (entry.ate < today) { failures.push({ ...adv, reason: `exceção vencida em ${entry.ate}` }); continue }
    ignored.push({ ...adv, ate: entry.ate })
  }
  return { ok: failures.length === 0, failures, ignored }
}

function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    // npm audit sai com código 1 quando há vulnerabilidade; o JSON vem no stdout.
    if (err && typeof err.stdout === 'string' && err.stdout.trim().startsWith('{')) return err.stdout
    throw err
  }
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const report = JSON.parse(args.report ? readFileSync(args.report, 'utf8') : runAudit())
  const allowlist = JSON.parse(readFileSync(join(__dirname, 'audit-allowlist.json'), 'utf8'))
  const today = typeof args.today === 'string' ? args.today : new Date().toISOString().slice(0, 10)
  const { ok, failures, ignored } = evaluate(report, allowlist, today)
  const counts = report.metadata?.vulnerabilities ?? {}
  console.log(`npm audit (produção): ${JSON.stringify(counts)}`)
  for (const i of ignored) console.log(`  · exceção até ${i.ate}: ${i.id} ${i.package} (${i.severity})`)
  if (!ok) {
    console.error(`✗ ${failures.length} advisory(ies) ${[...BLOCKING].join('/')} sem exceção válida:`)
    for (const f of failures) console.error(`  - ${f.id} ${f.package} (${f.severity}): ${f.title} — ${f.reason}`)
    console.error('Corrija pelo PR do Dependabot ou registre a exceção com motivo e validade em scripts/audit-allowlist.json.')
    process.exit(1)
  }
  console.log(`✓ Sem advisory ${[...BLOCKING].join('/')} fora das exceções (${ignored.length} exceção(ões) ativa(s)).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()

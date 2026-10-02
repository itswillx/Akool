#!/usr/bin/env node
// QA-001: trava da cobertura de testes, por pasta. Lê o resumo do
// `vitest run --coverage` (coverage/coverage-summary.json) e compara a
// cobertura de LINHAS de cada pasta com scripts/coverage-baseline.json.
//
//   npm run test:coverage                            testes + cobertura + trava
//   node scripts/coverage-ratchet.mjs --update       regrava a base (recusa se caiu)
//   node scripts/coverage-ratchet.mjs --allow-moves  regrava mesmo com pasta em queda,
//                                                    desde que o total geral não caia
//                                                    (ARCH-006: arquivo testado mudou de pasta)
//
// Código novo sem teste numa pasta baixa a porcentagem dela: a trava pede
// teste junto. A folga (TOLERANCE) absorve mudanças pequenas. A base guarda
// também o total geral ("total"), que nunca pode cair além da folga.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json')
const BASELINE = join(ROOT, 'scripts', 'coverage-baseline.json')

/** Pontos percentuais que uma pasta pode cair sem falhar. */
export const TOLERANCE = 0.25

/** Pasta de um arquivo: src/modules/<módulo>, supabase/functions/<função> ou src/<pasta>. */
export function groupOf(rel) {
  const parts = rel.split('/')
  if (parts[0] === 'src' && parts[1] === 'modules' && parts.length > 3) return parts.slice(0, 3).join('/')
  if (parts[0] === 'supabase' && parts[1] === 'functions' && parts.length > 3) return parts.slice(0, 3).join('/')
  if (parts.length > 2) return parts.slice(0, 2).join('/')
  return parts[0]
}

/** Resumo do v8 → % de linhas cobertas por pasta (2 casas). */
export function coverageByGroup(summary, root) {
  const acc = {}
  for (const [file, metrics] of Object.entries(summary)) {
    if (file === 'total') continue
    const group = groupOf(relative(root, file).split('\\').join('/'))
    const g = (acc[group] ??= { covered: 0, total: 0 })
    g.covered += metrics.lines.covered
    g.total += metrics.lines.total
  }
  const out = Object.fromEntries(Object.entries(acc)
    .filter(([, g]) => g.total > 0)
    .map(([group, g]) => [group, Math.round((g.covered / g.total) * 10000) / 100]))
  // ARCH-006: o total geral entra como "total" e é o que --allow-moves confere.
  const total = summary.total?.lines
  if (typeof total?.pct === 'number') out.total = Math.round(total.pct * 100) / 100
  return out
}

/**
 * ARCH-006: com --allow-moves, uma pasta pode cair (arquivo testado mudou de
 * pasta) desde que o total geral não tenha caído além da folga.
 */
export function movesTolerated(baseline, current, worse, tolerance = TOLERANCE) {
  if (baseline.total === undefined) return { ok: false, reason: 'a base não tem o total geral (rode --update antes de mover)' }
  if (worse.some(w => w.group === 'total') || current.total < baseline.total - tolerance) {
    return { ok: false, reason: `o total geral caiu (${baseline.total}% → ${current.total}%)` }
  }
  return { ok: true }
}

/** Pastas que caíram além da folga, as que subiram e as que ainda não têm base. */
export function compareCoverage(baseline, current, tolerance = TOLERANCE) {
  const worse = []
  const better = []
  const unbased = []
  for (const [group, now] of Object.entries(current)) {
    const base = baseline[group]
    if (base === undefined) unbased.push({ group, now })
    else if (now < base - tolerance) worse.push({ group, base, now })
    else if (now > base) better.push({ group, base, now })
  }
  return { worse, better, unbased }
}

function sortedJson(obj) {
  return JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
}

function main() {
  if (!existsSync(SUMMARY)) {
    console.error('coverage/coverage-summary.json não existe: rode `npm run test:coverage`.')
    process.exit(1)
  }
  const current = coverageByGroup(JSON.parse(readFileSync(SUMMARY, 'utf8')), ROOT)
  const update = process.argv.includes('--update')
  if (update && !existsSync(BASELINE)) {
    writeFileSync(BASELINE, sortedJson(current))
    console.log(`Base de cobertura criada: ${Object.keys(current).length} pasta(s).`)
    return
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
  const allowMoves = process.argv.includes('--allow-moves')
  const { worse, better, unbased } = compareCoverage(baseline, current)

  if (worse.length > 0) {
    const moves = allowMoves ? movesTolerated(baseline, current, worse) : { ok: false }
    if (!moves.ok) {
      console.error('✗ Cobertura de linhas caiu (folga de ' + TOLERANCE + ' p.p.):\n')
      for (const { group, base, now } of worse) console.error(`  ${group}: ${base}% → ${now}%`)
      if (allowMoves) console.error(`\n--allow-moves recusado: ${moves.reason}.`)
      else console.error(update ? '\nA base não foi regravada.' : '\nEscreva testes para o código novo dessas pastas.')
      process.exit(1)
    }
    writeFileSync(BASELINE, sortedJson(current))
    console.log(`Base regravada (movimentação): ${worse.map(w => w.group).join(', ')} em queda; total ${baseline.total}% → ${current.total}%.`)
    return
  }
  if (update || allowMoves) {
    writeFileSync(BASELINE, sortedJson(current))
    console.log('Base de cobertura regravada.')
    return
  }
  for (const { group, now } of unbased) console.log(`• ${group}: ${now}% (pasta nova, sem base: rode com --update)`)
  if (better.length > 0) {
    console.log('↑ Subiu (rode `node scripts/coverage-ratchet.mjs --update` para travar):')
    for (const { group, base, now } of better) console.log(`  ${group}: ${base}% → ${now}%`)
  }
  console.log(`✓ Cobertura sem queda (${Object.keys(current).length} pastas).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

#!/usr/bin/env node
// DEV-001: catraca do lint. O projeto tem problemas de lint antigos (a linha
// de base em scripts/lint-baseline.json); o CI não deixa surgir problema NOVO
// e avisa quando algum foi corrigido, para a base só descer.
//
// A contagem é por arquivo + regra: corrigir um no-unused-vars não "paga" um
// rules-of-hooks novo no mesmo arquivo.
//
//   npm run lint:ci               compara com a base (falha se piorou)
//   npm run lint:ci -- --update   regrava a base (recusa se piorou)
//   npm run lint:ci -- --adopt=regra[,plugin/*]
//                                 QA-002: liga uma regra NOVA com os casos que
//                                 já existem na base; dali em diante ela só desce.
//                                 Recusa regra que já está na base e qualquer
//                                 piora nas outras.
//   npm run lint:ci -- --allow-moves
//                                 ARCH-001/002: refactor que só move código leva
//                                 problemas antigos para arquivos novos. Aceita se
//                                 NENHUMA regra aumentar no total, e regrava a base.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(ROOT, 'scripts', 'lint-baseline.json')
const ESLINT = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')

/** Saída JSON do eslint → contagem por "arquivo::regra" e as mensagens de cada chave. */
export function countProblems(results, root) {
  const counts = {}
  const messages = {}
  for (const file of results) {
    const rel = relative(root, file.filePath).split('\\').join('/')
    for (const m of file.messages) {
      const rule = m.ruleId ?? 'fatal'
      const key = `${rel}::${rule}`
      counts[key] = (counts[key] ?? 0) + 1
      // Mensagens do React Compiler vêm com trecho de código; basta a 1ª linha.
      ;(messages[key] ??= []).push(`${rel}:${m.line} ${rule} — ${m.message.split('\n')[0]}`)
    }
  }
  return { counts, messages }
}

/** O que piorou (acima da base ou chave nova) e o que melhorou (abaixo da base). */
export function compare(baseline, current) {
  const worse = []
  const better = []
  for (const [key, now] of Object.entries(current)) {
    const base = baseline[key] ?? 0
    if (now > base) worse.push({ key, base, now })
  }
  for (const [key, base] of Object.entries(baseline)) {
    const now = current[key] ?? 0
    if (now < base) better.push({ key, base, now })
  }
  return { worse, better }
}

const ruleOf = key => key.slice(key.lastIndexOf('::') + 2)

/** `plugin/*` casa todas as regras do plugin; o resto, pelo nome exato. */
export function ruleMatcher(patterns) {
  return rule => patterns.some(p => (p.endsWith('/*') ? rule.startsWith(p.slice(0, -1)) : rule === p))
}

/**
 * A base com as contagens atuais das regras novas (`patterns`). Regra que já
 * aparece na base não é nova: volta em `alreadyInBaseline` e nada é adotado.
 */
export function adopt(baseline, current, patterns) {
  const matches = ruleMatcher(patterns)
  const alreadyInBaseline = [...new Set(Object.keys(baseline).map(ruleOf).filter(matches))].sort()
  if (alreadyInBaseline.length > 0) return { alreadyInBaseline, baseline, adopted: {} }
  const next = { ...baseline }
  const adopted = {}
  for (const [key, n] of Object.entries(current)) {
    if (!matches(ruleOf(key))) continue
    next[key] = n
    adopted[ruleOf(key)] = (adopted[ruleOf(key)] ?? 0) + n
  }
  return { alreadyInBaseline, baseline: next, adopted }
}

/** Totais por regra, somando os arquivos. */
export function totalsByRule(counts) {
  const totals = {}
  for (const [key, n] of Object.entries(counts)) totals[ruleOf(key)] = (totals[ruleOf(key)] ?? 0) + n
  return totals
}

/** Regras cujo total subiu (movimentação não pode criar problema novo). */
export function worseTotals(baseline, current) {
  const base = totalsByRule(baseline)
  return Object.entries(totalsByRule(current))
    .filter(([rule, n]) => n > (base[rule] ?? 0))
    .map(([rule, n]) => ({ rule, base: base[rule] ?? 0, now: n }))
}

const total = counts => Object.values(counts).reduce((a, b) => a + b, 0)

function sortedJson(counts) {
  return JSON.stringify(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
}

function runEslint() {
  // O eslint sai com código 1 quando há problemas; o JSON vem no stdout mesmo assim.
  try {
    return execFileSync(process.execPath, [ESLINT, '.', '-f', 'json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    if (err.stdout) return err.stdout
    throw err
  }
}

function main() {
  const update = process.argv.includes('--update')
  const { counts, messages } = countProblems(JSON.parse(runEslint()), ROOT)
  if (update && !existsSync(BASELINE)) {
    writeFileSync(BASELINE, sortedJson(counts))
    console.log(`Base criada: ${total(counts)} problema(s).`)
    return
  }
  let baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
  const adoptArg = process.argv.find(a => a.startsWith('--adopt='))
  if (adoptArg) {
    const result = adopt(baseline, counts, adoptArg.slice('--adopt='.length).split(',').filter(Boolean))
    if (result.alreadyInBaseline.length > 0) {
      console.error(`✗ Já estão na base (só podem descer): ${result.alreadyInBaseline.join(', ')}`)
      process.exit(1)
    }
    baseline = result.baseline
    for (const [rule, n] of Object.entries(result.adopted)) console.log(`+ ${rule}: ${n} caso(s) adotado(s)`)
  }
  if (process.argv.includes('--allow-moves')) {
    const worseRules = worseTotals(baseline, counts)
    if (worseRules.length > 0) {
      console.error('✗ Com --allow-moves, nenhuma regra pode aumentar no total:\n')
      for (const { rule, base, now } of worseRules) console.error(`  ${rule}: ${base} → ${now}`)
      process.exit(1)
    }
    writeFileSync(BASELINE, sortedJson(counts))
    console.log(`Base regravada (movimentação): ${total(counts)} problema(s) (antes ${total(baseline)}).`)
    return
  }
  const { worse, better } = compare(baseline, counts)

  if (worse.length > 0) {
    console.error(`✗ Lint piorou em ${worse.length} ponto(s) em relação a scripts/lint-baseline.json:\n`)
    for (const { key, base, now } of worse) {
      console.error(`  ${key}: ${base} → ${now}`)
      for (const line of messages[key] ?? []) console.error(`      ${line}`)
    }
    console.error(update || adoptArg ? '\nA base não foi regravada: corrija os problemas novos primeiro.' : '\nCorrija os problemas acima (ou rode `npm run lint` para ver tudo).')
    process.exit(1)
  }

  if (update || adoptArg) {
    writeFileSync(BASELINE, sortedJson(counts))
    console.log(`Base regravada: ${total(counts)} problema(s) (antes ${total(baseline)}).`)
    return
  }

  if (better.length > 0) {
    console.log(`↓ ${better.length} ponto(s) melhoraram — rode \`npm run lint:ci -- --update\` para baixar a base:`)
    for (const { key, base, now } of better) console.log(`  ${key}: ${base} → ${now}`)
  }
  console.log(`✓ Lint sem problemas novos (${total(counts)} na base de ${total(baseline)}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

#!/usr/bin/env node
// PERF-012: orçamento do bundle. Mede o gzip dos chunks de dist/assets e
// compara com scripts/bundle-budget.json, para uma regressão de tamanho não
// passar sem ninguém ver. Sem dependências: zlib do próprio Node.
//
//   npm run build && node scripts/bundle-budget.mjs   confere (o CI faz isso)
//   node scripts/bundle-budget.mjs --update            regrava a base
//   npm run build:analyze                              build + os 15 maiores chunks
//
// O que conta:
//   boot     o que a tela de login baixa: a entrada, os modulepreload e o CSS
//            do dist/index.html (o resto é carregado sob demanda, PERF-009);
//   entry    só o chunk de entrada (index-*.js);
//   largest  o maior chunk de todos (o editor e o Excalidraw costumam liderar).
// A folga (TOLERANCE) absorve variações pequenas entre builds.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const BUDGET = join(ROOT, 'scripts', 'bundle-budget.json')

/** Quanto cada métrica pode crescer sobre a base sem falhar. */
export const TOLERANCE = 0.05

/** Arquivos que o index.html carrega no boot: entrada, modulepreload e CSS. */
export function bootAssets(html) {
  const files = new Set()
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const tag = m[0]
    const isEntry = /^<script\b/.test(tag) && /type="module"/.test(tag)
    const isPreload = /rel="modulepreload"/.test(tag)
    const isCss = /rel="stylesheet"/.test(tag)
    if (!isEntry && !isPreload && !isCss) continue
    const src = /(?:src|href)="\/assets\/([^"]+)"/.exec(tag)
    if (src) files.add(src[1])
  }
  return [...files]
}

/** Entrada do app: o <script type="module"> do index.html. */
export function entryAsset(html) {
  const m = /<script\b[^>]*type="module"[^>]*src="\/assets\/([^"]+)"/.exec(html)
  return m ? m[1] : null
}

/** Tamanho bruto e gzip de cada .js/.css de dist/assets. */
export function measureChunks(assetsDir) {
  return readdirSync(assetsDir)
    .filter(f => /\.(js|css)$/.test(f))
    .map(file => {
      const buf = readFileSync(join(assetsDir, file))
      return { file, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length }
    })
    .sort((a, b) => b.gzip - a.gzip)
}

/** Métricas do orçamento a partir dos chunks medidos e do index.html. */
export function summarize(chunks, html) {
  const byFile = new Map(chunks.map(c => [c.file, c]))
  const boot = bootAssets(html).reduce((sum, f) => sum + (byFile.get(f)?.gzip ?? 0), 0)
  const entryFile = entryAsset(html)
  const entry = entryFile ? byFile.get(entryFile)?.gzip ?? 0 : 0
  const largest = chunks[0] ?? { file: '', gzip: 0 }
  return { bootGzip: boot, entryGzip: entry, largestChunkGzip: largest.gzip, largestChunk: largest.file }
}

/** Métricas que passaram da base + folga. */
export function overBudget(current, budget, tolerance = TOLERANCE) {
  const out = []
  for (const key of ['bootGzip', 'entryGzip', 'largestChunkGzip']) {
    const limit = Math.round(budget[key] * (1 + tolerance))
    if (current[key] > limit) out.push({ key, current: current[key], limit, base: budget[key] })
  }
  return out
}

const kb = n => `${(n / 1024).toFixed(1)} KB`

function main(args) {
  const html = join(DIST, 'index.html')
  if (!existsSync(html)) {
    console.error('✗ dist/index.html não existe: rode `npm run build` antes.')
    process.exit(1)
  }
  const indexHtml = readFileSync(html, 'utf8')
  const chunks = measureChunks(join(DIST, 'assets'))
  const current = summarize(chunks, indexHtml)

  if (args.includes('--analyze')) {
    console.log('Maiores chunks (gzip / bruto):')
    for (const c of chunks.slice(0, 15)) console.log(`  ${kb(c.gzip).padStart(10)}  ${kb(c.raw).padStart(10)}  ${c.file}`)
    console.log(`\nBoot ${kb(current.bootGzip)} · entrada ${kb(current.entryGzip)} · maior ${kb(current.largestChunkGzip)} (${current.largestChunk})`)
  }

  if (args.includes('--update')) {
    const { largestChunk: _name, ...metrics } = current
    writeFileSync(BUDGET, `${JSON.stringify(metrics, null, 2)}\n`)
    console.log(`Base do bundle regravada: boot ${kb(current.bootGzip)}, entrada ${kb(current.entryGzip)}, maior chunk ${kb(current.largestChunkGzip)}.`)
    return
  }

  if (!existsSync(BUDGET)) {
    console.error('✗ scripts/bundle-budget.json não existe: rode com --update.')
    process.exit(1)
  }
  const budget = JSON.parse(readFileSync(BUDGET, 'utf8'))
  const over = overBudget(current, budget)
  if (over.length) {
    console.error(`✗ Bundle acima do orçamento (folga de ${TOLERANCE * 100}%):\n`)
    for (const o of over) console.error(`  ${o.key}: ${kb(o.current)} (base ${kb(o.base)}, limite ${kb(o.limit)})`)
    console.error('\nVeja os maiores chunks com `npm run build:analyze`. Se o aumento for intencional, rode `node scripts/bundle-budget.mjs --update`.')
    process.exit(1)
  }
  console.log(`✓ Bundle dentro do orçamento: boot ${kb(current.bootGzip)}, entrada ${kb(current.entryGzip)}, maior chunk ${kb(current.largestChunkGzip)}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))

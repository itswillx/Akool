import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error -- script .mjs sem tipos
import { bootAssets, entryAsset, measureChunks, overBudget, summarize } from './bundle-budget.mjs'

const HTML = `<!doctype html><html><head>
<link rel="icon" href="/favicon.svg" />
<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet" />
<script type="module" crossorigin src="/assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/react-BBB.js">
<link rel="modulepreload" crossorigin href="/assets/supabase-CCC.js">
<link rel="stylesheet" crossorigin href="/assets/index-DDD.css">
</head><body><div id="root"></div></body></html>`

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('bundle-budget (PERF-012)', () => {
  it('lê do index.html a entrada, os modulepreload e o CSS (e ignora fontes externas)', () => {
    expect(bootAssets(HTML).sort()).toEqual(['index-AAA.js', 'index-DDD.css', 'react-BBB.js', 'supabase-CCC.js'])
    expect(entryAsset(HTML)).toBe('index-AAA.js')
  })

  it('mede os chunks e soma o boot sem os lazy', () => {
    dir = mkdtempSync(join(tmpdir(), 'budget-'))
    const assets = join(dir, 'assets')
    mkdirSync(assets)
    writeFileSync(join(assets, 'index-AAA.js'), 'a'.repeat(1000))
    writeFileSync(join(assets, 'react-BBB.js'), 'r'.repeat(1000))
    writeFileSync(join(assets, 'supabase-CCC.js'), 's'.repeat(1000))
    writeFileSync(join(assets, 'index-DDD.css'), 'c'.repeat(1000))
    // Chunk sob demanda, grande e pouco compressível: fora do boot, mas o maior.
    writeFileSync(join(assets, 'editor-EEE.js'), Array.from({ length: 4000 }, (_, i) => (i * 7919 % 1000).toString(36)).join(''))
    const chunks = measureChunks(assets)
    expect(chunks[0].file).toBe('editor-EEE.js')
    const s = summarize(chunks, HTML)
    const gz = (f: string) => chunks.find((c: { file: string }) => c.file === f).gzip
    expect(s.bootGzip).toBe(gz('index-AAA.js') + gz('react-BBB.js') + gz('supabase-CCC.js') + gz('index-DDD.css'))
    expect(s.entryGzip).toBe(gz('index-AAA.js'))
    expect(s.largestChunk).toBe('editor-EEE.js')
  })

  it('acusa só o que passou da base + folga de 5%', () => {
    const base = { bootGzip: 100_000, entryGzip: 50_000, largestChunkGzip: 300_000 }
    expect(overBudget({ bootGzip: 105_000, entryGzip: 50_000, largestChunkGzip: 300_000 }, base)).toEqual([])
    expect(overBudget({ bootGzip: 105_001, entryGzip: 60_000, largestChunkGzip: 300_000 }, base).map((o: { key: string }) => o.key))
      .toEqual(['bootGzip', 'entryGzip'])
  })
})

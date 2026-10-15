import { ESLint } from 'eslint'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// API-027: a guarda do eslint.config.js para _domain (roda no Deno, em
// UTC, e no navegador, no fuso do aparelho): sem relógio, sem hora local e sem
// navegador. A primeira versão deixava passar o parse em hora local, como o
// `new Date(`${cd}T00:00:00`)` do createdPerWeek antigo, que errava a semana no
// início do horário de verão, além de `Date()`, `Date.parse` e o globalThis.

const ROOT = join(__dirname, '..')
const GUARD_RULES = new Set(['no-restricted-syntax', 'no-restricted-globals'])
const PRELUDE = 'declare const d: Date; declare const iso: string; declare const hora: string; declare const ms: number; declare const n: number\n'

const eslint = new ESLint({ cwd: ROOT })

async function guardHits(code: string, file = 'supabase/functions/_domain/__guarda__.ts') {
  const [result] = await eslint.lintText(PRELUDE + code, { filePath: join(ROOT, file) })
  expect(result.messages.filter(m => m.fatal)).toEqual([])
  return result.messages.filter(m => m.ruleId && GUARD_RULES.has(m.ruleId)).map(m => m.message)
}

describe('guarda de relógio e fuso em _domain (API-027)', () => {
  // O primeiro lintText carrega a config e o parser (1,3 s sozinho, 5,8 s com a
  // suíte em paralelo): todo teste tem timeout próprio, porque com -t qualquer
  // um pode ser o primeiro.
  it.each([
    // Relógio.
    'new Date()',
    'Date.now()',
    'Date()',
    // Hora local: por partes, texto sem Z nem offset depois da hora (literal,
    // template ou concatenação), Date.parse. O '-2025' de MM-DD-AAAA não é offset
    // (o V8 lê em hora local), e o 'z' minúsculo é Invalid Date no Safari.
    'new Date(2025, 2, 9)',
    "new Date('2025-03-10T00:00:00')",
    "new Date('03-10-2025')",
    "new Date('2025-03-10T00:00:00z')",
    "new Date(iso + 'T00:00:00')",
    'new Date(`${iso}-2025`)',
    // Data sem hora: é UTC, mas por convenção o dia passa por toUTC.
    "new Date('2025-03-10')",
    'Math.floor((new Date(`${iso}T00:00:00`).getTime() - new Date(`${iso}T00:00:00`).getTime()) / (7 * 86400000))',
    'new Date(`${iso}`)',
    "Date.parse('2025-03-10T00:00:00Z')",
    // Getters, setters e texto locais.
    'd.getHours()',
    'd.getYear()',
    'd.setDate(1)',
    'd.toDateString()',
    'd.toTimeString()',
    "d.toLocaleDateString('pt-BR')",
    // Navegador e relógio por fora do no-restricted-globals.
    "localStorage.getItem('k')",
    "globalThis.localStorage.getItem('k')",
    'globalThis.Date.now()',
    "globalThis['window']",
    'self.navigator',
    '(globalThis as unknown as { document: unknown }).document',
    'process.env',
    // `today` obrigatório.
    'export function f(today = todayStr()) { return today }\ndeclare function todayStr(): string',
  ])('barra %s', async code => {
    expect(await guardHits(code)).not.toEqual([])
  }, 60_000)

  it.each([
    'new Date(ms)',
    'new Date(Date.UTC(2025, 2, 9)).getUTCDay()',
    "new Date('2025-03-10T01:30:00Z').getTime()",
    "new Date('2025-03-10T01:30:00.123456+00:00')",
    "new Date('2025-03-10T00:00:00-0300')",
    "new Date('2025-03-10T01:30Z')",
    'new Date(`${iso}T00:00:00Z`).toISOString()',
    // A hora pode vir na parte variável: a cauda é só o Z ou o offset com dois-pontos.
    'new Date(`${iso}T${hora}Z`)',
    'new Date(`${iso}T${hora}-03:00`)',
    "new Date(iso + 'T00:00:00Z')",
    "new Date(iso + 'T00:00:00' + 'Z')",
    'new Date(ms + 1)',
    'n.toString(16)',
    '(globalThis as unknown as { crypto: unknown }).crypto',
  ])('deixa passar %s', async code => {
    expect(await guardHits(code)).toEqual([])
  }, 60_000)

  it('a data sem hora tem mensagem própria: é UTC, não hora local', async () => {
    expect(await guardHits("new Date('2025-03-10')")).toEqual([expect.stringMatching(/^Data sem hora é meia-noite UTC, não hora local/)])
    expect(await guardHits("new Date('03-10-2025')")).toEqual([expect.stringMatching(/é hora local: use toUTC/)])
    expect(await guardHits("new Date(iso + 'T00:00:00')")).toEqual([expect.stringMatching(/é hora local: use toUTC/)])
  }, 60_000)

  it('não vale para os testes', async () => {
    expect(await guardHits("Date.parse('2025-03-10T00:00:00')", 'supabase/functions/_domain/__guarda__.test.ts')).toEqual([])
  }, 60_000)

  it('o código atual de _domain passa', async () => {
    const results = await eslint.lintFiles(['supabase/functions/_domain'])
    const hits = results.flatMap(r => r.messages
      .filter(m => m.ruleId && GUARD_RULES.has(m.ruleId))
      .map(m => `${r.filePath.slice(ROOT.length + 1)}:${m.line} ${m.message}`))
    expect(results.length).toBeGreaterThan(20)
    expect(hits).toEqual([])
  }, 60_000)
})

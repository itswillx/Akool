import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseBacklogMarkdown, type ParseResult } from './backlogMarkdownParser.ts'

// API-027: golden do parser sobre os backlogs reais de docs/imports, com o id
// das subtarefas determinístico. Trava o "os backlogs de antes importam igual"
// (aceite do API-033): uma mudança no parser aparece aqui, card por card.
//
// O arquivo fixtures/backlogs.golden.json tem, por backlog, os tópicos, os
// avisos e uma linha por card (ID, prioridade, esforço, tópico, rótulos,
// arquivos, subtarefas feitas/total e o sha256 do card inteiro, que pega
// título, descrição e o texto das subtarefas). Quem muda um backlog de
// docs/imports (ou o parser, de propósito) regrava com
// `npx vitest run -u supabase/functions/_domain/backlogMarkdownParser.test.ts`
// e confere o diff do golden no PR.

const HERE = dirname(fileURLToPath(import.meta.url))
const IMPORTS = join(HERE, '..', '..', '..', 'docs', 'imports')

function digest(result: ParseResult) {
  return {
    topics: result.topics,
    issues: result.issues.map(i => [i.code, i.cardId, i.detail].filter(Boolean).join(' ')),
    cards: result.cards.map(c => [
      c.externalId,
      c.priority,
      c.effort ?? '-',
      c.topic ?? '-',
      c.labels.join(','),
      `arquivos ${c.files.length}`,
      `subtarefas ${c.checklist.filter(i => i.completed).length}/${c.checklist.length}`,
      createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16),
    ].join(' | ')),
  }
}

describe('parseBacklogMarkdown: golden dos backlogs de docs/imports', () => {
  it('cada backlog sai igual ao golden', async () => {
    const files = readdirSync(IMPORTS).filter(f => f.endsWith('.md')).sort()
    const golden: Record<string, ReturnType<typeof digest>> = {}
    let cards = 0
    for (const file of files) {
      let n = 0
      const result = parseBacklogMarkdown(readFileSync(join(IMPORTS, file), 'utf8'), { newId: () => `s${n++}` })
      // O aviso em texto (CLI) é o mesmo que o estruturado (tela).
      expect(result.warnings).toHaveLength(result.issues.length)
      golden[file] = digest(result)
      cards += result.cards.length
    }
    expect(files.length).toBeGreaterThanOrEqual(17)
    expect(cards).toBeGreaterThan(400)
    await expect(`${JSON.stringify({ files: files.length, cards, backlogs: golden }, null, 2)}\n`)
      .toMatchFileSnapshot('./fixtures/backlogs.golden.json')
  })
})

describe('parseBacklogMarkdown', () => {
  it('cabeçalho CARD sem título é ignorado com aviso, e o ID repetido entra uma vez', () => {
    const md = ['### CARD AB-001 —', '### CARD AB-002 — Dois', '**Subtarefas Kanban:**', '- [ ] a', '### CARD AB-002 — De novo'].join('\n')
    const result = parseBacklogMarkdown(md, { newId: () => 'x' })
    expect(result.cards.map(c => c.fullTitle)).toEqual(['AB-002 — Dois'])
    expect(result.issues.map(i => i.code)).toEqual(['invalid_heading', 'no_priority', 'no_effort', 'no_topic', 'no_subtasks', 'no_priority', 'no_effort', 'no_topic', 'duplicate_id'])
    expect(result.warnings[0]).toBe('Bloco ignorado: heading CARD inválido ou ausente')
    expect(result.warnings.at(-1)).toBe('AB-002: ID duplicado — apenas a primeira ocorrência será importada')
  })

  it('o mesmo arquivo com o mesmo newId dá o mesmo resultado', () => {
    const source = readFileSync(join(IMPORTS, 'backlog-api-v1.md'), 'utf8')
    const run = () => { let n = 0; return parseBacklogMarkdown(source, { newId: () => `s${n++}` }) }
    expect(run()).toEqual(run())
  })
})

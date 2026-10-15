import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checklistItem, listMeta, parseBacklogMarkdown, tableRow, type ParseResult } from './backlogMarkdownParser.ts'

// API-027: golden do parser sobre os backlogs reais de docs/imports, com o id
// das subtarefas determinístico. Trava o "os backlogs de antes importam igual"
// (aceite do API-033): uma mudança no parser aparece aqui, card por card.
//
// O arquivo fixtures/backlogs.golden.json tem, por backlog, os tópicos, os
// avisos e uma linha por card (ID, prioridade, esforço, tópico, rótulos,
// arquivos, subtarefas feitas/total e o sha256 do card sem o `dependsOn`, que
// pega título, descrição e o texto das subtarefas). O `dependsOn` (API-033)
// entra no fim da linha, só quando o card tem `Depende de`: assim os backlogs de
// antes do campo saem iguais. Quem muda um backlog de docs/imports (ou o
// parser, de propósito) regrava com
// `npx vitest run supabase/functions/_domain/backlogMarkdownParser.test.ts -u`
// e confere o diff do golden no PR. O `-u` vai depois do arquivo: no vitest 4 ele
// aceita um valor, e `-u <arquivo>` engole o arquivo e roda a suíte inteira.

const HERE = dirname(fileURLToPath(import.meta.url))
const IMPORTS = join(HERE, '..', '..', '..', 'docs', 'imports')

function digest(result: ParseResult) {
  return {
    topics: result.topics,
    issues: result.issues.map(i => [i.code, i.cardId, i.detail].filter(Boolean).join(' ')),
    cards: result.cards.map(c => {
      const { dependsOn, ...v1 } = c
      return [
        c.externalId,
        c.priority,
        c.effort ?? '-',
        c.topic ?? '-',
        c.labels.join(','),
        `arquivos ${c.files.length}`,
        `subtarefas ${c.checklist.filter(i => i.completed).length}/${c.checklist.length}`,
        createHash('sha256').update(JSON.stringify(v1)).digest('hex').slice(0, 16),
        ...(dependsOn.length > 0 ? [`depende de ${dependsOn.join(',')}`] : []),
      ].join(' | ')
    }),
  }
}

describe('parseBacklogMarkdown: golden dos backlogs de docs/imports', () => {
  it('cada backlog sai igual ao golden', async () => {
    // O README.md é a especificação do formato, não um backlog.
    const files = readdirSync(IMPORTS).filter(f => f.endsWith('.md') && f !== 'README.md').sort()
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
    expect(files.length).toBeGreaterThanOrEqual(16)
    expect(cards).toBeGreaterThan(350)
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
    const source = readFileSync(join(IMPORTS, 'backlog-auditoria-2026-09.md'), 'utf8')
    const run = () => { let n = 0; return parseBacklogMarkdown(source, { newId: () => `s${n++}` }) }
    expect(run()).toEqual(run())
  })
})

// ── API-033 ──────────────────────────────────────────────────────────────────

const HEAD = ['## Tópico: T', '', '### CARD AB-001 — Um', '', '| Campo | Valor |', '| --- | --- |', '| **Prioridade** | P1 |', '| **Esforço** | S |', '']
const TAIL = ['', '**Subtarefas Kanban:**', '', '- [ ] a', '']

/** O card AB-001 com `body` entre a tabela e as subtarefas (e `after` depois delas). */
function card(body: string[], after: string[] = []) {
  let n = 0
  const result = parseBacklogMarkdown([...HEAD, ...body, ...TAIL, ...after].join('\n'), { newId: () => `s${n++}` })
  expect(result.warnings).toHaveLength(result.issues.length)
  return { result, card: result.cards[0] }
}

describe('Problema e Contexto multilinha', () => {
  it('o Contexto de 3 linhas entra inteiro, até as subtarefas (o aceite)', () => {
    const { card: c } = card(['**Problema:** Linha 1 do problema.', 'Linha 2 do problema.', '', '**Contexto:** Linha 1 do contexto.', 'Linha 2 do contexto.', 'Linha 3 do contexto.'])
    expect(c.description).toBe([
      '**Problema:** Linha 1 do problema.\nLinha 2 do problema.',
      '**Esforço:** S',
      '**Contexto:** Linha 1 do contexto.\nLinha 2 do contexto.\nLinha 3 do contexto.',
    ].join('\n\n'))
    expect(c.checklist.map(i => i.text)).toEqual(['a'])
  })

  it.each([
    ['---', ['---', 'depois']],
    ['o próximo ### CARD', ['### CARD AB-002 — Dois']],
    ['## Tópico', ['## Tópico: Outro']],
    ['# Título', ['# Outro arquivo']],
    ['**Problema:**', ['**Problema:** p']],
  ])('a seção para em %s', (_name, end) => {
    const md = [...HEAD, '**Contexto:** c1', 'c2', ...end, 'resto'].join('\n')
    const c = parseBacklogMarkdown(md, { newId: () => 'x' }).cards[0]
    expect(c.description).toMatch(/\*\*Contexto:\*\* c1\nc2$/)
  })

  it('### que não é CARD fica dentro do Contexto', () => {
    expect(card(['**Contexto:** Intro.', '### Critérios', '- a']).card.description).toBe('**Esforço:** S\n\n**Contexto:** Intro.\n### Critérios\n- a')
  })

  it('o texto pode começar na linha de baixo; seção vazia não entra', () => {
    expect(card(['**Problema:**', '', 'Embaixo.', '**Contexto:**   ', '']).card.description).toBe('**Problema:** Embaixo.\n\n**Esforço:** S')
  })

  it('seção que começa com bloco: o rótulo fica na linha de cima (uma lista de 3 itens, não um parágrafo)', () => {
    expect(card(['**Contexto:**', '- aceite A', '- aceite B', '- aceite C']).card.description).toBe('**Esforço:** S\n\n**Contexto:**\n- aceite A\n- aceite B\n- aceite C')
    for (const start of ['1. um', '2) dois', '> citação', '| a | b |', '### título', '+ item', '* item', '~~~']) {
      expect(card(['**Problema:**', start]).card.description).toBe(`**Problema:**\n${start}\n\n**Esforço:** S`)
    }
    for (const start of ['**negrito** no começo', '-5 graus', '#hashtag', '2026 foi o ano']) {
      expect(card(['**Problema:**', start]).card.description).toBe(`**Problema:** ${start}\n\n**Esforço:** S`)
    }
  })

  // Na linha do rótulo, `> 2 s` e `2. fase` são parágrafo: o rótulo na linha de
  // cima os faria citação (lendo "2 s") e lista (numerada do 1). Nas quatro
  // primeiras, os textos esperados são os do parser de antes do API-033
  // (api/lote-05); ele não lia a 2ª linha nem separava a cerca.
  it('texto com cara de bloco na linha do rótulo continua depois dele, como antes', () => {
    expect(card(['**Problema:** > 2 s para abrir um quadro.', '', '**Contexto:** 2. fase do plano (a 1 já foi).']).card.description)
      .toBe('**Problema:** > 2 s para abrir um quadro.\n\n**Esforço:** S\n\n**Contexto:** 2. fase do plano (a 1 já foi).')
    expect(card(['**Problema:** >500 ms no p95.', '', '**Contexto:** - nada a declarar']).card.description)
      .toBe('**Problema:** >500 ms no p95.\n\n**Esforço:** S\n\n**Contexto:** - nada a declarar')
    expect(card(['**Contexto:** # 1 da lista']).card.description).toBe('**Esforço:** S\n\n**Contexto:** # 1 da lista')
    expect(card(['**Problema:** + 3 itens', '**Contexto:** | a | b |']).card.description)
      .toBe('**Problema:** + 3 itens\n\n**Esforço:** S\n\n**Contexto:** | a | b |')
    // As linhas de baixo vêm como estão; só a cerca aberta na linha do rótulo o separa.
    expect(card(['**Contexto:** 2. fase', '- item']).card.description).toBe('**Esforço:** S\n\n**Contexto:** 2. fase\n- item')
    expect(card(['**Problema:** ~~~ sh', 'x', '~~~']).card.description).toBe('**Problema:**\n~~~ sh\nx\n~~~\n\n**Esforço:** S')
  })
})

describe('cerca de código no Contexto', () => {
  it('# e --- dentro da cerca não encerram a seção', () => {
    const body = ['**Contexto:** Rodar:', '```bash', '# instala', 'npm ci', '---', '**Subtarefas Kanban:**', '```', 'Depois conferir.']
    expect(card(body).card.description).toBe(`**Esforço:** S\n\n${body.join('\n')}`)
  })

  it('a cerca pode abrir na linha do rótulo; ~~~ não fecha com crases', () => {
    expect(card(['**Contexto:** ```sh', '# x', '```', 'fim']).card.description).toBe('**Esforço:** S\n\n**Contexto:**\n```sh\n# x\n```\nfim')
    expect(card(['**Contexto:** a', '~~~~', '```', '# x', '~~~', '# ainda', '~~~~', 'b']).card.description)
      .toBe('**Esforço:** S\n\n**Contexto:** a\n~~~~\n```\n# x\n~~~\n# ainda\n~~~~\nb')
  })

  it('crases com crase depois não são cerca (código na linha)', () => {
    expect(card(['**Contexto:** a', '```x``` b', '# fim']).card.description).toBe('**Esforço:** S\n\n**Contexto:** a\n```x``` b')
  })

  it('a cerca que não fecha vai até as subtarefas, sem engoli-las', () => {
    const { card: c } = card(['**Contexto:** Rodar:', '```bash', '# instala', '---', 'npm ci'], ['| **Labels** | depois |'])
    expect(c.description).toBe('**Esforço:** S\n\n**Contexto:** Rodar:\n```bash\n# instala\n---\nnpm ci')
    expect(c.checklist.map(i => i.text)).toEqual(['a'])
    // Fora das seções, a cerca que não fecha não esconde metadado.
    expect(c.labels).toEqual(['depois', 't', 'esforço:s'])
  })

  it('a cerca não passa para o card seguinte', () => {
    const md = [...HEAD, '**Contexto:** ```', 'x', '### CARD AB-002 — Dois', '**Contexto:** y', '**Subtarefas Kanban:**', '- [ ] b'].join('\n')
    const r = parseBacklogMarkdown(md, { newId: () => 'x' })
    expect(r.cards.map(c => c.description)).toEqual(['**Esforço:** S\n\n**Contexto:**\n```\nx', '**Contexto:** y'])
  })
})

describe('metadados só fora das seções, da lista de subtarefas e das cercas', () => {
  it('prioridade e esforço desconhecidos: média e sem esforço', () => {
    const md = ['### CARD AB-001 — Um', '- **Prioridade:** P9', '- **Esforço:** XL', '**Subtarefas Kanban:**', '- [ ] a'].join('\n')
    const { cards, issues } = parseBacklogMarkdown(md, { newId: () => 'x' })
    expect([cards[0].priority, cards[0].effort]).toEqual(['medium', null])
    expect(issues.map(i => i.code)).toEqual(['no_effort', 'no_topic'])
  })

  it('Prioridade, Esforço e Depende de dentro do Problema, do Contexto, da cerca ou entre as subtarefas não valem', () => {
    const { card: c, result } = card(
      ['**Problema:** p', '| **Esforço** | L |', '**Contexto:** c', '- **Prioridade:** P3', '| **Depende de** | AB-009 |', '', '```', '| **Labels** | cerca |', '```'],
      [],
    )
    expect([c.priority, c.effort, c.labels, c.dependsOn]).toEqual(['high', 'S', ['t', 'esforço:s'], []])
    expect(result.issues).toEqual([])
    const sub = parseBacklogMarkdown([...HEAD, '**Subtarefas Kanban:**', '- [ ] a', '- **Prioridade:** P0', '- [ ] b'].join('\n'), { newId: () => 'x' }).cards[0]
    expect([sub.priority, sub.checklist.length]).toEqual(['high', 2])
  })

  it('a cerca fora das seções também não dá metadado', () => {
    expect(card(['```', '| **Prioridade** | P0 |', '```']).card.priority).toBe('high')
  })
})

describe('Depende de', () => {
  it('em tabela: IDs em qualquer caixa, crases, `;`, "e", repetidos e o ponto final', () => {
    const { card: c, result } = card(['| **Depende de** | `ab-002`, AB-003; AB-004 e AB-005, AB-002. |'])
    expect(c.dependsOn).toEqual(['AB-002', 'AB-003', 'AB-004', 'AB-005'])
    expect(result.issues).toEqual([])
  })

  it('em lista; "—", "nenhuma" e vazio são sem dependência', () => {
    expect(card(['- **Depende de:** AB-002, AB-003']).card.dependsOn).toEqual(['AB-002', 'AB-003'])
    for (const none of ['—', '-', 'nenhuma', 'Nenhum', '']) {
      const { card: c, result } = card([`| **Depende de** | ${none} |`])
      expect([c.dependsOn, result.issues]).toEqual([[], []])
    }
  })

  it('o que não é ID vira invalid_dependency (o ID do mesmo trecho entra), e o próprio card, self_dependency', () => {
    const { card: c, result } = card(['| **Depende de** | AB-002 — Título, com vírgula; foo, AB-001, ab-001, AB-0011, ABCDEF-001 |'])
    expect(c.dependsOn).toEqual(['AB-002'])
    expect(result.issues).toEqual([
      { code: 'invalid_dependency', cardId: 'AB-001', detail: '— Título' },
      { code: 'invalid_dependency', cardId: 'AB-001', detail: 'com vírgula' },
      { code: 'invalid_dependency', cardId: 'AB-001', detail: 'foo' },
      { code: 'self_dependency', cardId: 'AB-001' },
      { code: 'invalid_dependency', cardId: 'AB-001', detail: 'AB-0011' },
      { code: 'invalid_dependency', cardId: 'AB-001', detail: 'ABCDEF-001' },
    ])
    expect(result.warnings.slice(0, 4)).toEqual([
      'AB-001: "— Título" em Depende de não é um ID de card — ignorado',
      'AB-001: "com vírgula" em Depende de não é um ID de card — ignorado',
      'AB-001: "foo" em Depende de não é um ID de card — ignorado',
      'AB-001: depende de si mesmo — ignorado',
    ])
  })

  it('sem o campo, dependsOn é [] (sempre presente)', () => {
    expect(card([]).card.dependsOn).toEqual([])
  })
})

describe('CRLF', () => {
  it('o sample com CRLF ou com CR sai igual ao com LF', () => {
    const sample = readFileSync(join(IMPORTS, 'backlog-card-sample.md'), 'utf8')
    const run = (source: string) => { let n = 0; return parseBacklogMarkdown(source, { newId: () => `s${n++}` }) }
    const lf = run(sample)
    expect(lf.cards.length).toBeGreaterThanOrEqual(2)
    expect(run(sample.replace(/\n/g, '\r\n'))).toEqual(lf)
    expect(run(sample.replace(/\n/g, '\r'))).toEqual(lf)
  })
})

// Seeded (LCG): o mesmo resultado em toda execução.
function seeded(seed: number) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

describe('leitura linear × as regex de antes (diferencial)', () => {
  // As regex que o API-033 trocou (quadráticas com uma linha longa). Aqui são o
  // oráculo, em linhas curtas: o campo e o valor normalizados têm de sair iguais.
  const TABLE_ROW_RE = /^\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|\s*(.+?)\s*\|$/
  const LIST_META_RE = /^-\s+\*{0,2}([^:*]+?):\*{0,2}\s*(.+)$/
  const CHECKLIST_ITEM_RE = /^-\s+\[([ xX])\]\s+(.+)$/
  const field = (raw: string) => raw.replace(/\*\*/g, '').trim().toLowerCase()
  const value = (raw: string) => raw.replace(/\*\*/g, '').trim()
  /** Campo só de espaço a regex aceitava (a chave '', nunca lida); a função nova não. */
  const meta = (m: [string, string] | null) => (m && field(m[0]) ? [field(m[0]), value(m[1])] : null)
  const ALPHABET = [' ', ' ', '\t', '*', '*', '|', '|', ':', '-', 'a', 'b', '[', ']', 'x', 'X', ' ', ' ']
  const PREFIXES = ['|', '- ', '- [ ]', '- [x]', '-  [X]', '-\t[ ]', '']

  it('tabela, lista e subtarefa: 60 mil linhas aleatórias com os mesmos resultados', () => {
    const rnd = seeded(12345)
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
    const counts = { table: 0, list: 0, item: 0 }
    for (let k = 0; k < 60_000; k++) {
      let line = pick(PREFIXES)
      const len = 1 + Math.floor(rnd() * 12)
      for (let i = 0; i < len; i++) line += pick(ALPHABET)
      if (line[0] === '|' && rnd() < 0.5) line += '|'
      const t = line.match(TABLE_ROW_RE)
      const l = line.match(LIST_META_RE)
      const c = line.match(CHECKLIST_ITEM_RE)
      if (t) counts.table++
      if (l) counts.list++
      if (c) counts.item++
      expect(meta(tableRow(line)), JSON.stringify(line)).toEqual(meta(t && [t[1], t[2]]))
      expect(meta(listMeta(line)), JSON.stringify(line)).toEqual(meta(l && [l[1], l[2]]))
      const item = checklistItem(line)
      expect(item && { done: item.done, text: item.text.trim() }, JSON.stringify(line)).toEqual(c && { done: c[1] !== ' ', text: c[2].trim() })
    }
    // O gerador tem de exercitar os três formatos.
    expect(Math.min(counts.table, counts.list, counts.item)).toBeGreaterThan(1000)
  })
})

// O parser roda a cada tecla na tela de importação. A garantia contra o
// quadrático é a razão de escala t(n)/t(n/4), medida em pares: o pequeno e
// logo depois o grande, até 6 pares, com a decisão do 3º par em diante. Antes
// do API-033, com 64 KiB numa linha: a tabela sem `|` no fim levava 20 s, o
// Contexto com espaços 8,2 s e o `-` com espaços 1,3 s. Hoje, a 512 KiB, cada
// caso fica entre 1 e 35 ms (M2, Node 22); o teto de 3 s é folgado de propósito.
const CEILING_MS = 3_000
const MAX_RATIO = 8
const N = 512 * 1024

/** `head`, `unit` repetido e `tail`, com `n` caracteres no total. */
const sized = (n: number, head: string, unit: string, tail = '') =>
  head + unit.repeat(Math.ceil((n - head.length - tail.length) / unit.length)).slice(0, n - head.length - tail.length) + tail
const CARD = '## Tópico: T\n### CARD ZZ-001 — X\n'
const SUBTASKS = '\n**Subtarefas Kanban:**\n- [ ] a\n'
/** IDs distintos: AAA-000, AAA-001, …, AAB-000, … */
const depId = (i: number) => {
  const k = Math.floor(i / 1000)
  return `A${String.fromCharCode(65 + Math.floor(k / 26) % 26)}${String.fromCharCode(65 + (k % 26))}-${String(i % 1000).padStart(3, '0')}`
}

const PATHOLOGICAL: Record<string, (n: number) => string> = {
  tabelaSemBarraNoFim: n => sized(n, `${CARD}| a | b`, ' ', `c${SUBTASKS}`),
  tabelaSoDeEspacos: n => sized(n, `${CARD}|`, ' ', `|  |${SUBTASKS}`),
  contextoComEspacos: n => sized(n, `${CARD}**Contexto:** a`, ' ', `b${SUBTASKS}`),
  problemaComEspacos: n => sized(n, `${CARD}**Problema:**`, ' ', SUBTASKS),
  tracoComEspacos: n => sized(n, `${CARD}-`, ' ', SUBTASKS),
  listaSemDoisPontos: n => sized(n, `${CARD}- **`, 'a', SUBTASKS),
  subtarefaComSeparadorDeLinha: n => sized(n, `${CARD}**Subtarefas Kanban:**\n- [ ] `, ' ', ' '),
  dependeDeMuitosIds: n => sized(n, `${CARD}| **Depende de** | `, Array.from({ length: 30_000 }, (_, i) => depId(i)).join(', '), ` |${SUBTASKS}`),
  dependeDeLixo: n => sized(n, `${CARD}| **Depende de** | `, 'x y, ', ` |${SUBTASKS}`),
  crasesNumaLinha: n => sized(n, `${CARD}**Contexto:** a\n`, '`', `\n${SUBTASKS}`),
  cercasQueFecham: n => sized(n, `${CARD}**Contexto:** a\n`, '```\n# x\n```\n', SUBTASKS),
  linhasDeMetadado: n => sized(n, CARD, '- a: b\n', SUBTASKS),
  muitosCards: n => sized(n, '', '### CARD AB-001 — t\n| **Prioridade** | P1 |\n**Contexto:** c\nd\n**Subtarefas Kanban:**\n- [ ] a\n'),
  // Uns 27 mil tópicos distintos no grande: a dedup com includes dava razão 16.
  muitosTopicos: n => sized(n, '', Array.from({ length: 40_000 }, (_, i) => `## Tópico: ${depId(i)}\n`).join('')),
}

describe('tempo linear (bateria patológica a 512 KiB)', () => {
  const time = (md: string) => {
    const t = performance.now()
    parseBacklogMarkdown(md, { newId: () => 'x' })
    return performance.now() - t
  }
  const measure = (big: string, small: string) => {
    let tBig = Infinity
    let tSmall = Infinity
    let ratio = Infinity
    for (let k = 0; k < 6; k++) {
      tSmall = Math.min(tSmall, time(small))
      const t = time(big)
      tBig = Math.min(tBig, t)
      if (k >= 2) ratio = Math.min(ratio, tBig / Math.max(tSmall, 1))
      if ((tBig < CEILING_MS && ratio < MAX_RATIO) || t > 2 * CEILING_MS) break
    }
    return { tBig, ratio }
  }

  it.each(Object.entries(PATHOLOGICAL))('%s', { timeout: 60_000, retry: 2 }, (_name, gen) => {
    const big = gen(N)
    const small = gen(N / 4)
    expect([big.length, small.length]).toEqual([N, N / 4])
    const { tBig, ratio } = measure(big, small)
    expect(tBig, 'menor tempo do grande (ms)').toBeLessThan(CEILING_MS)
    expect(ratio, 'razão t(n)/t(n/4) dos mínimos').toBeLessThan(MAX_RATIO)
  })
})

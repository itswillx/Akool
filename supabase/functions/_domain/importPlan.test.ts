import { describe, expect, it } from 'vitest'
import { parseBacklogMarkdown, type BacklogIssueCode, type ParsedBacklogCard } from './backlogMarkdownParser.ts'
import { DOMAIN_PT_BR, tPtBR } from './i18n.pt-BR.ts'
import {
  backlogIssueText,
  importIssueText,
  importLabels,
  importWarningText,
  insertBatches,
  oldestFirst,
  planCardRows,
  planTopicColumns,
  titleMatchesExternalId,
  TOPIC_COLUMN_COLORS,
  type ExistingCard,
  type ImportCardRow,
  type ImportIssueCode,
  type ImportWarningCode,
} from './importPlan.ts'

// API-027: o plano da importação de backlog, sem banco. A gravação (supabase-js)
// fica nos testes de src/lib/importProjectCards.test.ts.

function parsed(over: Partial<ParsedBacklogCard> = {}): ParsedBacklogCard {
  return {
    externalId: 'A-001', title: 'Um', fullTitle: 'A-001 — Um', topic: null, priority: 'high', effort: 'M',
    labels: ['x'], description: 'd', checklist: [{ id: 'i1', text: 'faz', completed: false }], files: [], dependsOn: [], ...over,
  }
}

/** Um card do quadro com o título `title` (id = o título, para o teste ler fácil). */
const onBoard = (title: string, over: Partial<ExistingCard> = {}): ExistingCard =>
  ({ id: `id:${title}`, title, column_id: 'c1', sort_order: 0, ...over })

/** newId determinístico: n0, n1, … */
const counter = () => { let n = 0; return () => `n${n++}` }

describe('planCardRows', () => {
  it('continua o sort_order de cada coluna depois do maior que ela já tem', () => {
    const plan = planCardRows({
      boardId: 'b1',
      fallbackColumnId: 'c1',
      cards: [parsed({ externalId: 'A-001', topic: 'T' }), parsed({ externalId: 'A-002' }), parsed({ externalId: 'A-003', topic: 'T' })],
      existing: [onBoard('X', { sort_order: 4 }), onBoard('Y', { sort_order: 1 }), onBoard('Z', { column_id: 'c2', sort_order: 9 })],
      columnByTopic: { T: 'c2' },
      newId: counter(),
    })
    expect(plan.issues).toEqual([])
    expect(plan.warnings).toEqual([])
    expect(plan.rows.map(r => [r.column_id, r.sort_order])).toEqual([['c2', 10], ['c1', 5], ['c2', 11]])
    expect(plan.rows[0]).toEqual({
      id: 'n0', board_id: 'b1', column_id: 'c2', title: 'A-001 — Um', description: 'd', priority: 'high', due_date: null,
      assignee_user_id: null, labels: ['x'], linked_page_id: null, completed: false,
      checklist: [{ id: 'i1', text: 'faz', completed: false }], attachments: [], depends_on: [], sort_order: 10,
    })
  })

  it('coluna nova começa do 0; tópico sem coluna cai na coluna padrão', () => {
    const plan = planCardRows({ boardId: 'b1', fallbackColumnId: 'c9', cards: [parsed({ topic: 'Sem coluna' })], existing: [], columnByTopic: {} })
    expect(plan.rows.map(r => [r.column_id, r.sort_order])).toEqual([['c9', 0]])
  })

  it('pula o card que já está no quadro ("ID —" ou "ID -"), salvo com skipDuplicates=false', () => {
    const cards = [parsed({ externalId: 'A-001' }), parsed({ externalId: 'A-002', fullTitle: 'A-002 — Dois' }), parsed({ externalId: 'A-003', fullTitle: 'A-003 — Três' })]
    const existing = [onBoard('A-001 — Um'), onBoard('A-002 - Dois', { sort_order: 1 }), onBoard('A-003—colado', { sort_order: 2 }), onBoard(' A-003 — espaço antes')]
    const skip = planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards, existing })
    expect(skip.skippedIds).toEqual(['A-001', 'A-002'])
    expect(skip.rows.map(r => r.title)).toEqual(['A-003 — Três'])
    const all = planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards, existing, skipDuplicates: false })
    expect(all.skippedIds).toEqual([])
    expect(all.rows.map(r => r.sort_order)).toEqual([3, 4, 5])
  })

  it('com qualquer problema, nenhuma linha; os problemas saem na ordem do arquivo', () => {
    const plan = planCardRows({
      boardId: 'b1',
      fallbackColumnId: null,
      cards: [
        parsed({ externalId: 'A-001', topic: 'T' }),
        parsed({ externalId: 'A-002', topic: null }),
        parsed({ externalId: 'A-003', topic: 'T', checklist: Array.from({ length: 501 }, (_, i) => ({ id: `i${i}`, text: 't', completed: false })) }),
        parsed({ externalId: 'A-004', topic: 'T', checklist: [{ id: 'i', text: '😀'.repeat(2001), completed: false }] }),
        parsed({ externalId: 'A-005', topic: 'T', checklist: [{ id: 'i', text: '😀'.repeat(2000), completed: false }] }),
      ],
      existing: [],
      columnByTopic: { T: 'c1' },
    })
    expect(plan.rows).toEqual([])
    expect(plan.issues).toEqual([
      { code: 'no_column', cardId: 'A-002' },
      { code: 'checklist_too_many', cardId: 'A-003' },
      { code: 'checklist_text_too_long', cardId: 'A-004' },
    ])
    expect(plan.issues.map(i => importIssueText(i, tPtBR))).toEqual([
      'A-002: sem coluna de destino',
      'A-003: mais de 500 subtarefas',
      'A-004: subtarefa com mais de 2000 caracteres',
    ])
  })
})

describe('planCardRows: Depende de (API-033)', () => {
  const plan = (cards: ParsedBacklogCard[], existing: ExistingCard[] = [], over: { skipDuplicates?: boolean; fallbackColumnId?: string | null } = {}) =>
    planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards, existing, newId: counter(), ...over })
  const card = (externalId: string, dependsOn: string[] = [], over: Partial<ParsedBacklogCard> = {}) =>
    parsed({ externalId, fullTitle: `${externalId} — t`, dependsOn, ...over })
  const deps = (p: ReturnType<typeof plan>) => Object.fromEntries(p.rows.map(r => [r.title.slice(0, 5), r.depends_on]))

  it('o id de cada linha nova vem de newId, na ordem do arquivo; o card pulado não gasta id', () => {
    const p = plan([card('A-001'), card('A-002'), card('A-003')], [onBoard('A-001 — antigo')])
    expect(p.rows.map(r => [r.title, r.id])).toEqual([['A-002 — t', 'n0'], ['A-003 — t', 'n1']])
  })

  it('sem newId, o id é um UUID por linha', () => {
    const p = planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards: [card('A-001'), card('A-002')], existing: [] })
    expect(p.rows.every(r => /^[0-9a-f-]{36}$/.test(r.id))).toBe(true)
    expect(new Set(p.rows.map(r => r.id)).size).toBe(2)
  })

  it('resolve no arquivo (para trás e para a frente), depois no quadro; o que não acha vira aviso sem a aresta', () => {
    const p = plan(
      [card('A-002', ['A-003', 'A-001', 'ZZ-999']), card('A-003'), card('A-004', ['A-002', 'A-002'])],
      [onBoard('A-001 — antigo'), onBoard('A-001 - repetido, mais novo')],
    )
    expect(p.issues).toEqual([])
    expect(deps(p)).toEqual({ 'A-002': ['n1', 'id:A-001 — antigo'], 'A-003': [], 'A-004': ['n0'] })
    expect(p.warnings).toEqual([{ code: 'dependency_not_found', cardId: 'A-002', detail: 'ZZ-999' }])
  })

  it('o ID repetido na lista resolve uma vez, e o aviso de não encontrado sai uma vez', () => {
    const p = plan([card('A-001', ['A-002', 'A-002', 'ZZ-001', 'ZZ-001']), card('A-002')])
    expect(deps(p)['A-001']).toEqual(['n1'])
    expect(p.warnings).toEqual([{ code: 'dependency_not_found', cardId: 'A-001', detail: 'ZZ-001' }])
  })

  it('com skipDuplicates=false, a dependência aponta para a cópia nova do arquivo', () => {
    const p = plan([card('A-001'), card('A-002', ['A-001'])], [onBoard('A-001 — antigo')], { skipDuplicates: false })
    expect(deps(p)['A-002']).toEqual(['n0'])
  })

  it('o card com issue continua no arquivo para as dependências: só a issue dele aparece', () => {
    const p = plan([card('A-001', [], { topic: 'Sem coluna' }), card('A-002', ['A-001'])], [], { fallbackColumnId: null })
    expect(p.rows).toEqual([])
    expect(p.issues.map(i => i.code)).toEqual(['no_column', 'no_column'])
    expect(p.warnings).toEqual([])
  })

  it('ciclo entre as linhas novas bloqueia, com o caminho; quem só depende do ciclo não é outro ciclo', () => {
    const p = plan([card('A-004', ['A-005']), card('A-005', ['A-004']), card('A-006', ['A-004', 'ZZ-001'])])
    expect(p.rows).toEqual([])
    expect(p.issues).toEqual([{ code: 'dependency_cycle', cardId: 'A-004', detail: 'A-004 → A-005 → A-004' }])
    expect(p.issues.map(i => importIssueText(i, tPtBR))).toEqual(['A-004: dependência em ciclo (A-004 → A-005 → A-004)'])
    // Os avisos saem mesmo com issue: a prévia mostra os dois.
    expect(p.warnings).toEqual([{ code: 'dependency_not_found', cardId: 'A-006', detail: 'ZZ-001' }])
  })

  it('o ciclo começa no card que vem antes no arquivo; dois ciclos, duas issues', () => {
    const p = plan([
      card('W-001', ['X-002']), card('X-001', ['X-002']), card('X-002', ['X-001']),
      card('Y-001', ['Y-003']), card('Y-002', ['Y-001']), card('Y-003', ['Y-002']),
    ])
    expect(p.issues).toEqual([
      { code: 'dependency_cycle', cardId: 'X-001', detail: 'X-001 → X-002 → X-001' },
      { code: 'dependency_cycle', cardId: 'Y-001', detail: 'Y-001 → Y-003 → Y-002 → Y-001' },
    ])
  })

  it('a caminhada do ciclo pula a dependência que tem nível', () => {
    const p = plan([card('A-001', ['A-003', 'A-002']), card('A-002', ['A-001']), card('A-003')])
    expect(p.issues).toEqual([{ code: 'dependency_cycle', cardId: 'A-001', detail: 'A-001 → A-002 → A-001' }])
  })

  it('o card que depende de si mesmo (fora do parser) é um ciclo', () => {
    expect(plan([card('A-001', ['A-001'])]).issues).toEqual([{ code: 'dependency_cycle', cardId: 'A-001', detail: 'A-001 → A-001' }])
  })

  it('ciclo que passa por card pulado não conta: o card pulado não muda', () => {
    const p = plan([card('A-001', ['A-002']), card('A-002', ['A-001'])], [onBoard('A-001 — x')])
    expect(p.issues).toEqual([])
    expect(deps(p)).toEqual({ 'A-002': ['id:A-001 — x'] })
    expect(p.warnings).toEqual([{ code: 'dependency_not_applied', cardId: 'A-001', detail: 'A-002' }])
  })

  it('mais de 100 dependências é issue; 100 passa', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `D-${String(i).padStart(3, '0')}`)
    const board = many(101).map(id => onBoard(`${id} — x`))
    expect(plan([card('A-001', many(100))], board).issues).toEqual([])
    const p = plan([card('A-001', many(101))], board)
    expect(p.issues).toEqual([{ code: 'depends_on_too_many', cardId: 'A-001' }])
    expect(p.issues.map(i => importIssueText(i, tPtBR))).toEqual(['A-001: mais de 100 dependências'])
  })

  it('dependency_not_applied cita só o que falta no card do quadro', () => {
    const existing = [
      onBoard('A-001 — a', { depends_on: ['id:A-003 — c'] }),
      onBoard('A-002 — b'),
      onBoard('A-003 — c', { depends_on: [] }),
      onBoard('A-005 — e', { depends_on: ['id:A-003 — c'] }),
    ]
    const p = plan([
      card('A-001', ['A-003', 'A-004', 'ZZ-001']), // já tem A-003; A-004 é novo; ZZ-001 não existe
      card('A-002', ['A-003']), // sem depends_on conhecido: tudo
      card('A-003'), // sem Depende de: sem aviso
      card('A-005', ['A-003']), // já tem tudo: sem aviso
      card('A-004'),
    ], existing)
    expect(p.skippedIds).toEqual(['A-001', 'A-002', 'A-003', 'A-005'])
    expect(p.warnings).toEqual([
      { code: 'dependency_not_applied', cardId: 'A-001', detail: 'A-004, ZZ-001' },
      { code: 'dependency_not_applied', cardId: 'A-002', detail: 'A-003' },
    ])
  })
})

describe('insertBatches', () => {
  const row = (id: string, depends_on: string[] = []) => ({ id, depends_on }) as ImportCardRow
  const ids = (batches: ImportCardRow[][]) => batches.map(b => b.map(r => r.id))

  it('sem dependências entre as linhas, os pedaços de sempre, na ordem do arquivo', () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(`r${i}`, i % 2 ? ['do-quadro'] : []))
    expect(insertBatches(rows, 20).map(b => b.length)).toEqual([20, 20, 5])
    expect(insertBatches(rows, 20).flat()).toEqual(rows)
    expect(insertBatches([], 20)).toEqual([])
  })

  it('por nível: toda dependência de um lote está num lote anterior; no nível, a ordem do arquivo', () => {
    const rows = [row('a', ['b']), row('b'), row('c', ['a', 'b']), row('d'), row('e', ['d', 'do-quadro'])]
    const batches = insertBatches(rows, 2)
    expect(ids(batches)).toEqual([['b', 'd'], ['a', 'e'], ['c']])
    const written = new Set<string>()
    for (const batch of batches) {
      for (const r of batch) expect(r.depends_on.filter(d => rows.some(x => x.id === d) && !written.has(d))).toEqual([])
      for (const r of batch) written.add(r.id)
    }
  })

  it('as linhas do plano saem com a dependência para a frente num lote anterior', () => {
    const cards = [parsed({ externalId: 'A-001', fullTitle: 'A-001 — a', dependsOn: ['A-002'] }), parsed({ externalId: 'A-002', fullTitle: 'A-002 — b' })]
    const { rows } = planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards, existing: [], newId: counter() })
    expect(ids(insertBatches(rows, 20))).toEqual([['n1'], ['n0']])
  })

  it('lança com lote < 1, id repetido ou ciclo, em vez de perder linha', () => {
    expect(() => insertBatches([row('a')], 0)).toThrow(RangeError)
    expect(() => insertBatches([row('a'), row('a')], 20)).toThrow('id repetido')
    expect(() => insertBatches([row('a', ['b']), row('b', ['a'])], 20)).toThrow('ciclo')
  })
})

describe('importIssueText e importWarningText (API-033)', () => {
  const ISSUE_CODES: ImportIssueCode[] = ['no_column', 'checklist_too_many', 'checklist_text_too_long', 'dependency_cycle', 'depends_on_too_many']

  it('cada issue tem texto; o ciclo leva o caminho', () => {
    expect(ISSUE_CODES.map(code => importIssueText({ code, cardId: 'A-001' }, tPtBR))).toEqual([
      'A-001: sem coluna de destino',
      'A-001: mais de 500 subtarefas',
      'A-001: subtarefa com mais de 2000 caracteres',
      'A-001: dependência em ciclo ()',
      'A-001: mais de 100 dependências',
    ])
  })

  it('o texto da issue sai do `t` que recebe, com {id}, {detail} e o limite em {max}', () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key} ${JSON.stringify(vars)}`
    expect(importIssueText({ code: 'dependency_cycle', cardId: 'A-001', detail: 'A-001 → A-001' }, t))
      .toBe('projects_import_error_dependency_cycle {"id":"A-001","detail":"A-001 → A-001","max":""}')
    expect(ISSUE_CODES.map(code => importIssueText({ code, cardId: 'A-001' }, t))).toEqual([
      'projects_import_error_no_column {"id":"A-001","detail":"","max":""}',
      'projects_import_error_checklist_too_many {"id":"A-001","detail":"","max":500}',
      'projects_import_error_checklist_text_too_long {"id":"A-001","detail":"","max":2000}',
      'projects_import_error_dependency_cycle {"id":"A-001","detail":"","max":""}',
      'projects_import_error_depends_on_too_many {"id":"A-001","detail":"","max":100}',
    ])
  })

  it('cada aviso de dependência sai com o texto da tela', () => {
    const codes: ImportWarningCode[] = ['dependency_not_found', 'dependency_not_applied']
    const texts = codes.map(code => importWarningText({ code, cardId: 'A-001', detail: 'A-002, A-003' }, tPtBR))
    expect(texts).toEqual(codes.map(code => DOMAIN_PT_BR[`projects_import_warning_${code}`].replace('{id}', 'A-001').replace('{detail}', 'A-002, A-003')))
    expect(texts[0]).toBe('A-001: a dependência A-002, A-003 não está no arquivo nem no quadro e ficou de fora')
  })
})

describe('oldestFirst (API-033)', () => {
  const at = (id: string, created_at: string) => ({ id, created_at })

  it('created_at e, no empate, o id; devolve uma cópia', () => {
    const cards = [at('b', '2026-10-02T00:00:00+00:00'), at('c', '2026-10-01T00:00:00+00:00'), at('a', '2026-10-02T00:00:00+00:00')]
    expect(oldestFirst(cards).map(c => c.id)).toEqual(['c', 'a', 'b'])
    expect(cards.map(c => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('compara o texto do PostgREST como o Postgres: microssegundos e uuid byte a byte', () => {
    // O Date.parse dá .123 aos três e deixaria o id decidir ('0…' primeiro).
    const cards = [
      at('0aaaaaaa-0000-4000-8000-000000000000', '2026-10-01T12:00:00.123456+00:00'),
      at('ffffffff-0000-4000-8000-000000000000', '2026-10-01T12:00:00.123+00:00'),
      at('a0000000-0000-4000-8000-000000000000', '2026-10-01T12:00:00.1235+00:00'),
      at('9fffffff-0000-4000-8000-000000000000', '2026-10-01T12:00:00+00:00'),
    ]
    expect(oldestFirst(cards).map(c => c.id.slice(0, 2))).toEqual(['9f', 'ff', '0a', 'a0'])
    // Mesmo instante: o id, dígito antes de letra.
    const tie = '2026-10-01T12:00:00.5+00:00'
    expect(oldestFirst([at('a0', tie), at('9f', tie), at('0a', tie)]).map(c => c.id)).toEqual(['0a', '9f', 'a0'])
  })
})

describe('importLabels', () => {
  it('até 30: limpa e sem repetidos, na ordem', () => {
    expect(importLabels({ labels: [' a ', 'A', 'b'], topic: null })).toEqual(['a', 'b'])
  })

  it('acima de 30, tema e esforço vêm primeiro para não serem cortados', () => {
    const many = Array.from({ length: 35 }, (_, i) => `l${i}`)
    const out = importLabels({ labels: [...many, 'segurança', 'esforço:m'], topic: ' Segurança ' })
    expect(out).toHaveLength(30)
    expect(out.slice(0, 2)).toEqual(['segurança', 'esforço:m'])
  })
})

describe('titleMatchesExternalId', () => {
  it('só o prefixo "ID —" ou "ID -"', () => {
    expect(titleMatchesExternalId('A-001 — x', 'A-001')).toBe(true)
    expect(titleMatchesExternalId('A-001 - x', 'A-001')).toBe(true)
    expect(titleMatchesExternalId('A-0011 — x', 'A-001')).toBe(false)
    expect(titleMatchesExternalId('x A-001 — x', 'A-001')).toBe(false)
  })
})

describe('planTopicColumns', () => {
  it('reaproveita coluna de mesmo nome sem acento nem caixa; as novas vêm depois da maior', () => {
    const plan = planTopicColumns(['Saúde', 'Novo', 'Outro'], [{ id: 'k1', name: 'saude', sort_order: 3 }, { id: 'k2', name: 'Z', sort_order: 7 }])
    expect(plan).toEqual([
      { topic: 'Saúde', name: 'saude', color: TOPIC_COLUMN_COLORS[0], columnId: 'k1', sortOrder: 3 },
      { topic: 'Novo', name: 'Novo', color: TOPIC_COLUMN_COLORS[1], columnId: null, sortOrder: 8 },
      { topic: 'Outro', name: 'Outro', color: TOPIC_COLUMN_COLORS[2], columnId: null, sortOrder: 9 },
    ])
  })

  it('quadro vazio começa do 0, e a cor volta ao início depois da 8ª', () => {
    const plan = planTopicColumns(Array.from({ length: 9 }, (_, i) => `T${i}`), [])
    expect(plan.map(p => p.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(plan[8].color).toBe(plan[0].color)
  })
})

describe('backlogIssueText', () => {
  it('cada aviso do parser sai com o texto da tela de importação', () => {
    const codes: BacklogIssueCode[] = ['invalid_heading', 'id_mismatch', 'no_subtasks', 'no_priority', 'no_effort', 'no_topic', 'duplicate_id', 'no_cards', 'invalid_dependency', 'self_dependency']
    const texts = codes.map(code => backlogIssueText({ code, cardId: 'A-001', detail: 'A-002' }, tPtBR))
    expect(texts).toEqual(codes.map(code => DOMAIN_PT_BR[`projects_import_issue_${code}`].replace('{id}', 'A-001').replace('{detail}', 'A-002')))
    expect(backlogIssueText({ code: 'no_cards' }, tPtBR)).toBe('Nenhum card encontrado no arquivo')
    expect(backlogIssueText({ code: 'no_effort' }, tPtBR)).toBe(': sem esforço')
  })

  it('o parser real devolve os códigos que a API mostra no dry_run', () => {
    const r = parseBacklogMarkdown('### CARD AB-001 — Sem nada\n', { newId: () => 'x' })
    expect(r.issues.map(i => backlogIssueText(i, tPtBR))).toEqual([
      'AB-001: nenhuma subtarefa encontrada',
      'AB-001: sem prioridade, usando média',
      'AB-001: sem esforço',
      'AB-001: sem seção Tópico',
    ])
  })
})

describe('parseBacklogMarkdown com newId', () => {
  it('o id de cada subtarefa vem de newId, na ordem do arquivo', () => {
    let n = 0
    const md = [
      '## Tópico: T',
      '### CARD AB-001 — Um',
      '| Campo | Valor |', '|---|---|', '| Prioridade | P1 |', '| Esforço | S |',
      '**Subtarefas Kanban:**', '- [ ] a', '- [x] b',
      '### CARD AB-002 — Dois',
      '- **Prioridade:** P0', '- **Esforço:** L',
      '**Subtarefas Kanban:**', '- [ ] c',
    ].join('\n')
    const r = parseBacklogMarkdown(md, { newId: () => `id${n++}` })
    expect(r.cards.map(c => c.checklist.map(i => [i.id, i.text, i.completed]))).toEqual([
      [['id0', 'a', false], ['id1', 'b', true]],
      [['id2', 'c', false]],
    ])
    expect(r.cards.map(c => [c.priority, c.effort, c.labels])).toEqual([['high', 'S', ['t', 'esforço:s']], ['urgent', 'L', ['t', 'esforço:l']]])
    expect(r.issues).toEqual([])
  })

  it('sem newId, ids aleatórios e distintos', () => {
    const r = parseBacklogMarkdown('### CARD AB-001 — Um\n**Subtarefas Kanban:**\n- [ ] a\n- [ ] b\n')
    const ids = r.cards[0].checklist.map(i => i.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(id => /^[0-9a-f-]{36}$/.test(id))).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { parseBacklogMarkdown, type BacklogIssueCode, type ParsedBacklogCard } from './backlogMarkdownParser.ts'
import { DOMAIN_PT_BR, tPtBR } from './i18n.pt-BR.ts'
import {
  backlogIssueText,
  importIssueText,
  importLabels,
  planCardRows,
  planTopicColumns,
  titleMatchesExternalId,
  TOPIC_COLUMN_COLORS,
} from './importPlan.ts'

// API-027: o plano da importação de backlog, sem banco. A gravação (supabase-js)
// fica nos testes de src/lib/importProjectCards.test.ts.

function parsed(over: Partial<ParsedBacklogCard> = {}): ParsedBacklogCard {
  return {
    externalId: 'A-001', title: 'Um', fullTitle: 'A-001 — Um', topic: null, priority: 'high', effort: 'M',
    labels: ['x'], description: 'd', checklist: [{ id: 'i1', text: 'faz', completed: false }], files: [], ...over,
  }
}

describe('planCardRows', () => {
  it('continua o sort_order de cada coluna depois do maior que ela já tem', () => {
    const plan = planCardRows({
      boardId: 'b1',
      fallbackColumnId: 'c1',
      cards: [parsed({ externalId: 'A-001', topic: 'T' }), parsed({ externalId: 'A-002' }), parsed({ externalId: 'A-003', topic: 'T' })],
      existing: [
        { title: 'X', column_id: 'c1', sort_order: 4 },
        { title: 'Y', column_id: 'c1', sort_order: 1 },
        { title: 'Z', column_id: 'c2', sort_order: 9 },
      ],
      columnByTopic: { T: 'c2' },
    })
    expect(plan.issues).toEqual([])
    expect(plan.rows.map(r => [r.column_id, r.sort_order])).toEqual([['c2', 10], ['c1', 5], ['c2', 11]])
    expect(plan.rows[0]).toEqual({
      board_id: 'b1', column_id: 'c2', title: 'A-001 — Um', description: 'd', priority: 'high', due_date: null,
      assignee_user_id: null, labels: ['x'], linked_page_id: null, completed: false,
      checklist: [{ id: 'i1', text: 'faz', completed: false }], attachments: [], sort_order: 10,
    })
  })

  it('coluna nova começa do 0; tópico sem coluna cai na coluna padrão', () => {
    const plan = planCardRows({ boardId: 'b1', fallbackColumnId: 'c9', cards: [parsed({ topic: 'Sem coluna' })], existing: [], columnByTopic: {} })
    expect(plan.rows.map(r => [r.column_id, r.sort_order])).toEqual([['c9', 0]])
  })

  it('pula o card que já está no quadro ("ID —" ou "ID -"), salvo com skipDuplicates=false', () => {
    const cards = [parsed({ externalId: 'A-001' }), parsed({ externalId: 'A-002', fullTitle: 'A-002 — Dois' }), parsed({ externalId: 'A-003', fullTitle: 'A-003 — Três' })]
    const existing = [{ title: 'A-001 — Um', column_id: 'c1', sort_order: 0 }, { title: 'A-002 - Dois', column_id: 'c1', sort_order: 1 }]
    const skip = planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards, existing })
    expect(skip.skippedIds).toEqual(['A-001', 'A-002'])
    expect(skip.rows.map(r => r.title)).toEqual(['A-003 — Três'])
    const all = planCardRows({ boardId: 'b1', fallbackColumnId: 'c1', cards, existing, skipDuplicates: false })
    expect(all.skippedIds).toEqual([])
    expect(all.rows.map(r => r.sort_order)).toEqual([2, 3, 4])
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
    expect(plan.issues.map(importIssueText)).toEqual([
      'A-002: sem coluna de destino',
      'A-003: mais de 500 subtarefas',
      'A-004: subtarefa com mais de 2000 caracteres',
    ])
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
    const codes: BacklogIssueCode[] = ['invalid_heading', 'id_mismatch', 'no_subtasks', 'no_priority', 'no_effort', 'no_topic', 'duplicate_id', 'no_cards']
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

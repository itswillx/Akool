import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getT, loadLang } from '../i18n/translations'
import type { Database } from '../types/db'
import { ensureTopicColumns, importParsedCards, planTopicColumns } from './importProjectCards'
import type { ParsedBacklogCard } from './backlogMarkdownParser'
import { FETCH_PAGE_SIZE } from './fetchAllRows'

function makeParsedCard(overrides: Partial<ParsedBacklogCard> = {}): ParsedBacklogCard {
  return {
    externalId: 'SEC-001',
    title: 'Test card',
    fullTitle: 'SEC-001 — Test card',
    topic: 'Segurança',
    priority: 'medium',
    effort: 'M',
    labels: ['segurança'],
    description: '**Problema:** test',
    checklist: [{ id: '1', text: 'Task', completed: false }],
    files: [],
    dependsOn: [],
    ...overrides,
  }
}

type QueryResult = { data: unknown; error: { message: string } | null }

/**
 * O cliente da leitura (select … range, em páginas) e da gravação (insert). A
 * leitura devolve `pages` em ordem; `boardCardsResult` é a página única.
 */
function createMockSupabase(config: {
  boardCardsResult?: QueryResult
  pages?: QueryResult[]
  insertResult?: QueryResult | ((rows: unknown[]) => QueryResult)
}) {
  const insertCalls: unknown[][] = []
  const reads: { columns: string; eq: unknown[][]; order: unknown[][]; range: number[] }[] = []
  const pages = config.pages ?? [config.boardCardsResult ?? { data: [], error: null }]

  const supabase = {
    from: vi.fn(() => ({
      select: (columns: string) => {
        const read = { columns, eq: [] as unknown[][], order: [] as unknown[][], range: [] as number[] }
        reads.push(read)
        const builder = {
          eq: (...args: unknown[]) => { read.eq.push(args); return builder },
          order: (...args: unknown[]) => { read.order.push(args); return builder },
          range: (from: number, to: number) => {
            read.range = [from, to]
            return Promise.resolve(pages[reads.length - 1] ?? { data: [], error: null })
          },
        }
        return builder
      },
      insert: vi.fn(async (rows: unknown[]) => {
        insertCalls.push(rows)
        return typeof config.insertResult === 'function'
          ? config.insertResult(rows)
          : (config.insertResult ?? { data: null, error: null })
      }),
    })),
  }

  return { supabase: supabase as unknown as SupabaseClient<Database>, insertCalls, reads }
}

describe('importParsedCards', () => {
  it('returns error when existing titles query fails', async () => {
    const { supabase } = createMockSupabase({
      boardCardsResult: { data: null, error: { message: 'DB unavailable' } },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard()])

    expect(result).toEqual({ created: 0, skipped: 0, skippedIds: [], errors: ['DB unavailable'], warnings: [] })
  })

  it('skips duplicates when skipDuplicates is true', async () => {
    const { supabase } = createMockSupabase({
      boardCardsResult: { data: [{ title: 'SEC-001 — Existing card', column_id: 'col-1', sort_order: 0 }], error: null },
    })

    const result = await importParsedCards(
      supabase,
      'board-1',
      'col-1',
      [makeParsedCard(), makeParsedCard({ externalId: 'PERF-002', fullTitle: 'PERF-002 — New card' })],
    )

    expect(result.skipped).toBe(1)
    // UX-009: o resultado diz quais IDs foram pulados, não só quantos.
    expect(result.skippedIds).toEqual(['SEC-001'])
    expect(result.created).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('skips duplicates with hyphen separator variant', async () => {
    const { supabase } = createMockSupabase({
      boardCardsResult: { data: [{ title: 'SEC-001 - Existing card', column_id: 'col-1', sort_order: 0 }], error: null },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard()])

    expect(result.skipped).toBe(1)
    expect(result.skippedIds).toEqual(['SEC-001'])
    expect(result.created).toBe(0)
  })

  it('calculates sort_order from highest existing in column', async () => {
    const { supabase, insertCalls } = createMockSupabase({
      boardCardsResult: {
        data: [
          { title: 'X-001 — Old', column_id: 'col-1', sort_order: 7 },
          { title: 'X-002 — Other column', column_id: 'col-2', sort_order: 30 },
        ],
        error: null,
      },
    })

    await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — First' }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — Second' }),
    ])

    expect(insertCalls).toHaveLength(1)
    const rows = insertCalls[0] as { sort_order: number }[]
    expect(rows[0].sort_order).toBe(8)
    expect(rows[1].sort_order).toBe(9)
  })

  // API-013: o gatilho recusa rótulo repetido sem caixa, longo ou além de 30
  // (e derrubaria o lote inteiro); o updated_at é do servidor.
  it('sends labels in the server format and no updated_at', async () => {
    const { supabase, insertCalls } = createMockSupabase({})
    await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ labels: ['segurança', 'Segurança', `${'x'.repeat(60)}`] }),
    ])
    const [row] = insertCalls[0] as Record<string, unknown>[]
    expect(row.labels).toEqual(['segurança', 'x'.repeat(50)])
    expect(row).not.toHaveProperty('updated_at')
  })

  it('over 30 labels: the generated topic and effort labels are kept, not cut', async () => {
    const { supabase, insertCalls } = createMockSupabase({})
    const many = Array.from({ length: 35 }, (_, i) => `l${i}`)
    await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard({ labels: [...many, 'segurança', 'esforço:m'] })])
    const [row] = insertCalls[0] as { labels: string[] }[]
    expect(row.labels).toHaveLength(30)
    expect(row.labels.slice(0, 2)).toEqual(['segurança', 'esforço:m'])
  })

  it('reports a card whose checklist is over the server limits instead of failing the batch', async () => {
    const { supabase, insertCalls } = createMockSupabase({})
    const many = Array.from({ length: 501 }, (_, i) => ({ id: String(i), text: 't', completed: false }))
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — Muitas', checklist: many }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — Longa', checklist: [{ id: '1', text: 'y'.repeat(2001), completed: false }] }),
    ])
    expect(result.errors).toEqual(['A-001: mais de 500 subtarefas', 'A-002: subtarefa com mais de 2000 caracteres'])
    expect(insertCalls).toHaveLength(0)
  })

  it('inserts cards in batches of 20', async () => {
    const cards = Array.from({ length: 25 }, (_, i) =>
      makeParsedCard({
        externalId: `CARD-${String(i).padStart(3, '0')}`,
        fullTitle: `CARD-${String(i).padStart(3, '0')} — Card ${i}`,
      }),
    )
    const { supabase, insertCalls } = createMockSupabase({})

    const result = await importParsedCards(supabase, 'board-1', 'col-1', cards)

    expect(result.created).toBe(25)
    expect(insertCalls).toHaveLength(2)
    expect(insertCalls[0]).toHaveLength(20)
    expect(insertCalls[1]).toHaveLength(5)
  })

  it('propagates insert errors without inflating created count', async () => {
    let insertAttempt = 0
    const cards = Array.from({ length: 25 }, (_, i) =>
      makeParsedCard({
        externalId: `ERR-${String(i).padStart(3, '0')}`,
        fullTitle: `ERR-${String(i).padStart(3, '0')} — Card ${i}`,
      }),
    )
    const { supabase } = createMockSupabase({
      insertResult: () => {
        insertAttempt++
        if (insertAttempt === 2) {
          return { data: null, error: { message: 'Insert failed on batch 2' } }
        }
        return { data: null, error: null }
      },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', cards)

    expect(result.created).toBe(20)
    expect(result.errors).toEqual(['Insert failed on batch 2'])
  })

  it('does not skip duplicates when skipDuplicates is false', async () => {
    const { supabase, insertCalls } = createMockSupabase({
      boardCardsResult: { data: [{ title: 'SEC-001 — Existing card', column_id: 'col-1', sort_order: 0 }], error: null },
    })

    const result = await importParsedCards(
      supabase,
      'board-1',
      'col-1',
      [makeParsedCard()],
      { skipDuplicates: false },
    )

    expect(result.skipped).toBe(0)
    expect(result.skippedIds).toEqual([])
    expect(result.created).toBe(1)
    expect(insertCalls).toHaveLength(1)
  })

  it('distributes cards by topic and keeps sort_order per column', async () => {
    const { supabase, insertCalls } = createMockSupabase({
      boardCardsResult: { data: [{ title: 'OLD-001 — Old', column_id: 'col-sec', sort_order: 4 }], error: null },
    })

    const result = await importParsedCards(
      supabase,
      'board-1',
      'col-todo',
      [
        makeParsedCard({ externalId: 'SEC-001', fullTitle: 'SEC-001 — A', topic: 'Segurança' }),
        makeParsedCard({ externalId: 'PERF-001', fullTitle: 'PERF-001 — B', topic: 'Performance' }),
        makeParsedCard({ externalId: 'SEC-002', fullTitle: 'SEC-002 — C', topic: 'Segurança' }),
        makeParsedCard({ externalId: 'MISC-001', fullTitle: 'MISC-001 — D', topic: null }),
      ],
      { columnByTopic: { 'Segurança': 'col-sec', Performance: 'col-perf' } },
    )

    expect(result).toEqual({ created: 4, skipped: 0, skippedIds: [], errors: [], warnings: [] })
    const rows = insertCalls[0] as { column_id: string; sort_order: number }[]
    expect(rows.map(r => [r.column_id, r.sort_order])).toEqual([
      ['col-sec', 5],
      ['col-perf', 0],
      ['col-sec', 6],
      ['col-todo', 0],
    ])
  })

  // API-033: o quadro inteiro (REL-003), do mais antigo para o mais novo, com
  // o que o plano precisa para pular e resolver Depende de.
  it('reads every page of the board, oldest first', async () => {
    const page = (n: number, from: number) => ({
      data: Array.from({ length: n }, (_, i) => ({ id: `c${from + i}`, title: `OLD-${String((from + i) % 1000).padStart(3, '0')} — x`, column_id: 'col-1', sort_order: from + i, depends_on: [] })),
      error: null,
    })
    const { supabase, reads, insertCalls } = createMockSupabase({ pages: [page(FETCH_PAGE_SIZE, 0), page(3, FETCH_PAGE_SIZE)] })
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard({ externalId: 'NEW-001', fullTitle: 'NEW-001 — n' })])
    expect(reads.map(r => r.range)).toEqual([[0, FETCH_PAGE_SIZE - 1], [FETCH_PAGE_SIZE, 2 * FETCH_PAGE_SIZE - 1]])
    expect(reads[0]).toMatchObject({
      columns: 'id, title, column_id, sort_order, depends_on, created_at',
      eq: [['board_id', 'board-1']],
      order: [['created_at', { ascending: true }], ['id', { ascending: true }]],
    })
    // O sort_order continua depois do maior, que só vem na 2ª página.
    expect((insertCalls[0] as { sort_order: number }[])[0].sort_order).toBe(FETCH_PAGE_SIZE + 3)
    expect(result.created).toBe(1)
  })

  it('a dependency that comes later in the file is inserted in an earlier call, with the generated id', async () => {
    const { supabase, insertCalls } = createMockSupabase({
      boardCardsResult: { data: [{ id: 'board-sec', title: 'SEC-001 — antigo', column_id: 'col-1', sort_order: 0, depends_on: [] }], error: null },
    })
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'EXE-001', fullTitle: 'EXE-001 — depende', dependsOn: ['EXE-002', 'SEC-001', 'ZZ-404'] }),
      makeParsedCard({ externalId: 'EXE-002', fullTitle: 'EXE-002 — base' }),
    ])
    const [first, second] = insertCalls as { id: string; title: string; depends_on: string[] }[][]
    expect(insertCalls).toHaveLength(2)
    expect(first.map(r => [r.title, r.depends_on])).toEqual([['EXE-002 — base', []]])
    expect(second.map(r => r.title)).toEqual(['EXE-001 — depende'])
    expect(second[0].depends_on).toEqual([first[0].id, 'board-sec'])
    expect(first[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result).toEqual({
      created: 2, skipped: 0, skippedIds: [], errors: [],
      warnings: [{ code: 'dependency_not_found', cardId: 'EXE-001', detail: 'ZZ-404' }],
    })
  })

  it('a cycle is an error and nothing is inserted', async () => {
    const { supabase, insertCalls } = createMockSupabase({})
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — a', dependsOn: ['A-002'] }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — b', dependsOn: ['A-001'] }),
    ])
    expect(result.errors).toEqual(['A-001: dependência em ciclo (A-001 → A-002 → A-001)'])
    expect(insertCalls).toHaveLength(0)
  })

  // API-033: a prévia (ImportCardsModal) e a gravação escolhem o mesmo card de
  // cada ID externo pelo oldestFirst, não pela ordem em que as linhas chegam.
  it('two board cards with the same external ID: the oldest one counts, whatever order the rows arrive in', async () => {
    const { supabase, insertCalls } = createMockSupabase({
      boardCardsResult: {
        data: [
          { id: 'z-copy', title: 'A-001 — cópia', column_id: 'col-1', sort_order: 0, depends_on: [], created_at: '2026-10-02T12:00:00+00:00' },
          { id: 'b3', title: 'A-003 — base', column_id: 'col-1', sort_order: 1, depends_on: [], created_at: '2026-10-01T12:00:00.5+00:00' },
          { id: 'x-old', title: 'A-001 — antigo', column_id: 'col-1', sort_order: 5, depends_on: ['b3'], created_at: '2026-10-01T12:00:00.123456+00:00' },
        ],
        error: null,
      },
    })
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — a', dependsOn: ['A-003'] }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — b', dependsOn: ['A-001'] }),
    ])
    expect(result.skippedIds).toEqual(['A-001'])
    expect(result.warnings).toEqual([])
    expect((insertCalls[0] as { depends_on: string[] }[]).map(r => r.depends_on)).toEqual([['x-old']])
  })

  it('the problems that block the import come in the language of the given t', async () => {
    await loadLang('en')
    const cycle = [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — a', dependsOn: ['A-002'] }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — b', dependsOn: ['A-001'] }),
    ]
    const en = await importParsedCards(createMockSupabase({}).supabase, 'board-1', 'col-1', cycle, { t: getT('en') })
    expect(en.errors).toEqual(['A-001: dependency cycle (A-001 → A-002 → A-001)'])
    const many = Array.from({ length: 501 }, (_, i) => ({ id: String(i), text: 't', completed: false }))
    const limit = await importParsedCards(createMockSupabase({}).supabase, 'board-1', 'col-1', [makeParsedCard({ checklist: many })], { t: getT('en') })
    expect(limit.errors).toEqual(['SEC-001: more than 500 subtasks'])
  })

  it('a skipped card with Depende de is reported, unless the board card already has it', async () => {
    const { supabase } = createMockSupabase({
      boardCardsResult: {
        data: [
          { id: 'b1', title: 'A-001 — já tem', column_id: 'col-1', sort_order: 0, depends_on: ['b3'] },
          { id: 'b2', title: 'A-002 — falta', column_id: 'col-1', sort_order: 1, depends_on: [] },
          { id: 'b3', title: 'A-003 — base', column_id: 'col-1', sort_order: 2, depends_on: [] },
        ],
        error: null,
      },
    })
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — já tem', dependsOn: ['A-003'] }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — falta', dependsOn: ['A-003'] }),
    ])
    expect(result.skippedIds).toEqual(['A-001', 'A-002'])
    expect(result.warnings).toEqual([{ code: 'dependency_not_applied', cardId: 'A-002', detail: 'A-003' }])
  })

  it('when a later level fails, every card already written has its dependencies written', async () => {
    let attempt = 0
    const { supabase, insertCalls } = createMockSupabase({
      insertResult: () => (++attempt === 2 ? { data: null, error: { message: 'boom' } } : { data: null, error: null }),
    })
    const result = await importParsedCards(supabase, 'board-1', 'col-1', [
      makeParsedCard({ externalId: 'A-001', fullTitle: 'A-001 — topo', dependsOn: ['A-002'] }),
      makeParsedCard({ externalId: 'A-002', fullTitle: 'A-002 — base' }),
    ])
    expect((insertCalls[0] as { title: string }[]).map(r => r.title)).toEqual(['A-002 — base'])
    expect(result).toMatchObject({ created: 1, errors: ['boom'] })
  })

  it('refuses to insert when a card has no target column', async () => {
    const { supabase, insertCalls } = createMockSupabase({})

    const result = await importParsedCards(
      supabase,
      'board-1',
      null,
      [makeParsedCard({ topic: null })],
      { columnByTopic: {} },
    )

    expect(result.created).toBe(0)
    expect(result.errors).toEqual(['SEC-001: sem coluna de destino'])
    expect(insertCalls).toHaveLength(0)
  })
})

describe('planTopicColumns', () => {
  const existing = [
    { id: 'c-todo', name: 'A Fazer', sort_order: 0 },
    { id: 'c-doing', name: 'Fazendo', sort_order: 1 },
    { id: 'c-done', name: 'Concluído', sort_order: 2 },
    { id: 'c-ux', name: 'UX e Acessibilidade', sort_order: 3 },
  ]

  it('appends new columns after the existing ones, in file order', () => {
    const plan = planTopicColumns(['Segurança', 'Performance'], existing)

    expect(plan.map(p => [p.name, p.columnId, p.sortOrder])).toEqual([
      ['Segurança', null, 4],
      ['Performance', null, 5],
    ])
  })

  it('reuses existing columns ignoring accents and case', () => {
    const plan = planTopicColumns(
      ['ux e acessibilidade', 'Seguranca'],
      [...existing, { id: 'c-sec', name: 'Segurança', sort_order: 4 }],
    )

    expect(plan).toEqual([
      expect.objectContaining({ topic: 'ux e acessibilidade', name: 'UX e Acessibilidade', columnId: 'c-ux', sortOrder: 3 }),
      expect.objectContaining({ topic: 'Seguranca', name: 'Segurança', columnId: 'c-sec', sortOrder: 4 }),
    ])
  })

  it('starts at 0 on a board without columns and cycles colors', () => {
    const topics = Array.from({ length: 9 }, (_, i) => `T${i}`)
    const plan = planTopicColumns(topics, [])

    expect(plan[0].sortOrder).toBe(0)
    expect(plan[8].sortOrder).toBe(8)
    expect(plan[8].color).toBe(plan[0].color)
    expect(plan[1].color).not.toBe(plan[0].color)
  })
})

describe('ensureTopicColumns', () => {
  function mockColumnsInsert(result: QueryResult) {
    const inserted: unknown[][] = []
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn((rows: unknown[]) => {
          inserted.push(rows)
          return { select: vi.fn(async () => result) }
        }),
      })),
    }
    return { supabase: supabase as unknown as SupabaseClient<Database>, inserted }
  }

  it('inserts only missing columns and returns the full topic map', async () => {
    const { supabase, inserted } = mockColumnsInsert({ data: [{ id: 'new-perf', name: 'Performance' }], error: null })
    const plan = [
      { topic: 'Segurança', name: 'Segurança', color: '#ef4444', columnId: 'c-sec', sortOrder: 3 },
      { topic: 'Performance', name: 'Performance', color: '#06b6d4', columnId: null, sortOrder: 4 },
    ]

    const result = await ensureTopicColumns(supabase, 'board-1', plan)

    expect(inserted).toEqual([[{ board_id: 'board-1', name: 'Performance', color: '#06b6d4', sort_order: 4 }]])
    expect(result).toEqual({ columnByTopic: { 'Segurança': 'c-sec', Performance: 'new-perf' }, created: 1 })
  })

  it('skips the insert when every column already exists', async () => {
    const { supabase, inserted } = mockColumnsInsert({ data: [], error: null })

    const result = await ensureTopicColumns(supabase, 'board-1', [
      { topic: 'Segurança', name: 'Segurança', color: '#ef4444', columnId: 'c-sec', sortOrder: 3 },
    ])

    expect(inserted).toHaveLength(0)
    expect(result.created).toBe(0)
  })

  it('reports insert errors', async () => {
    const { supabase } = mockColumnsInsert({ data: null, error: { message: 'RLS denied' } })

    const result = await ensureTopicColumns(supabase, 'board-1', [
      { topic: 'Performance', name: 'Performance', color: '#06b6d4', columnId: null, sortOrder: 0 },
    ])

    expect(result.error).toBe('RLS denied')
    expect(result.created).toBe(0)
  })
})

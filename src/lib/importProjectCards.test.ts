import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureTopicColumns, importParsedCards, planTopicColumns } from './importProjectCards'
import type { ParsedBacklogCard } from './backlogMarkdownParser'

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
    ...overrides,
  }
}

type QueryResult = { data: unknown; error: { message: string } | null }

function makeThenableBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(function select() { return builder }),
    eq: vi.fn(function eq() { return builder }),
    order: vi.fn(function order() { return builder }),
    limit: vi.fn(function limit() { return builder }),
    then(
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  return builder
}

function createMockSupabase(config: {
  boardCardsResult?: QueryResult
  insertResult?: QueryResult | ((rows: unknown[]) => QueryResult)
}) {
  const insertCalls: unknown[][] = []
  let fromCallIndex = 0

  const supabase = {
    from: vi.fn(() => {
      fromCallIndex++
      if (fromCallIndex === 1) {
        return makeThenableBuilder(config.boardCardsResult ?? { data: [], error: null })
      }
      return {
        insert: vi.fn(async (rows: unknown[]) => {
          insertCalls.push(rows)
          const result =
            typeof config.insertResult === 'function'
              ? config.insertResult(rows)
              : (config.insertResult ?? { data: null, error: null })
          return result
        }),
      }
    }),
  }

  return { supabase: supabase as unknown as SupabaseClient, insertCalls }
}

describe('importParsedCards', () => {
  it('returns error when existing titles query fails', async () => {
    const { supabase } = createMockSupabase({
      boardCardsResult: { data: null, error: { message: 'DB unavailable' } },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard()])

    expect(result).toEqual({ created: 0, skipped: 0, skippedIds: [], errors: ['DB unavailable'] })
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

    expect(result).toEqual({ created: 4, skipped: 0, skippedIds: [], errors: [] })
    const rows = insertCalls[0] as { column_id: string; sort_order: number }[]
    expect(rows.map(r => [r.column_id, r.sort_order])).toEqual([
      ['col-sec', 5],
      ['col-perf', 0],
      ['col-sec', 6],
      ['col-todo', 0],
    ])
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
    return { supabase: supabase as unknown as SupabaseClient, inserted }
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

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importParsedCards } from './importProjectCards'
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
  titlesResult?: QueryResult
  sortResult?: QueryResult
  insertResult?: QueryResult | ((rows: unknown[]) => QueryResult)
}) {
  const insertCalls: unknown[][] = []
  let fromCallIndex = 0

  const supabase = {
    from: vi.fn(() => {
      fromCallIndex++
      if (fromCallIndex === 1) {
        return makeThenableBuilder(config.titlesResult ?? { data: [], error: null })
      }
      if (fromCallIndex === 2) {
        return makeThenableBuilder(config.sortResult ?? { data: [{ sort_order: -1 }], error: null })
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
      titlesResult: { data: null, error: { message: 'DB unavailable' } },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard()])

    expect(result).toEqual({ created: 0, skipped: 0, errors: ['DB unavailable'] })
  })

  it('returns error when sort order query fails', async () => {
    const { supabase } = createMockSupabase({
      titlesResult: { data: [], error: null },
      sortResult: { data: null, error: { message: 'Sort query failed' } },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard()])

    expect(result).toEqual({ created: 0, skipped: 0, errors: ['Sort query failed'] })
  })

  it('skips duplicates when skipDuplicates is true', async () => {
    const { supabase } = createMockSupabase({
      titlesResult: { data: [{ title: 'SEC-001 — Existing card' }], error: null },
    })

    const result = await importParsedCards(
      supabase,
      'board-1',
      'col-1',
      [makeParsedCard(), makeParsedCard({ externalId: 'PERF-002', fullTitle: 'PERF-002 — New card' })],
    )

    expect(result.skipped).toBe(1)
    expect(result.created).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('skips duplicates with hyphen separator variant', async () => {
    const { supabase } = createMockSupabase({
      titlesResult: { data: [{ title: 'SEC-001 - Existing card' }], error: null },
    })

    const result = await importParsedCards(supabase, 'board-1', 'col-1', [makeParsedCard()])

    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
  })

  it('calculates sort_order from highest existing in column', async () => {
    const { supabase, insertCalls } = createMockSupabase({
      sortResult: { data: [{ sort_order: 7 }], error: null },
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
      titlesResult: { data: [{ title: 'SEC-001 — Existing card' }], error: null },
    })

    const result = await importParsedCards(
      supabase,
      'board-1',
      'col-1',
      [makeParsedCard()],
      { skipDuplicates: false },
    )

    expect(result.skipped).toBe(0)
    expect(result.created).toBe(1)
    expect(insertCalls).toHaveLength(1)
  })
})

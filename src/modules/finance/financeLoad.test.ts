import { describe, expect, it } from 'vitest'
import { mergePendingInvites, mergeRecurringEntries, needsCategoryBootstrap } from './financeLoad'

describe('needsCategoryBootstrap (PERF-003)', () => {
  it('seeds only when the user has no category at all', () => {
    expect(needsCategoryBootstrap([])).toBe(true)
    expect(needsCategoryBootstrap(null)).toBe(true)
  })

  it('does not seed again after a default category was deleted or renamed', () => {
    expect(needsCategoryBootstrap([{ name: 'Mercado' }])).toBe(false)
  })
})

describe('mergePendingInvites', () => {
  it('joins invites by user id and by e-mail without repeating', () => {
    const merged = mergePendingInvites([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], null)
    expect(merged.map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeRecurringEntries', () => {
  const entry = (id: string, due_date: string) => ({ id, due_date })

  it('adds the newly created entries in due-date order', () => {
    const merged = mergeRecurringEntries([entry('a', '2026-09-05'), entry('b', '2026-10-05')], [entry('c', '2026-09-20')])
    expect(merged.map(e => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('keeps the same list when nothing was created, and never duplicates', () => {
    const existing = [entry('a', '2026-09-05')]
    expect(mergeRecurringEntries(existing, [])).toBe(existing)
    expect(mergeRecurringEntries(existing, [entry('a', '2026-09-05')])).toHaveLength(1)
  })
})

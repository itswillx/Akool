import { describe, expect, it } from 'vitest'
import { NOTIFICATIONS_MAX, appendNotifications, applyNotificationUpdate, prependNotification, restoreNotifications } from './notificationList'
import type { AppNotification } from '../types'

const note = (id: string) => ({ id, read: false }) as AppNotification

describe('prependNotification', () => {
  it('puts the new one on top', () => {
    expect(prependNotification([note('a')], note('b')).map(n => n.id)).toEqual(['b', 'a'])
  })

  it('ignores an id that is already listed (same list back)', () => {
    const list = [note('a'), note('b')]
    expect(prependNotification(list, note('b'))).toBe(list)
  })

  it(`keeps only the ${NOTIFICATIONS_MAX} most recent`, () => {
    const list = Array.from({ length: NOTIFICATIONS_MAX }, (_, i) => note(`old-${i}`))
    const next = prependNotification(list, note('new'))
    expect(next).toHaveLength(NOTIFICATIONS_MAX)
    expect(next[0].id).toBe('new')
    expect(next.at(-1)?.id).toBe(`old-${NOTIFICATIONS_MAX - 2}`)
  })
})

describe('applyNotificationUpdate (REL-010)', () => {
  it('replaces the fields of the listed notification (read in another tab)', () => {
    const next = applyNotificationUpdate([note('a'), note('b')], { ...note('b'), read: true })
    expect(next.map(n => [n.id, n.read])).toEqual([['a', false], ['b', true]])
  })

  it('ignores an id that is not listed (same list back)', () => {
    const list = [note('a')]
    expect(applyNotificationUpdate(list, { ...note('z'), read: true })).toBe(list)
  })
})

describe('appendNotifications (carregar mais)', () => {
  it('adds the next page at the end, skipping ids the realtime already brought', () => {
    const list = [note('c'), note('b')]
    expect(appendNotifications(list, [note('b'), note('a')]).map(n => n.id)).toEqual(['c', 'b', 'a'])
  })

  it('returns the same list when nothing is new', () => {
    const list = [note('a')]
    expect(appendNotifications(list, [note('a')])).toBe(list)
  })
})

describe('restoreNotifications (exclusão desfeita)', () => {
  const at = (id: string, created_at: string): AppNotification => ({ ...note(id), created_at })

  it('puts removed items back in creation order (newest first, id breaks ties)', () => {
    const list = [at('c', '2026-10-03'), at('a', '2026-10-01')]
    const back = restoreNotifications(list, [at('b', '2026-10-02'), at('d', '2026-10-03')])
    expect(back.map(n => n.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('returns the same list when everything is already there', () => {
    const list = [at('a', '2026-10-01')]
    expect(restoreNotifications(list, [at('a', '2026-10-01')])).toBe(list)
  })
})

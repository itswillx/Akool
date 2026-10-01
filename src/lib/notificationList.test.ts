import { describe, expect, it } from 'vitest'
import { NOTIFICATIONS_LIMIT, applyNotificationUpdate, prependNotification } from './notificationList'
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

  it(`keeps only the ${NOTIFICATIONS_LIMIT} most recent`, () => {
    const list = Array.from({ length: NOTIFICATIONS_LIMIT }, (_, i) => note(`old-${i}`))
    const next = prependNotification(list, note('new'))
    expect(next).toHaveLength(NOTIFICATIONS_LIMIT)
    expect(next[0].id).toBe('new')
    expect(next.at(-1)?.id).toBe(`old-${NOTIFICATIONS_LIMIT - 2}`)
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

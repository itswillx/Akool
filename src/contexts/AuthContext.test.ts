import { describe, expect, it } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { isSameAccountEvent, mergeAuthUser } from './AuthContext'

function makeUser(id: string, email = `${id}@example.com`): User {
  return { id, email } as User
}

describe('isSameAccountEvent', () => {
  it('is true for a redundant SIGNED_IN for the same account', () => {
    expect(isSameAccountEvent('user-1', makeUser('user-1'), 'SIGNED_IN')).toBe(true)
  })

  it('is true for a redundant TOKEN_REFRESHED for the same account', () => {
    expect(isSameAccountEvent('user-1', makeUser('user-1'), 'TOKEN_REFRESHED')).toBe(true)
  })

  it('is false for USER_UPDATED even when the id matches', () => {
    expect(isSameAccountEvent('user-1', makeUser('user-1'), 'USER_UPDATED')).toBe(false)
  })

  it('is false when the account id differs', () => {
    expect(isSameAccountEvent('user-1', makeUser('user-2'), 'SIGNED_IN')).toBe(false)
  })

  it('is false on the very first event (no current id yet)', () => {
    expect(isSameAccountEvent(null, makeUser('user-1'), 'SIGNED_IN')).toBe(false)
  })

  it('is false when the next user is null (sign-out)', () => {
    expect(isSameAccountEvent('user-1', null, 'SIGNED_OUT')).toBe(false)
  })
})

describe('mergeAuthUser', () => {
  it('keeps the previous reference when sameAccount is true', () => {
    const prev = makeUser('user-1')
    const next = makeUser('user-1')
    expect(mergeAuthUser(prev, next, true)).toBe(prev)
  })

  it('adopts the next reference when sameAccount is false (e.g. USER_UPDATED)', () => {
    const prev = makeUser('user-1', 'old@example.com')
    const next = makeUser('user-1', 'new@example.com')
    expect(mergeAuthUser(prev, next, false)).toBe(next)
  })

  it('adopts the next reference when there is no previous user', () => {
    const next = makeUser('user-1')
    expect(mergeAuthUser(null, next, true)).toBe(next)
  })
})

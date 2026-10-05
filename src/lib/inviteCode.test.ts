import { expect, it } from 'vitest'
import { INVITE_CODE_MAX_LENGTH, normalizeInviteCode } from './inviteCode'

it('tira espaços (inclusive colados), põe em maiúsculas e limita o tamanho', () => {
  expect(normalizeInviteCode(' ab12 cd34 ')).toBe('AB12CD34')
  expect(normalizeInviteCode('ab12\tcd34\n')).toBe('AB12CD34')
  expect(normalizeInviteCode('seed-admin')).toBe('SEED-ADMIN')
  expect(normalizeInviteCode('A'.repeat(40))).toHaveLength(INVITE_CODE_MAX_LENGTH)
  expect(normalizeInviteCode('')).toBe('')
})

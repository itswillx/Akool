import { describe, expect, it } from 'vitest'
import {
  AUDITED_ACTIONS, checkSetRole, checkTarget, isDemotingAdmin, leftNoAdmin, revokesSessionsAfterRoleChange,
} from './rules.ts'

// QA-001: as decisões do admin-ops (o I/O fica no index.ts, em Deno).

describe('admin-ops: alvo', () => {
  it('sem user_id, recusa', () => {
    expect(checkTarget('ban_user', undefined, 'me')).toEqual({ status: 400, message: 'Missing user_id' })
    expect(checkTarget('set_role', '', 'me')).toEqual({ status: 400, message: 'Missing user_id' })
  })

  it.each(['delete_user', 'ban_user', 'set_role'])('%s em si mesmo, recusa', action => {
    expect(checkTarget(action, 'me', 'me')).toEqual({ status: 400, message: 'Cannot perform this action on yourself' })
  })

  it('desbanir a si mesmo não é destrutivo; e agir sobre outro passa', () => {
    expect(checkTarget('unban_user', 'me', 'me')).toBeNull()
    expect(checkTarget('ban_user', 'other', 'me')).toBeNull()
  })
})

describe('admin-ops: set_role', () => {
  it('papel desconhecido ou ausente, recusa', () => {
    expect(checkSetRole('superuser', 'standard')).toEqual({ ok: false, status: 400, message: 'Invalid role' })
    expect(checkSetRole(undefined, 'standard')).toEqual({ ok: false, status: 400, message: 'Invalid role' })
    expect(checkSetRole(1, 'standard')).toEqual({ ok: false, status: 400, message: 'Invalid role' })
  })

  it('alvo sem perfil, 404', () => {
    expect(checkSetRole('admin', null)).toEqual({ ok: false, status: 404, message: 'User not found' })
  })

  it('mudança válida traz de/para', () => {
    expect(checkSetRole('standard', 'admin')).toEqual({ ok: true, fromRole: 'admin', toRole: 'standard' })
  })

  it('só rebaixar admin pede a conferência do último admin', () => {
    expect(isDemotingAdmin('admin', 'standard')).toBe(true)
    expect(isDemotingAdmin('admin', 'admin')).toBe(false)
    expect(isDemotingAdmin('standard', 'admin')).toBe(false)
  })

  it('nenhum admin depois da escrita = desfazer (count nulo conta como zero)', () => {
    expect(leftNoAdmin(0)).toBe(true)
    expect(leftNoAdmin(null)).toBe(true)
    expect(leftNoAdmin(1)).toBe(false)
  })

  it('quem deixa de ser admin perde as sessões; promovido, não', () => {
    expect(revokesSessionsAfterRoleChange('standard')).toBe(true)
    expect(revokesSessionsAfterRoleChange('admin')).toBe(false)
  })
})

describe('admin-ops: auditoria', () => {
  it('registra as mutações e não a leitura', () => {
    expect([...AUDITED_ACTIONS].sort()).toEqual(['ban_user', 'delete_user', 'set_role', 'unban_user'])
    expect(AUDITED_ACTIONS.has('list_users')).toBe(false)
  })
})

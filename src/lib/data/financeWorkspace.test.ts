import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getT } from '../../i18n/translations'

// Saída do workspace: criar, sair e remover membro pelas RPCs. Os
// parâmetros que o banco espera, o erro repassado sem dado e a tradução das
// mensagens fixas das RPCs (P0001 em inglês) e da guarda (42501).

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as unknown[][] }))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      db.calls.push([name, args])
      return Promise.resolve(db.queue.shift() ?? { data: null, error: null })
    },
  },
}))

const { createWorkspace, leaveWorkspace, removeWorkspaceMember, workspaceErrorKey, workspaceErrorText } = await import('./financeWorkspace')

beforeEach(() => {
  db.queue = []
  db.calls = []
})

describe('RPCs de workspace', () => {
  it('createWorkspace manda o nome e devolve o id', async () => {
    db.queue.push({ data: 'w1', error: null })
    expect(await createWorkspace('Casa')).toEqual({ data: 'w1', error: null })
    expect(db.calls).toEqual([['create_workspace', { p_name: 'Casa' }]])
  })

  it('createWorkspace com erro (ou sem id) não devolve dado', async () => {
    const error = { message: 'User already belongs to a workspace', code: 'P0001' }
    db.queue.push({ data: 'w1', error })
    expect(await createWorkspace('Casa')).toEqual({ data: null, error })
    db.queue.push({ data: null, error: null })
    expect((await createWorkspace('Casa')).data).toBeNull()
  })

  it('leaveWorkspace chama leave_workspace sem parâmetros', async () => {
    expect(await leaveWorkspace()).toEqual({ error: null })
    expect(db.calls).toEqual([['leave_workspace', undefined]])
  })

  it('removeWorkspaceMember manda p_user_id e repassa o erro', async () => {
    const error = { message: 'Somente o autor pode realocar o lancamento', code: '42501' }
    db.queue.push({ data: null, error })
    expect(await removeWorkspaceMember('u2')).toEqual({ error })
    expect(db.calls).toEqual([['remove_workspace_member', { p_user_id: 'u2' }]])
  })
})

describe('workspaceErrorKey', () => {
  it('as mensagens fixas das RPCs (P0001)', () => {
    const cases: [string, string][] = [
      ['Not authenticated', 'finance_workspace_error_session'],
      ['Not in a workspace', 'finance_workspace_error_not_in'],
      ['Only the owner can remove members', 'finance_workspace_error_owner_only'],
      ['Cannot remove yourself', 'finance_workspace_error_self'],
      ['User is not a member of this workspace', 'finance_workspace_error_not_member'],
      ['User already belongs to a workspace', 'finance_workspace_error_already'],
    ]
    for (const [message, key] of cases) expect(workspaceErrorKey({ code: 'P0001', message })).toBe(key)
  })

  it('convite apagado na saída de quem convidou, ou já respondido: aceitar e recusar mostram o mesmo aviso', () => {
    expect(workspaceErrorKey({ code: 'P0001', message: 'Invite not found' })).toBe('finance_workspace_error_invite_gone')
    expect(workspaceErrorKey({ code: 'P0001', message: 'Invite is no longer pending' })).toBe('finance_workspace_error_invite_gone')
    expect(workspaceErrorText({ code: 'P0001', message: 'Invite not found' }, getT('pt-BR'))).toBe(getT('pt-BR')('finance_workspace_error_invite_gone'))
  })

  it('42501: o pagamento de empréstimo de quem saiu (resíduo conhecido) e o resto como sem permissão', () => {
    expect(workspaceErrorKey({ code: '42501', message: 'Devedor so pode anexar comprovante e nota ao proprio reporte' })).toBe('finance_workspace_error_loans')
    expect(workspaceErrorKey({ code: '42501', message: 'Somente o autor pode realocar o lancamento' })).toBe('finance_workspace_error_denied')
  })

  it('RPC que o servidor ainda não tem', () => {
    expect(workspaceErrorKey({ code: 'PGRST202', message: 'Could not find the function' })).toBe('finance_workspace_error_outdated')
    expect(workspaceErrorKey({ code: '42883', message: 'function does not exist' })).toBe('finance_workspace_error_outdated')
  })

  it('desconhecido ou nulo: null', () => {
    expect(workspaceErrorKey({ code: '23505', message: 'duplicate key value' })).toBeNull()
    expect(workspaceErrorKey(null)).toBeNull()
  })
})

describe('workspaceErrorText', () => {
  const t = getT('pt-BR')

  it('traduz o que conhece', () => {
    expect(workspaceErrorText({ code: 'P0001', message: 'Cannot remove yourself' }, t)).toBe(t('finance_workspace_error_self'))
  })

  it('sem chave: a mensagem crua, ou o aviso genérico quando ela vem vazia', () => {
    expect(workspaceErrorText({ code: '23505', message: 'duplicate key value' }, t)).toBe('duplicate key value')
    expect(workspaceErrorText({ code: 'XX000', message: '  ' }, t)).toBe(t('finance_workspace_error_generic'))
  })
})

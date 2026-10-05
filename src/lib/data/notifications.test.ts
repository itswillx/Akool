import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cliente falso: cada chamada encadeada é registrada; o resultado de await vem
// de `next`. O canal do realtime guarda os handlers para o teste disparar.
const fake = vi.hoisted(() => {
  const calls: [string, unknown[]][] = []
  const state = { next: { data: null as unknown, error: null as unknown, count: null as number | null } }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'or', 'order', 'limit', 'in', 'update', 'delete']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, args]); return chain }
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(state.next).then(resolve)
  const handlers: Record<string, (p: { new: unknown }) => void> = {}
  const channel = {
    on: (_kind: string, filter: { event: string }, handler: (p: { new: unknown }) => void) => { handlers[filter.event] = handler; return channel },
    subscribe: () => channel,
  }
  const supabase = {
    from: (table: string) => { calls.push(['from', [table]]); return chain },
    rpc: vi.fn((name: string, args: unknown) => Promise.resolve({ data: null, error: null, name, args })),
    channel: vi.fn<(name: string) => typeof channel>(() => channel),
    removeChannel: vi.fn(() => Promise.resolve('ok')),
  }
  return { calls, state, handlers, supabase }
})
vi.mock('../supabase', () => ({ supabase: fake.supabase }))

import {
  acceptWorkspaceInvite,
  countUnreadNotifications,
  declineWorkspaceInvite,
  deleteNotification,
  deleteReadNotifications,
  fetchInviteStates,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
  subscribeNotifications,
} from './notifications'

const calls = (name: string) => fake.calls.filter(([m]) => m === name).map(([, args]) => args)

beforeEach(() => {
  fake.calls.length = 0
  fake.state.next = { data: null, error: null, count: null }
})

describe('notifications (camada de dados)', () => {
  it('lista a primeira página e as seguintes pelo cursor (created_at, id)', async () => {
    await listNotifications('u1')
    expect(calls('from')).toEqual([['notifications']])
    expect(calls('eq')).toEqual([['user_id', 'u1']])
    expect(calls('or')).toEqual([])
    expect(calls('order')).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]])
    expect(calls('limit')).toEqual([[30]])

    fake.calls.length = 0
    await listNotifications('u1', { created_at: '2026-10-04T12:00:00+00:00', id: 'n9' }, 10)
    expect(calls('or')).toEqual([['created_at.lt."2026-10-04T12:00:00+00:00",and(created_at.eq."2026-10-04T12:00:00+00:00",id.lt.n9)']])
    expect(calls('limit')).toEqual([[10]])
  })

  it('conta as não lidas no servidor (head + count)', async () => {
    await countUnreadNotifications('u1')
    expect(calls('select')).toEqual([['id', { count: 'exact', head: true }]])
    expect(calls('eq')).toEqual([['user_id', 'u1'], ['read', false]])
  })

  it('lida/não lida exige linha afetada; marcar todas e limpar lidas não', async () => {
    fake.state.next = { data: [], error: null, count: null }
    expect((await setNotificationRead('n1', false)).error?.code).toBe('PGRST_NO_ROWS')
    expect(calls('update')).toEqual([[{ read: false }]])
    fake.state.next = { data: [{ id: 'n1' }], error: null, count: null }
    expect((await setNotificationRead('n1', true)).error).toBeNull()
    expect((await deleteNotification('n1')).error).toBeNull()

    fake.calls.length = 0
    await markAllNotificationsRead('u1')
    expect(calls('update')).toEqual([[{ read: true }]])
    expect(calls('eq')).toEqual([['user_id', 'u1'], ['read', false]])
    fake.calls.length = 0
    await deleteReadNotifications('u1')
    expect(calls('delete')).toHaveLength(1)
    expect(calls('eq')).toEqual([['user_id', 'u1'], ['read', true]])
  })

  it('situação dos convites: só as válidas; erro ou nenhum id viram vazio', async () => {
    expect(await fetchInviteStates([])).toEqual({})
    expect(calls('from')).toEqual([])
    fake.state.next = { data: [{ id: 'i1', status: 'pending' }, { id: 'i2', status: 'accepted' }, { id: 'i3', status: 'outro' }], error: null, count: null }
    expect(await fetchInviteStates(['i1', 'i2', 'i1'])).toEqual({ i1: 'pending', i2: 'accepted' })
    expect(calls('in')).toEqual([['id', ['i1', 'i2']]])
    fake.state.next = { data: null, error: { message: 'x' }, count: null }
    expect(await fetchInviteStates(['i1'])).toEqual({})
  })

  it('aceitar e recusar chamam as RPCs do workspace', async () => {
    await acceptWorkspaceInvite('i1')
    await declineWorkspaceInvite('i2')
    expect(fake.supabase.rpc.mock.calls).toEqual([
      ['accept_workspace_invite', { p_invite_id: 'i1' }],
      ['decline_workspace_invite', { p_invite_id: 'i2' }],
    ])
  })

  it('realtime: INSERT e UPDATE do usuário chegam nos handlers; o retorno desinscreve', () => {
    const onInsert = vi.fn()
    const onUpdate = vi.fn()
    const unsubscribe = subscribeNotifications('u1', { onInsert, onUpdate })
    expect(fake.supabase.channel).toHaveBeenCalledWith('notifications:u1')
    fake.handlers.INSERT({ new: { id: 'n1' } })
    fake.handlers.UPDATE({ new: { id: 'n1', read: true } })
    expect(onInsert).toHaveBeenCalledWith({ id: 'n1' })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'n1', read: true })
    unsubscribe()
    expect(fake.supabase.removeChannel).toHaveBeenCalled()
  })
})

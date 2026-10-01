import { beforeEach, describe, expect, it, vi } from 'vitest'

// PERF-015: a invalidação pelo realtime vive no módulo (vale com o Dashboard
// fechado), não duplica canal e cai no logout junto com o cache.
const handlers: { table: string; filter?: string; cb: () => void }[] = []
const channel = {
  on: vi.fn((_type: string, opts: { table: string; filter?: string }, cb: () => void) => { handlers.push({ table: opts.table, filter: opts.filter, cb }); return channel }),
  subscribe: vi.fn(() => channel),
}
const authListeners: ((event: string) => void)[] = []
const supabase = {
  channel: vi.fn(() => channel),
  removeChannel: vi.fn(() => Promise.resolve('ok')),
  auth: { onAuthStateChange: vi.fn((cb: (event: string) => void) => { authListeners.push(cb); return { data: { subscription: { unsubscribe: () => {} } } } }) },
}
vi.mock('./supabase', () => ({ supabase }))

const { dashboardKeys, queryClient, startDashboardInvalidation, stopDashboardInvalidation } = await import('./queryClient')

beforeEach(() => {
  stopDashboardInvalidation()
  handlers.length = 0
  supabase.channel.mockClear()
  supabase.removeChannel.mockClear()
  queryClient.clear()
})

describe('queryClient (PERF-015)', () => {
  it('assina tarefas do usuário e cards, uma vez por usuário', () => {
    startDashboardInvalidation('u1')
    startDashboardInvalidation('u1')
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    expect(handlers.map(h => [h.table, h.filter])).toEqual([['todos', 'user_id=eq.u1'], ['project_cards', undefined]])
  })

  it('trocar de usuário fecha o canal anterior', () => {
    startDashboardInvalidation('u1')
    startDashboardInvalidation('u2')
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
    expect(supabase.channel).toHaveBeenCalledTimes(2)
  })

  it('evento de tarefa invalida só as tarefas; de card, só os projetos', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    startDashboardInvalidation('u1')
    handlers.find(h => h.table === 'todos')!.cb()
    expect(spy).toHaveBeenLastCalledWith({ queryKey: dashboardKeys.todos('u1') })
    handlers.find(h => h.table === 'project_cards')!.cb()
    expect(spy).toHaveBeenLastCalledWith({ queryKey: dashboardKeys.projects('u1') })
    spy.mockRestore()
  })

  it('logout (SEC-017): fecha o canal e esvazia o cache', () => {
    startDashboardInvalidation('u1')
    queryClient.setQueryData(dashboardKeys.todos('u1'), [{ id: 't' }])
    for (const listener of authListeners) listener('SIGNED_OUT')
    expect(supabase.removeChannel).toHaveBeenCalled()
    expect(queryClient.getQueryData(dashboardKeys.todos('u1'))).toBeUndefined()
  })
})

// @vitest-environment happy-dom
// PERF-015: o Dashboard não refaz as consultas a cada vez que abre. Sair e
// voltar dentro do staleTime usa o cache; uma invalidação (o realtime) refaz só
// a parte afetada.
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const loadDashboardProjects = vi.hoisted(() => vi.fn())
vi.mock('../lib/data/dashboard', () => ({
  loadDashboardProjects,
  loadDashboardFinance: vi.fn(),
  loadDashboardTodos: vi.fn(),
}))

const { dashboardKeys, queryClient } = await import('../lib/queryClient')
const { useDashboardProjects } = await import('./DashboardProjects')

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  queryClient.clear()
  loadDashboardProjects.mockReset()
})

const ROWS = {
  boards: [{ id: 'b1', name: 'Quadro', icon: '', color: '#888', sort_order: 0, is_shared: false }],
  cards: [
    { id: 'c1', board_id: 'b1', title: 'Aberto', completed: false, due_date: null },
    { id: 'c2', board_id: 'b1', title: 'Feito', completed: true, due_date: null },
  ],
}

describe('cache do Dashboard (PERF-015)', () => {
  it('sair e voltar ao Dashboard não refaz a consulta', async () => {
    loadDashboardProjects.mockResolvedValue(ROWS)
    const first = renderHook(() => useDashboardProjects('u1', true), { wrapper })
    await waitFor(() => expect(first.result.current.loaded).toBe(true))
    expect(first.result.current.totalOpen).toBe(1)
    first.unmount()

    const second = renderHook(() => useDashboardProjects('u1', true), { wrapper })
    // Os dados aparecem já no primeiro render, vindos do cache.
    expect(second.result.current.loaded).toBe(true)
    expect(second.result.current.boards[0]).toMatchObject({ id: 'b1', openCards: 1, totalCards: 2 })
    expect(loadDashboardProjects).toHaveBeenCalledTimes(1)
  })

  it('a invalidação (evento do realtime) refaz só a parte afetada', async () => {
    loadDashboardProjects.mockResolvedValue(ROWS)
    const { result } = renderHook(() => useDashboardProjects('u1', true), { wrapper })
    await waitFor(() => expect(result.current.loaded).toBe(true))

    loadDashboardProjects.mockResolvedValue({ ...ROWS, cards: [...ROWS.cards, { id: 'c3', board_id: 'b1', title: 'Novo', completed: false, due_date: null }] })
    await queryClient.invalidateQueries({ queryKey: dashboardKeys.projects('u1') })
    await waitFor(() => expect(result.current.totalOpen).toBe(2))
    expect(loadDashboardProjects).toHaveBeenCalledTimes(2)
  })

  it('com o módulo oculto (modo só finanças), não consulta nada', () => {
    renderHook(() => useDashboardProjects('u1', false), { wrapper })
    expect(loadDashboardProjects).not.toHaveBeenCalled()
  })

  it('cache separado por usuário', async () => {
    loadDashboardProjects.mockResolvedValue(ROWS)
    const a = renderHook(() => useDashboardProjects('u1', true), { wrapper })
    await waitFor(() => expect(a.result.current.loaded).toBe(true))
    const b = renderHook(() => useDashboardProjects('u2', true), { wrapper })
    await waitFor(() => expect(b.result.current.loaded).toBe(true))
    expect(loadDashboardProjects).toHaveBeenCalledWith('u1')
    expect(loadDashboardProjects).toHaveBeenCalledWith('u2')
  })
})

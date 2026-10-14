// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '../../../test/rtl'
import type { FinanceGoal, FinanceGoalContribution } from '../../../types'

// O Resumo de "Projetos" e o quadro compartilhado (src/components/board) que ele
// usa. Até 14/10/2026 quem exercitava o quadro eram os testes da Loja; com a
// Loja fora do frontend, o Resumo é o único consumidor e o teste mora aqui.

const env = vi.hoisted(() => ({ mobile: false }))
vi.mock('../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k} ${JSON.stringify(vars)}` : k) }),
}))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => env.mobile }))

const { SummaryView } = await import('./SummaryView')
const { buildUnifiedCards } = await import('./unifiedCards')

const goal = (id: string, name: string, status: FinanceGoal['status'], created_at: string): FinanceGoal => ({
  id, user_id: 'u1', name, icon: '', color: '#6366f1', target_amount: 100_000, deadline: '2026-12-31',
  account_id: null, status, workspace_id: null, created_at,
})
const contribution = (goal_id: string, amount: number): FinanceGoalContribution => ({
  id: `c-${goal_id}`, goal_id, user_id: 'u1', amount, note: '', date: '2026-10-01', created_at: '2026-10-01T00:00:00Z',
})

// Uma meta por fase: plano (sem aporte), andamento (com aporte), concluída e cancelada.
const goals = [
  goal('g1', 'Viagem', 'active', '2026-10-01T00:00:00Z'),
  goal('g2', 'Reserva', 'active', '2026-10-03T00:00:00Z'),
  goal('g3', 'Notebook', 'completed', '2026-10-02T00:00:00Z'),
  goal('g4', 'Moto', 'cancelled', '2026-10-04T00:00:00Z'),
]
const contributions = [contribution('g2', 25_000), contribution('g3', 100_000)]

const titles = () => screen.queryAllByText(/^(Viagem|Reserva|Notebook|Moto|Aluguel)$/).map(el => el.textContent)

beforeEach(() => {
  env.mobile = false
  try { localStorage.clear() } catch { /* sem storage: o quadro usa o padrão */ }
})

describe('buildUnifiedCards', () => {
  it('um card por meta, com a fase derivada e o acumulado como valor', () => {
    const cards = buildUnifiedCards(goals, contributions, { goalTarget: target => `alvo ${target}` })
    expect(cards.map(c => [c.id, c.phase, c.amount])).toEqual([
      ['goal:g1', 'planned', 0], ['goal:g2', 'doing', 25_000], ['goal:g3', 'done', 100_000], ['goal:g4', 'cancelled', 0],
    ])
    expect(cards[0].icon).toBe('🎯')
    expect(cards[0].subtitle).toMatch(/^alvo R\$/)
  })
})

describe('SummaryView', () => {
  it('sem metas: o aviso de vazio, sem quadro', () => {
    render(<SummaryView goals={[]} contributions={[]} onOpenSection={() => {}} />)
    expect(screen.getByText('finance_myproj_board_empty')).toBeTruthy()
    expect(screen.queryByPlaceholderText('board_search_placeholder')).toBeNull()
  })

  it('o cartão de Metas soma as ativas e leva para a sub-aba', () => {
    const open = vi.fn()
    render(<SummaryView goals={goals} contributions={contributions} onOpenSection={open} />)
    // O selo de cada card também diz "Metas": o cartão é o que traz o resumo.
    const tile = screen.getAllByRole('button', { name: /finance_tab_goals/ }).find(b => b.textContent?.includes('finance_myproj_tile_sub'))
    if (!tile) throw new Error('cartão de Metas')
    // Ativas = plano + andamento (2 de 4); o valor é o acumulado delas.
    expect(within(tile).getByText(/finance_myproj_tile_sub {"active":2,"total":4}/)).toBeTruthy()
    expect(tile.textContent).toMatch(/250,00/)
    fireEvent.click(tile)
    expect(open).toHaveBeenCalledWith('goals')
  })

  it('quadro: a coluna Cancelado nasce oculta e o chip a mostra; clicar num card abre Metas', () => {
    const open = vi.fn()
    render(<SummaryView goals={goals} contributions={contributions} onOpenSection={open} />)
    expect(titles().sort()).toEqual(['Notebook', 'Reserva', 'Viagem'])
    fireEvent.click(screen.getByRole('button', { name: /finance_myproj_phase_cancelled/ }))
    expect(titles().sort()).toEqual(['Moto', 'Notebook', 'Reserva', 'Viagem'])
    fireEvent.click(screen.getByText('Reserva'))
    expect(open).toHaveBeenCalledWith('goals')
  })

  it('busca filtra os cards e avisa quando nada bate', () => {
    render(<SummaryView goals={goals} contributions={contributions} onOpenSection={() => {}} />)
    const search = screen.getByPlaceholderText('board_search_placeholder')
    fireEvent.change(search, { target: { value: 'reser' } })
    expect(titles()).toEqual(['Reserva'])
    fireEvent.change(search, { target: { value: 'nada disso' } })
    expect(screen.getByText('board_no_results')).toBeTruthy()
  })

  it('lista: ordena dentro de cada fase (recentes, depois nome); a escolha fica guardada', () => {
    // Duas metas em "planejado": Viagem (01/10) é mais recente que Aluguel (01/09).
    const planned = [goal('g1', 'Viagem', 'active', '2026-10-01T00:00:00Z'), goal('g5', 'Aluguel', 'active', '2026-09-01T00:00:00Z')]
    const view = render(<SummaryView goals={planned} contributions={[]} onOpenSection={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /board_view_list/ }))
    expect(titles()).toEqual(['Viagem', 'Aluguel'])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } })
    expect(titles()).toEqual(['Aluguel', 'Viagem'])
    view.unmount()
    // Volta na lista, com a ordenação por nome.
    render(<SummaryView goals={planned} contributions={[]} onOpenSection={() => {}} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('name')
    expect(screen.queryByRole('button', { name: /board_view_list/ })).toBeTruthy()
    expect(titles()).toEqual(['Aluguel', 'Viagem'])
  })

  it('no celular: só a lista, sem o seletor Kanban/Lista', () => {
    env.mobile = true
    render(<SummaryView goals={goals} contributions={contributions} onOpenSection={() => {}} />)
    expect(screen.queryByRole('button', { name: /board_view_kanban/ })).toBeNull()
    expect(titles().sort()).toEqual(['Notebook', 'Reserva', 'Viagem'])
  })
})

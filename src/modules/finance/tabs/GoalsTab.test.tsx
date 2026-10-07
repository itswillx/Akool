// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, within } from '../../../test/rtl'
import type { FinanceGoal, FinanceGoalContribution, FinanceGoalShare } from '../../../types'

// API-012: os botões de dono (compartilhar, editar, excluir) só aparecem na
// meta que a pessoa criou. A meta de workspace de outro membro vai para
// "compartilhadas" (antes aparecia como sua, e compartilhar passava no banco).

vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { GoalsTab } = await import('./GoalsTab')

const goal = (id: string, user_id: string, extra: Partial<FinanceGoal> = {}): FinanceGoal => ({
  id, user_id, name: `Meta ${id}`, icon: '🎯', color: '#6366f1', target_amount: 1000, deadline: '2026-12-31',
  account_id: null, status: 'active', created_at: '2026-10-01T00:00:00Z', workspace_id: null, ...extra,
})
const incoming: FinanceGoalShare = { id: 's1', goal_id: 'recebida', owner_id: 'ana', shared_with_user_id: 'eu', created_at: '2026-10-01T00:00:00Z' }

const contribution = (id: string, goal_id: string, user_id: string, date: string): FinanceGoalContribution => ({
  id, goal_id, user_id, amount: 100, note: '', date, created_at: `${date}T12:00:00Z`,
})

function renderTab(goals: FinanceGoal[], contributions: FinanceGoalContribution[] = [], onDeleteContribution = () => Promise.resolve()) {
  const noop = () => {}
  const done = () => Promise.resolve()
  return render(
    <GoalsTab
      userId="eu"
      goals={goals}
      contributions={contributions}
      accounts={[]}
      goalShares={[]}
      incomingGoalShares={[incoming]}
      partnerProfiles={[]}
      onNewGoal={noop}
      onEditGoal={noop}
      onDeleteGoal={done}
      onAddContribution={noop}
      onDeleteContribution={onDeleteContribution}
      onUpdateStatus={done}
      onShareGoal={noop}
    />,
  )
}

describe('GoalsTab: botões de dono', () => {
  it('só a meta da própria pessoa tem compartilhar, editar e excluir', () => {
    renderTab([
      goal('minha', 'eu'),
      goal('do-workspace', 'bia', { workspace_id: 'ws1' }),
      goal('recebida', 'ana'),
    ])
    expect(screen.getAllByTitle('finance_goal_share_btn')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'common_edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /finance_delete/ })).toHaveLength(1)
    // Todas recebem aporte.
    expect(screen.getAllByRole('button', { name: 'finance_goal_add_contribution' })).toHaveLength(3)
  })

  it('a meta de workspace de outro membro fica em "compartilhadas"', () => {
    renderTab([goal('minha', 'eu'), goal('do-workspace', 'bia', { workspace_id: 'ws1' })])
    const shared = screen.getByText('finance_goal_shared_section').closest('div') as HTMLElement
    expect(within(shared).getByText('Meta do-workspace')).toBeTruthy()
    expect(within(shared).queryByText('Meta minha')).toBeNull()
  })

  it('meta de workspace criada pela própria pessoa continua sendo dela', () => {
    renderTab([goal('minha-ws', 'eu', { workspace_id: 'ws1' })])
    expect(screen.getAllByTitle('finance_goal_share_btn')).toHaveLength(1)
    expect(screen.queryByText('finance_goal_shared_section')).toBeNull()
  })
})

describe('GoalsTab: lixeira de aporte', () => {
  // API-012: dono e membros veem os aportes dos outros, mas a policy de DELETE
  // só deixa o autor apagar. A lixeira no aporte alheio fazia o aporte sumir só
  // da tela (o DELETE barrado afeta 0 linhas sem erro).
  it('só o aporte da própria pessoa tem lixeira e confirmação', async () => {
    const user = userEvent.setup()
    const onDeleteContribution = vi.fn(() => Promise.resolve())
    renderTab(
      [goal('minha', 'eu')],
      [contribution('meu-aporte', 'minha', 'eu', '2026-10-05'), contribution('aporte-da-bia', 'minha', 'bia', '2026-10-06')],
      onDeleteContribution,
    )
    await user.click(screen.getByRole('button', { name: /finance_goal_contributions_title \(2\)/ }))

    const trash = screen.getAllByRole('button', { name: 'common_delete' })
    expect(trash).toHaveLength(1)
    // O aporte mais novo (da Bia) vem primeiro; a lixeira é a da linha seguinte, a do próprio usuário.
    const rows = trash[0].closest('div')?.parentElement?.children
    expect(rows).toHaveLength(2)
    expect(rows?.[0].querySelector('button')).toBeNull()

    await user.click(trash[0])
    await user.click(screen.getByRole('button', { name: '✓' }))
    expect(onDeleteContribution).toHaveBeenCalledWith('meu-aporte')
  })
})

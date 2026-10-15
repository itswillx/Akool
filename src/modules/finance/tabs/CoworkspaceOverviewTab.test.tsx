// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../../../test/rtl'
import { getT } from '../../../i18n/translations'
import { formatBRL } from '../../../lib/money'
import type { FinanceTransaction, FinanceWorkspace, FinanceWorkspaceMember } from '../../../types'

// Saída do workspace: depois que alguém sai, a receita ou despesa que essa pessoa
// lançou na venda ou compra de quem fica continua no workspace (segue a venda).
// A visão do coworkspace mostra o autor como "ex-membro" (antes, "?") e soma o
// gasto dele numa barra própria, para as barras fecharem com o total do mês.

vi.mock('../../../i18n/LanguageContext', async () => {
  const { getT: realT } = await import('../../../i18n/translations')
  return { useLanguage: () => ({ lang: 'pt-BR', t: realT('pt-BR') }) }
})

const { default: CoworkspaceOverviewTab } = await import('./CoworkspaceOverviewTab')

const t = getT('pt-BR')
const workspace: FinanceWorkspace = { id: 'w', name: 'Família', owner_id: 'dona', created_at: '2026-10-01T00:00:00Z' }
const members = [
  { id: 'm1', workspace_id: 'w', user_id: 'dona', role: 'owner', joined_at: '2026-10-01T00:00:00Z', profile: { email: 'dona@example.invalid', display_name: 'Dona' } },
  { id: 'm2', workspace_id: 'w', user_id: 'gabi', role: 'member', joined_at: '2026-10-02T00:00:00Z', profile: { email: 'gabi@example.invalid', display_name: 'Gabi' } },
] as unknown as FinanceWorkspaceMember[]
const tx = (id: string, user_id: string, amount: number, description: string): FinanceTransaction => ({
  id, user_id, account_id: null, category_id: null, type: 'expense', amount, description, date: '2026-10-10',
  shared_with_user_id: null, workspace_id: 'w', created_at: '2026-10-10T12:00:00Z',
})

function renderTab(transactions: FinanceTransaction[]) {
  return render(
    <CoworkspaceOverviewTab workspace={workspace} members={members} transactions={transactions} transactionsAgg={transactions}
      budgets={[]} accounts={[]} categories={[]} month="2026-10" onBack={() => {}} onManage={() => {}} />,
  )
}

describe('CoworkspaceOverviewTab: autor que já saiu do workspace', () => {
  it('aparece como ex-membro nos lançamentos e numa barra própria de gastos', () => {
    renderTab([tx('t1', 'dona', 3000, 'Mercado'), tx('t2', 'fabi', 2000, 'Despesa da compra da Dona'), tx('t3', 'gabi', 1000, 'Farmácia')])
    const former = t('finance_workspace_former_member')
    // A barra e a linha do lançamento.
    expect(screen.getAllByText(former)).toHaveLength(2)
    // O texto da tela tem os espaços normalizados (o Intl põe um espaço fixo depois do R$).
    expect(screen.getByText(formatBRL(2000).replace(/\s/g, ' '))).toBeTruthy()
    expect(screen.queryByText('?')).toBeNull()
  })

  it('sem lançamento de quem saiu, só os membros têm barra', () => {
    renderTab([tx('t1', 'dona', 3000, 'Mercado')])
    expect(screen.queryByText(t('finance_workspace_former_member'))).toBeNull()
    expect(screen.getAllByText('Gabi').length).toBeGreaterThan(0)
  })
})

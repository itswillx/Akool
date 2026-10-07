// @vitest-environment happy-dom
// PERF-005: custo de render das abas do FinancePanel com 1.000 transações.
// Cada iteração = 1 render + 20 re-renders do pai com os mesmos dados (o que
// acontece ao abrir/fechar modal, digitar num filtro etc.).
// Rodar com o React de produção (o de desenvolvimento guarda um stack de
// depuração por elemento e estoura a memória com listas de 1.000 linhas):
//   NODE_ENV=production npx vitest bench --run src/modules/finance/FinancePanel.bench.tsx
// (fora do `npm test`: benchmark não é teste e varia com a máquina).
import { bench, describe, vi } from 'vitest'
import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type {
  FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceGoalContribution,
  FinanceRecurring, FinanceRecurringEntry, FinanceTransaction,
} from '../../types'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

import { AccountsTab } from './tabs/AccountsTab'
import { BudgetsTab } from './tabs/BudgetsTab'
import { CategoriesTab } from './tabs/CategoriesTab'
import { GoalsTab } from './tabs/GoalsTab'
import { OverviewTab } from './tabs/OverviewTab'
import { TransactionsTab } from './tabs/TransactionsTab'

const MONTH = '2026-09'
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(2025, 9 + i, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
const CREATED = '2026-01-01T00:00:00Z'
const USER = 'user-1'

const categories: FinanceCategory[] = Array.from({ length: 40 }, (_, i) => ({
  id: `cat-${i}`, user_id: USER, name: `Categoria ${i}`, color: '#6366f1', icon: '🏷️',
  type: i < 30 ? 'expense' : 'income', is_default: false, created_at: CREATED,
}))
const accounts: FinanceAccount[] = Array.from({ length: 6 }, (_, i) => ({
  id: `acc-${i}`, user_id: USER, name: `Conta ${i}`, type: 'checking', initial_balance: 100_000 * (i + 1),
  color: '#10b981', icon: '🏦', created_at: CREATED,
}))
const transactions: FinanceTransaction[] = Array.from({ length: 1000 }, (_, i) => {
  const income = i % 5 === 0
  return {
    id: `tx-${i}`, user_id: USER, account_id: `acc-${i % 6}`,
    category_id: income ? `cat-${30 + (i % 10)}` : `cat-${i % 30}`,
    type: income ? 'income' : 'expense', amount: 1_000 + ((i * 37) % 50_000),
    description: `Lançamento ${i}`, date: `${MONTHS[i % 12]}-${String(1 + (i % 28)).padStart(2, '0')}`,
    shared_with_user_id: null, created_at: CREATED,
  } satisfies FinanceTransaction
// Mais recentes primeiro, como a query (`order('date', desc)`) e o sortTxDesc
// do useFinanceData entregam: a aba Transações agrupa por datas consecutivas.
}).sort((a, b) => b.date.localeCompare(a.date))
const budgets: FinanceBudget[] = Array.from({ length: 30 }, (_, i) => ({
  id: `bud-${i}`, user_id: USER, category_id: `cat-${i}`, month: MONTH, amount_limit: 30_000,
  shared_with_user_id: null, created_at: CREATED,
}))
const goals: FinanceGoal[] = Array.from({ length: 10 }, (_, i) => ({
  id: `goal-${i}`, user_id: USER, name: `Meta ${i}`, icon: '🎯', color: '#f59e0b', target_amount: 1_000_000,
  deadline: '2027-06-30', account_id: null, status: 'active', created_at: CREATED,
}))
const contributions: FinanceGoalContribution[] = Array.from({ length: 200 }, (_, i) => ({
  id: `con-${i}`, goal_id: `goal-${i % 10}`, user_id: USER, amount: 5_000, note: '',
  date: `${MONTHS[i % 12]}-10`, created_at: CREATED,
}))
const recurring: FinanceRecurring[] = Array.from({ length: 15 }, (_, i) => ({
  id: `rec-${i}`, user_id: USER, type: 'expense', description: `Conta fixa ${i}`, amount: 10_000,
  is_variable: false, category_id: `cat-${i}`, account_id: 'acc-0', day_of_month: 1 + i,
  active: true, total_installments: null, created_at: CREATED,
}))
const recurringEntries: FinanceRecurringEntry[] = recurring.map((r, i) => ({
  id: `ent-${i}`, user_id: USER, recurring_id: r.id, due_date: `${MONTH}-${String(1 + i).padStart(2, '0')}`,
  status: 'pending', amount: null, transaction_id: null, created_at: CREATED,
}))

const noop = () => {}
const noopAsync = async () => {}

/** 1 render + 20 re-renders com os mesmos dados (só o callback muda, como num pai que re-renderiza). */
function renderCycle(element: (i: number) => ReactElement) {
  const container = document.createElement('div')
  const root = createRoot(container)
  // flushSync, e não act: act não existe no build de produção do React.
  flushSync(() => root.render(element(0)))
  for (let i = 1; i <= 20; i++) flushSync(() => root.render(element(i)))
  root.unmount()
}

// Iterações fixas: com tempo mínimo, o tinybench repete o ciclo centenas de
// vezes, e cada ciclo monta 1.000 linhas no happy-dom.
const opts = { time: 0, iterations: 8, warmupTime: 0, warmupIterations: 2 }

describe('FinancePanel: 1.000 transações, 1 render + 20 re-renders', () => {
  bench('Visão geral', () => renderCycle(i => (
    <OverviewTab transactions={transactions} transactionsAgg={transactions} categories={categories} month={MONTH}
      recurring={recurring} recurringEntries={recurringEntries} accounts={accounts} budgets={budgets}
      goals={goals} contributions={contributions} onMarkPaid={noop} onSkipEntry={noop} onNavigate={() => void i} />
  )), opts)

  bench('Transações', () => renderCycle(i => (
    <TransactionsTab transactions={transactions} partnerTransactions={[]} partnerProfiles={[]} accounts={accounts}
      categories={categories} workspaceCategories={[]} workspaceAccounts={[]} month={MONTH}
      onAdd={() => void i} onEdit={noop} onQuickAdd={noopAsync} onBulkDelete={noopAsync} onImport={noop} />
  )), opts)

  bench('Orçamentos', () => renderCycle(i => (
    <BudgetsTab budgets={budgets} sharedBudgets={[]} transactions={transactions} partnerTransactions={[]}
      partnerProfiles={[]} categories={categories} month={MONTH} onAdd={() => void i} onEdit={noop} onDeleteBudget={noopAsync} />
  )), opts)

  bench('Contas', () => renderCycle(i => (
    <AccountsTab accounts={accounts} transactions={transactions} onAdd={() => void i} onEdit={noop} />
  )), opts)

  bench('Categorias', () => renderCycle(i => (
    <CategoriesTab categories={categories} transactions={transactions} onAdd={() => void i} onEdit={noop} />
  )), opts)

  bench('Metas', () => renderCycle(i => (
    <GoalsTab userId={undefined} goals={goals} contributions={contributions} accounts={accounts} goalShares={[]} incomingGoalShares={[]}
      partnerProfiles={[]} onNewGoal={() => void i} onEditGoal={noop} onDeleteGoal={noopAsync} onAddContribution={noop}
      onDeleteContribution={noopAsync} onUpdateStatus={noopAsync} onShareGoal={noop} />
  )), opts)
})

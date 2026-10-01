// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import type { Dispatch, SetStateAction } from 'react'
import { lazy, Suspense } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { AccountModal } from './modals/AccountModal'
import { BudgetModal } from './modals/BudgetModal'
import { CategoryModal } from './modals/CategoryModal'
import { ContributionModal, GoalModal, GoalShareModal } from './modals/GoalModals'
import { PayAmountModal, RecurringModal } from './modals/RecurringModals'
import { TransactionModal } from './modals/TransactionModal'
import { WorkspaceModal } from './modals/WorkspaceModal'
import type { useFinanceActions } from './useFinanceActions'
import type { useFinanceData } from './useFinanceData'
import type { useFinanceModals } from './useFinanceModals'
// Lazy so the statement parsers (and, behind them, pdfjs) stay out of the
// main finance chunk until someone actually opens the import flow.
const ImportStatementModal = lazy(() => import('./integrations/ImportStatementModal'))

// Todos os modais do financeiro, com o estado e as gravações vindos do painel.
export function FinanceModals({ data, modals, actions, month, allVisibleTxsAgg, wsModalOpen, setWsModalOpen }: {
  data: ReturnType<typeof useFinanceData>
  modals: ReturnType<typeof useFinanceModals>
  actions: ReturnType<typeof useFinanceActions>
  month: string
  allVisibleTxsAgg: ReturnType<typeof useFinanceData>['txAggOwn']
  wsModalOpen: boolean
  setWsModalOpen: Dispatch<SetStateAction<boolean>>
}) {
  const { user } = useAuth()
  const { accounts, budgets, categories, familyAccounts, familyBudgets, familyCategories, goalShares, partnerProfiles, pendingInvitesForMe, reload, workspace, workspaceInvites, workspaceMembers } = data
  const { accModal, budgetModal, catModal, contributionGoal, goalModal, goalShareModal, importHistoryTxs, importModal, payModal, recurringModal, setAccModal, setBudgetModal, setCatModal, setContributionGoal, setGoalModal, setGoalShareModal, setImportModal, setPayModal, setRecurringModal, setTxModal, txModal } = modals
  const { bulkImport, deleteAccount, deleteCategory, deleteGoalShare, deleteRecurring, deleteTx, doMarkPaid, saveAccount, saveBudget, saveCategory, saveContribution, saveGoal, saveGoalShare, saveRecurring, saveTx } = actions
  return (
    <>
      {/* Modals */}
      {catModal.open && (
        <CategoryModal
          category={catModal.category}
          transactions={allVisibleTxsAgg}
          workspace={workspace}
          userId={user?.id ?? ''}
          onClose={() => setCatModal({ open: false })}
          onSave={saveCategory}
          onDelete={catModal.category ? () => deleteCategory(catModal.category!.id) : undefined}
        />
      )}
      {txModal.open && (
        <TransactionModal
          tx={txModal.tx}
          personalAccounts={accounts}
          familyAccounts={familyAccounts}
          personalCategories={categories}
          familyCategories={familyCategories}
          partners={partnerProfiles}
          userId={user?.id ?? ''}
          workspace={workspace}
          onClose={() => setTxModal({ open: false })}
          onSave={saveTx}
          onDelete={txModal.tx ? () => deleteTx(txModal.tx!.id) : undefined}
        />
      )}
      {importModal && (
        <Suspense fallback={null}>
          <ImportStatementModal
            accounts={accounts}
            workspaceAccounts={familyAccounts}
            categories={categories}
            workspaceCategories={familyCategories}
            workspace={workspace}
            // Other members' workspace rows count too: without them, member B
            // re-importing the shared statement that A already imported sees no
            // duplicate at all. Fetched fresh (full column, all-time) when the
            // modal opens — see openImportModal.
            existingTransactions={importHistoryTxs}
            onImport={bulkImport}
            onClose={() => setImportModal(false)}
          />
        </Suspense>
      )}
      {accModal.open && (
        <AccountModal
          account={accModal.account}
          workspace={workspace}
          userId={user?.id ?? ''}
          onClose={() => setAccModal({ open: false })}
          onSave={saveAccount}
          onDelete={accModal.account ? () => deleteAccount(accModal.account!.id) : undefined}
        />
      )}
      {budgetModal.open && (
        <BudgetModal
          budget={budgetModal.budget}
          personalCategories={categories}
          workspaceCategories={familyCategories}
          month={month}
          personalExisting={budgets.filter(b => b.month === month)}
          workspaceExisting={familyBudgets.filter(b => b.month === month)}
          workspace={workspace}
          partners={partnerProfiles}
          onClose={() => setBudgetModal({ open: false })}
          onSave={saveBudget}
        />
      )}
      {goalShareModal.open && goalShareModal.goal && (
        <GoalShareModal
          goal={goalShareModal.goal}
          shares={goalShares.filter(s => s.goal_id === goalShareModal.goal!.id)}
          onClose={() => setGoalShareModal({ open: false })}
          onAddShare={saveGoalShare}
          onRemoveShare={deleteGoalShare}
          partnerProfiles={partnerProfiles}
        />
      )}
      {wsModalOpen && (
        <WorkspaceModal
          workspace={workspace}
          members={workspaceMembers}
          invites={workspaceInvites}
          pendingInvitesForMe={pendingInvitesForMe}
          partnerProfiles={partnerProfiles}
          onClose={() => setWsModalOpen(false)}
          onReload={reload}
        />
      )}
      {goalModal.open && (
        <GoalModal
          goal={goalModal.goal}
          accounts={accounts}
          onClose={() => setGoalModal({ open: false })}
          onSave={saveGoal}
        />
      )}
      {contributionGoal && (
        <ContributionModal
          goal={contributionGoal}
          onClose={() => setContributionGoal(null)}
          onSave={saveContribution}
        />
      )}
      {recurringModal.open && (
        <RecurringModal
          item={recurringModal.item}
          categories={categories}
          accounts={accounts}
          onClose={() => setRecurringModal({ open: false })}
          onSave={saveRecurring}
          onDelete={recurringModal.item ? () => deleteRecurring(recurringModal.item!.id) : undefined}
        />
      )}
      {payModal.open && payModal.entry && payModal.rec && (
        <PayAmountModal
          entry={payModal.entry}
          recurring={payModal.rec}
          onClose={() => setPayModal({ open: false })}
          onSave={async (amount) => { await doMarkPaid(payModal.entry!, payModal.rec!, amount) }}
        />
      )}
    </>
  )
}

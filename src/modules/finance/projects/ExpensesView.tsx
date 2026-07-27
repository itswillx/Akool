import { useState } from 'react'
import { Paperclip, Plus, Receipt } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { expensesTotal } from '../../../lib/financeProjectCalc'
import type { FinanceAccount, FinanceProject, FinanceProjectExpense } from '../../../types'
import { cardSurfaceStyle, primaryBtnStyle, tabularNums } from '../ui'
import { ExpenseModal } from './ExpenseModal'
import { PAYMENT_KEY, emptyStateStyle, rowStyle } from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

export function ExpensesView({ project, store, accounts }: {
  project: FinanceProject
  store: FinanceProjectsStore
  accounts: FinanceAccount[]
}) {
  const { t, lang } = useLanguage()
  const [modal, setModal] = useState<{ open: boolean; expense?: FinanceProjectExpense }>({ open: false })

  const expenses = store.expenses.filter(e => e.project_id === project.id)
  const stageName = (id: string | null) => store.stages.find(s => s.id === id)?.name
  const supplierName = (id: string | null) => store.suppliers.find(s => s.id === id)?.name

  // Grouped by day, newest first — the list is already ordered by date desc.
  const groups = expenses.reduce<Record<string, FinanceProjectExpense[]>>((acc, e) => {
    (acc[e.date] ??= []).push(e)
    return acc
  }, {})
  const days = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', ...tabularNums }}>
          {t('finance_proj_expenses_total', { n: expenses.length, value: formatBRL(expensesTotal(expenses)) })}
        </div>
        <button style={primaryBtnStyle} onClick={() => setModal({ open: true })}>
          <Plus size={15} />{t('finance_proj_expense_new')}
        </button>
      </div>

      {expenses.length === 0 ? (
        <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>
          <Receipt size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>{t('finance_proj_expenses_empty')}</div>
        </div>
      ) : (
        days.map(day => (
          <div key={day} style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: 'var(--color-bg-secondary)', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{new Date(day + 'T00:00:00').toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              <span style={tabularNums}>{formatBRL(expensesTotal(groups[day]))}</span>
            </div>
            {groups[day].map((e, idx) => (
              <button key={e.id} onClick={() => setModal({ open: true, expense: e })}
                style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', borderBottom: idx < groups[day].length - 1 ? '1px solid var(--color-border)' : 'none', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {stageName(e.stage_id) && <span>{stageName(e.stage_id)}</span>}
                    {supplierName(e.supplier_id) && <span>· {supplierName(e.supplier_id)}</span>}
                    <span>· {t(PAYMENT_KEY[e.payment_method])}</span>
                    {e.installments > 1 && <span>· {t('finance_proj_installments_short', { n: e.installments })}</span>}
                    {e.attachments.length > 0 && <Paperclip size={11} />}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', ...tabularNums, flexShrink: 0 }}>
                  {formatBRL(e.amount)}
                </div>
              </button>
            ))}
          </div>
        ))
      )}

      {modal.open && (
        <ExpenseModal
          project={project}
          store={store}
          expense={modal.expense}
          accounts={accounts}
          onClose={() => setModal({ open: false })}
          onSave={async draft => {
            if (modal.expense) await store.updateExpense(modal.expense.id, draft)
            else await store.createExpense({ ...draft, project_id: project.id })
          }}
          onDelete={modal.expense ? () => store.deleteExpense(modal.expense!.id) : undefined}
        />
      )}
    </div>
  )
}

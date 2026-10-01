// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Link2, Pencil, Trash2, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import {
expenseByCategory,
transactionsInMonth
} from '../../../lib/financeCalc'
import type { FinanceBudget, FinanceCategory, FinanceTransaction } from '../../../types'
import { fmt } from '../financeFormat'
import {
FIN_NEG,
FIN_POS
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'

// ─── Budgets Tab ──────────────────────────────────────────────────────────────

export function BudgetsTab({ budgets, sharedBudgets, transactions, partnerTransactions, partnerProfiles, categories, month, onAdd, onEdit, onDeleteBudget }: {
  budgets: FinanceBudget[]
  sharedBudgets: FinanceBudget[]
  transactions: FinanceTransaction[]
  partnerTransactions: FinanceTransaction[]
  partnerProfiles: PartnerProfile[]
  categories: FinanceCategory[]
  month: string
  onAdd: () => void
  onEdit: (budget: FinanceBudget) => void
  onDeleteBudget: (budget: FinanceBudget) => Promise<void>
}) {
  const { t } = useLanguage()
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const profileMap = useMemo(() => new Map(partnerProfiles.map(p => [p.id, p])), [partnerProfiles])
  const monthBudgets = useMemo(() => budgets.filter(b => b.month === month), [budgets, month])
  const monthSharedBudgets = useMemo(() => sharedBudgets.filter(b => b.month === month), [sharedBudgets, month])

  // PERF-005: gasto do mês por categoria, só quando as transações ou o mês mudam.
  const spentPerCat = useMemo(() => expenseByCategory(transactionsInMonth(transactions, month)), [transactions, month])
  const partnerSpentPerCat = useMemo(() => expenseByCategory(transactionsInMonth(partnerTransactions, month)), [partnerTransactions, month])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onAdd}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_new_budget')}
        </button>
      </div>

      {monthBudgets.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>{t('finance_no_budgets')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {monthBudgets.map(budget => {
            const cat = catMap.get(budget.category_id)
            const spent = spentPerCat[budget.category_id] ?? 0
            const pct = Math.min((spent / budget.amount_limit) * 100, 100)
            const over = spent > budget.amount_limit
            const remaining = budget.amount_limit - spent
            const barColor = over ? '#ef4444' : pct > 80 ? '#f59e0b' : (cat?.color ?? '#6366f1')

            return (
              <div key={budget.id} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{cat?.icon ?? '📦'}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{cat?.name ?? budget.category_id}</span>
                    {budget.workspace_id && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--color-text-subtle)', background: 'var(--color-active)', borderRadius: 10, padding: '2px 8px' }}>
                        <Users size={10} />{t('finance_scope_workspace')}
                      </span>
                    )}
                    {over && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', backgroundColor: '#ef444422', padding: '2px 6px', borderRadius: 10 }}>{t('finance_budget_over')}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button aria-label={t('common_edit')} onClick={() => onEdit(budget)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                      <Pencil size={13} />
                    </button>
                    <button aria-label={t('common_delete')} onClick={() => onDeleteBudget(budget)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <span>{t('finance_budget_spent')}: <strong style={{ color: over ? '#ef4444' : 'var(--color-text)' }}>{fmt(spent)}</strong></span>
                  <span>{t('finance_budget_limit')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(budget.amount_limit)}</strong></span>
                  <span>{over ? t('finance_budget_over') : t('finance_budget_remaining')}: <strong style={{ color: over ? FIN_NEG : FIN_POS }}>{fmt(Math.abs(remaining))}</strong></span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Shared budgets from partner */}
      {monthSharedBudgets.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link2 size={11} />{t('finance_shared_badge')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {monthSharedBudgets.map(budget => {
              const cat = catMap.get(budget.category_id)
              const owner = profileMap.get(budget.user_id)
              const ownSpent = spentPerCat[budget.category_id] ?? 0
              const partnerSpent = partnerSpentPerCat[budget.category_id] ?? 0
              const combinedSpent = ownSpent + partnerSpent
              const pct = Math.min((combinedSpent / budget.amount_limit) * 100, 100)
              const over = combinedSpent > budget.amount_limit
              const barColor = over ? '#ef4444' : pct > 80 ? '#f59e0b' : 'var(--color-text)'
              return (
                <div key={budget.id} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{cat?.icon ?? '📦'}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{cat?.name ?? budget.category_id}</span>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 700 }}>{t('finance_shared_badge')}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('finance_budget_shared_by')} {owner?.display_name || owner?.email}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <span>{t('finance_budget_combined_spent')}: <strong style={{ color: over ? '#ef4444' : 'var(--color-text)' }}>{fmt(combinedSpent)}</strong></span>
                    <span>{t('finance_budget_limit')}: <strong>{fmt(budget.amount_limit)}</strong></span>
                    <span>{over ? t('finance_budget_over') : t('finance_budget_remaining')}: <strong style={{ color: over ? FIN_NEG : FIN_POS }}>{fmt(Math.abs(budget.amount_limit - combinedSpent))}</strong></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

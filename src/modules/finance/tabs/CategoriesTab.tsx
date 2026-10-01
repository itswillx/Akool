// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Pencil, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { activateProps } from '../../../lib/a11y'
import {
countByCategory,
type FinanceTxAgg
} from '../../../lib/financeCalc'
import type { FinanceCategory } from '../../../types'
import {
FIN_POS
} from '../ui'


// ─── Categories Tab ───────────────────────────────────────────────────────────

export function CategoriesTab({ categories, transactions, onAdd, onEdit }: {
  categories: FinanceCategory[]
  transactions: FinanceTxAgg[]
  onAdd: () => void
  onEdit: (c: FinanceCategory) => void
}) {
  const { t } = useLanguage()
  const expenses = categories.filter(c => c.type === 'expense')
  const incomes = categories.filter(c => c.type === 'income')

  // PERF-005: contagem numa passada (antes, um filtro da lista inteira por
  // categoria, duas vezes por linha).
  const counts = useMemo(() => countByCategory(transactions), [transactions])
  const txCount = (id: string) => counts.get(id) ?? 0

  const renderList = (cats: FinanceCategory[]) => cats.map(cat => (
    <div key={cat.id}
      {...activateProps(() => onEdit(cat))}
      onClick={() => onEdit(cat)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'background-color 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
    >
      <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, backgroundColor: `${cat.color}22` }}>
        {cat.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {cat.name}
          {cat.workspace_id && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-active)', borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>
              <Users size={10} />{t('finance_scope_workspace')}
            </span>
          )}
        </p>
        {txCount(cat.id) > 0 && (
          <span style={{ fontSize: 11, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 10, padding: '2px 8px' }}>{txCount(cat.id)}x</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: cat.color, flexShrink: 0 }} />
        <Pencil size={13} color="var(--color-text-muted)" />
      </div>
    </div>
  ))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onAdd}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_cat_new')}
        </button>
      </div>
      {categories.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>{t('finance_cat_no_categories')}</p>
      ) : (
        <>
          {expenses.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_expenses')} ({expenses.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{renderList(expenses)}</div>
            </div>
          )}
          {incomes.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: FIN_POS, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_income')} ({incomes.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{renderList(incomes)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

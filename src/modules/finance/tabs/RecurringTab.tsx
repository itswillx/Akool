// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { FinanceCategory, FinanceRecurring, FinanceRecurringEntry } from '../../../types'
import { fmt } from '../financeFormat'
import {
FIN_NEG,
FIN_POS,
FIN_POS_SOFT
} from '../ui'

// ─── Recurring Tab ─────────────────────────────────────────────────────────────

export function RecurringTab({ recurring, recurringEntries, categories, month, onAdd, onEdit, onMarkPaid, onSkip }: {
  recurring: FinanceRecurring[]
  recurringEntries: FinanceRecurringEntry[]
  categories: FinanceCategory[]
  month: string
  onAdd: () => void
  onEdit: (item: FinanceRecurring) => void
  onMarkPaid: (entry: FinanceRecurringEntry, rec: FinanceRecurring) => void
  onSkip: (entryId: string) => void
}) {
  const { t } = useLanguage()
  const [confirm, setConfirm] = useState<{ entryId: string; action: 'pay' | 'skip' } | null>(null)
  const catMap = new Map(categories.map(c => [c.id, c]))

  const entryByRecurring = new Map<string, FinanceRecurringEntry>()
  recurringEntries.filter(e => e.due_date.startsWith(month)).forEach(e => {
    entryByRecurring.set(e.recurring_id, e)
  })

  const expenses = recurring.filter(r => r.type === 'expense')
  const incomes = recurring.filter(r => r.type === 'income')

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const getEntryBadge = (entry: FinanceRecurringEntry | undefined, dueDate: string) => {
    if (!entry) return null
    if (entry.status === 'paid') return { label: t('finance_entry_paid'), color: FIN_POS }
    if (entry.status === 'skipped') return { label: t('finance_entry_skipped'), color: '#9ca3af' }
    const due = new Date(dueDate + 'T12:00:00')
    if (due < today) return { label: t('finance_entry_overdue'), color: '#ef4444' }
    return { label: t('finance_entry_pending'), color: '#f59e0b' }
  }

  const renderItem = (item: FinanceRecurring) => {
    const cat = item.category_id ? catMap.get(item.category_id) : null
    const [year, mon] = month.split('-').map(Number)
    const lastDay = new Date(year, mon, 0).getDate()
    const day = Math.min(item.day_of_month, lastDay)
    const dueDate = `${month}-${String(day).padStart(2, '0')}`
    const entry = entryByRecurring.get(item.id)
    const badge = getEntryBadge(entry, dueDate)

    // Installment progress
    const itemEntries = item.total_installments != null
      ? recurringEntries.filter(e => e.recurring_id === item.id).sort((a, b) => a.due_date.localeCompare(b.due_date))
      : null
    const paidCount = itemEntries ? itemEntries.filter(e => e.status === 'paid').length : 0
    const currentInstallment = itemEntries && entry
      ? itemEntries.findIndex(e => e.id === entry.id) + 1
      : (itemEntries ? itemEntries.length : 0)
    const isFullyPaid = item.total_installments != null && paidCount >= item.total_installments

    return (
      <div key={item.id} style={{ borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', overflow: 'hidden', opacity: item.active ? 1 : 0.6 }}>
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, backgroundColor: cat ? `${cat.color}22` : 'var(--color-border)' }}>
            {cat ? cat.icon : (item.type === 'income' ? '💰' : '💸')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>{item.description}</span>
              {!item.active && !isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {t('finance_recurring_inactive')}
                </span>
              )}
              {isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: FIN_POS_SOFT, color: FIN_POS, fontWeight: 600 }}>
                  {t('finance_recurring_installments_done')}
                </span>
              )}
              {item.total_installments != null && !isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: 'var(--color-active)', color: 'var(--color-text-subtle)', fontWeight: 600 }}>
                  {t('finance_recurring_installment_badge').replace('{current}', String(currentInstallment)).replace('{total}', String(item.total_installments))}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {t('finance_recurring_day', { n: item.day_of_month })}
              {cat ? ` · ${cat.name}` : ''}
              {item.is_variable
                ? ` · ${t('finance_upcoming_variable')}`
                : item.amount != null ? ` · ${fmt(item.amount)}` : ''}
              {item.total_installments != null && ` · ${paidCount}/${item.total_installments} pagas`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {badge && (
              <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, backgroundColor: `${badge.color}22`, color: badge.color, fontWeight: 600 }}>
                {badge.label}
              </span>
            )}
            <button aria-label={t('common_edit')} onClick={() => onEdit(item)}
              style={{ padding: '5px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
              <Pencil size={12} />
            </button>
          </div>
        </div>

        {entry && entry.status === 'pending' && item.active && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 14px 12px', borderTop: '1px solid var(--color-border)' }}>
            {confirm?.entryId === entry.id ? (
              <>
                <button onClick={() => { if (confirm.action === 'pay') onMarkPaid(entry, item); else onSkip(entry.id); setConfirm(null) }}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', backgroundColor: confirm.action === 'pay' ? FIN_POS : FIN_NEG, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  ✓ {t('finance_confirm')}
                </button>
                <button onClick={() => setConfirm(null)}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
                  {t('finance_cancel')}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setConfirm({ entryId: entry.id, action: 'pay' })}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', backgroundColor: FIN_POS, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  {t('finance_recurring_mark_paid')}
                </button>
                <button onClick={() => setConfirm({ entryId: entry.id, action: 'skip' })}
                  style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
                  {t('finance_recurring_skip')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onAdd}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_recurring_new')}
        </button>
      </div>

      {recurring.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
          {t('finance_recurring_list_empty')}
        </p>
      ) : (
        <>
          {expenses.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_expenses')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{expenses.map(renderItem)}</div>
            </div>
          )}
          {incomes.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_income')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{incomes.map(renderItem)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

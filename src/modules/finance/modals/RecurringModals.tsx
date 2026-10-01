// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Field } from '../../../components/Field'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import type { FinanceAccount, FinanceCategory, FinanceRecurring, FinanceRecurringEntry, FinanceTxType } from '../../../types'
import {
FIN_NEG,
FIN_POS,
FIN_POS_SOFT,
inputStyle, labelStyle,
Modal
} from '../ui'


// ─── Recurring Modal ──────────────────────────────────────────────────────────

interface RecurringForm {
  type: FinanceTxType
  description: string
  is_variable: boolean
  amount: string
  category_id: string
  account_id: string
  day_of_month: number
  active: boolean
  total_installments: string
}

export function RecurringModal({ item, categories, accounts, onClose, onSave, onDelete }: {
  item?: FinanceRecurring
  categories: FinanceCategory[]
  accounts: FinanceAccount[]
  onClose: () => void
  onSave: (data: Omit<FinanceRecurring, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState<RecurringForm>({
    type: item?.type ?? 'expense',
    description: item?.description ?? '',
    is_variable: item?.is_variable ?? false,
    amount: item?.amount != null ? String(fromCents(item.amount)) : '',
    category_id: item?.category_id ?? '',
    account_id: item?.account_id ?? '',
    day_of_month: item?.day_of_month ?? 1,
    active: item?.active ?? true,
    total_installments: item?.total_installments != null ? String(item.total_installments) : '',
  })
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cats = categories.filter(c => c.type === form.type)

  const handleSave = async () => {
    if (!form.description.trim()) return
    if (!form.is_variable && toCents(form.amount) <= 0) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        type: form.type,
        description: form.description.trim(),
        is_variable: form.is_variable,
        amount: form.is_variable ? null : toCents(form.amount),
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        day_of_month: form.day_of_month,
        active: form.active,
        total_installments: form.total_installments && !isNaN(Number(form.total_installments)) && Number(form.total_installments) > 0 ? Number(form.total_installments) : null,
      })
      onClose()
    } catch {
      setError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    setError(null)
    try {
      await onDelete!()
      onClose()
    } catch {
      setError(t('finance_delete_error'))
    } finally {
      setSaving(false)
    }
  }

  const toggleStyle = (on: boolean, color: string): React.CSSProperties => ({
    width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
    backgroundColor: on ? color : 'var(--color-border)', position: 'relative',
    flexShrink: 0, transition: 'background-color 0.2s',
  })
  const thumbStyle = (on: boolean): React.CSSProperties => ({
    position: 'absolute', top: 2, left: on ? 18 : 2,
    width: 16, height: 16, borderRadius: '50%', backgroundColor: '#fff',
    transition: 'left 0.2s',
  })

  return (
    <Modal title={item ? t('finance_recurring_edit') : t('finance_recurring_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['expense', 'income'] as FinanceTxType[]).map(tp => (
            <button key={tp} type="button"
              onClick={() => setForm(f => ({ ...f, type: tp, category_id: '' }))}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8,
                border: `2px solid ${form.type === tp ? (tp === 'expense' ? FIN_NEG : FIN_POS) : 'var(--color-border)'}`,
                backgroundColor: form.type === tp ? (tp === 'expense' ? '#ef444422' : FIN_POS_SOFT) : 'transparent',
                color: form.type === tp ? (tp === 'expense' ? FIN_NEG : FIN_POS) : 'var(--color-text-muted)',
                cursor: 'pointer', fontSize: 14, fontWeight: 600,
              }}>
              {tp === 'expense' ? t('finance_tx_expense') : t('finance_tx_income')}
            </button>
          ))}
        </div>

        <div>
          <Field label={t('finance_recurring_description')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="text" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={form.type === 'expense' ? t('finance_recurring_desc_placeholder_expense') : t('finance_recurring_desc_placeholder_income')} />
          )}</Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button role="switch" aria-checked={form.is_variable} aria-label={t('finance_recurring_variable_bill')} type="button" onClick={() => setForm(f => ({ ...f, is_variable: !f.is_variable, amount: '' }))}
            style={toggleStyle(form.is_variable, 'var(--color-btn-primary)')}>
            <span style={thumbStyle(form.is_variable)} />
          </button>
          <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{t('finance_recurring_variable_bill')}</span>
        </div>

        {!form.is_variable && (
          <div>
            <Field label={t('finance_recurring_fixed_amount')} labelStyle={labelStyle}>{control => (
              <input {...control} style={inputStyle} type="number" min="0" step="0.01" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            )}</Field>
          </div>
        )}

        <div>
          <Field label={t('finance_recurring_day_of_month')} labelStyle={labelStyle}>{control => (
            <select {...control} style={inputStyle} value={form.day_of_month}
              onChange={e => setForm(f => ({ ...f, day_of_month: Number(e.target.value) }))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}</Field>
        </div>

        <div>
          <Field label={t('finance_tx_category')} labelStyle={labelStyle}>{control => (
            <select {...control} style={inputStyle} value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              <option value="">{t('finance_tx_none_category')}</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          )}</Field>
        </div>

        <div>
          <Field label={t('finance_tx_account')} labelStyle={labelStyle}>{control => (
            <select {...control} style={inputStyle} value={form.account_id}
              onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
              <option value="">{t('finance_tx_none_account')}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
            </select>
          )}</Field>
        </div>

        <div>
          <Field label={t('finance_recurring_installments_label')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="number" min="1" step="1"
              value={form.total_installments}
              onChange={e => setForm(f => ({ ...f, total_installments: e.target.value }))}
              placeholder={t('finance_recurring_installments_placeholder')} />
          )}</Field>
        </div>

        {item && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button role="switch" aria-checked={form.active} aria-label={t('finance_recurring_active')} type="button" onClick={() => setForm(f => ({ ...f, active: !f.active }))}
              style={toggleStyle(form.active, FIN_POS)}>
              <span style={thumbStyle(form.active)} />
            </button>
            <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
              {form.active ? t('finance_recurring_active') : t('finance_recurring_inactive')}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        {onDelete && !confirming && (
          <button onClick={() => setConfirming(true)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ef444488', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 13, marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Trash2 size={13} />{t('finance_delete')}
          </button>
        )}
        {confirming && (
          <button onClick={handleDelete} disabled={saving}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, marginRight: 'auto', opacity: saving ? 0.7 : 1 }}>
            {t('finance_confirm_delete')}
          </button>
        )}
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

// ─── Pay Amount Modal ──────────────────────────────────────────────────────────

export function PayAmountModal({ entry, recurring, onClose, onSave }: {
  entry: FinanceRecurringEntry
  recurring: FinanceRecurring
  onClose: () => void
  onSave: (amount: number) => Promise<void>
}) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState(recurring.amount != null ? String(fromCents(recurring.amount)) : '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const v = toCents(amount)
    if (!v || v <= 0) return
    setSaving(true)
    try {
      await onSave(v)
      onClose()
    } catch {
      // doMarkPaid already toasts the error; just keep the modal open so the
      // user can retry instead of silently "succeeding" and closing.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t('finance_recurring_mark_paid')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          {recurring.description} · {new Date(entry.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
        </p>
        <div>
          <Field label={t('finance_recurring_enter_amount')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="number" min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} autoFocus />
          )}</Field>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving || !amount}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: (saving || !amount) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: (saving || !amount) ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

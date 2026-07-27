import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL, fromCents, toCents } from '../../../lib/money'
import { installmentSchedule } from '../../../lib/financeProjectCalc'
import type {
  FinanceAccount,
  FinanceAttachment,
  FinancePaymentMethod,
  FinanceProject,
  FinanceProjectExpense,
} from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import { AttachmentField } from './AttachmentField'
import { PAYMENT_KEY, PAYMENT_METHODS } from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

export interface ExpenseDraft {
  stage_id: string | null
  item_id: string | null
  supplier_id: string | null
  account_id: string | null
  description: string
  amount: number
  date: string
  payment_method: FinancePaymentMethod
  installments: number
  attachments: FinanceAttachment[]
}

// Local "today" as YYYY-MM-DD. Built from the local date parts rather than
// toISOString(), which would roll back a day in UTC-3.
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function ExpenseModal({ project, store, expense, prefill, accounts, onClose, onSave, onDelete }: {
  project: FinanceProject
  store: FinanceProjectsStore
  expense?: FinanceProjectExpense
  /** Pre-filled values when the expense is created straight from a shopping item. */
  prefill?: Partial<ExpenseDraft>
  accounts: FinanceAccount[]
  onClose: () => void
  onSave: (draft: ExpenseDraft) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const base = expense ?? prefill
  const [description, setDescription] = useState(base?.description ?? '')
  const [amount, setAmount] = useState(base?.amount ? String(fromCents(base.amount)) : '')
  const [date, setDate] = useState(base?.date ?? todayISO())
  const [stageId, setStageId] = useState(base?.stage_id ?? '')
  const [supplierId, setSupplierId] = useState(base?.supplier_id ?? '')
  const [accountId, setAccountId] = useState(base?.account_id ?? '')
  const [method, setMethod] = useState<FinancePaymentMethod>(base?.payment_method ?? 'pix')
  const [installments, setInstallments] = useState(String(base?.installments ?? 1))
  const [attachments, setAttachments] = useState<FinanceAttachment[]>(base?.attachments ?? [])
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const stages = store.stages.filter(s => s.project_id === project.id)
  const cents = toCents(amount)
  const count = Math.max(1, Number(installments) || 1)
  const schedule = cents > 0 && count > 1 ? installmentSchedule({ amount: cents, date, installments: count }) : []

  const handleSave = async () => {
    if (!description.trim() || cents <= 0) return
    setSaving(true)
    try {
      await onSave({
        stage_id: stageId || null,
        item_id: base?.item_id ?? null,
        supplier_id: supplierId || null,
        account_id: accountId || null,
        description: description.trim(),
        amount: cents,
        date,
        payment_method: method,
        installments: count,
        attachments,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={expense ? t('finance_proj_expense_edit') : t('finance_proj_expense_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_proj_expense_desc')}</label>
          <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)}
            placeholder={t('finance_proj_expense_desc_placeholder')} autoFocus />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_amount')}</label>
            <input style={inputStyle} type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_date')}</label>
            <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_proj_stage')}</label>
          <select style={inputStyle} value={stageId} onChange={e => setStageId(e.target.value)}>
            <option value="">{t('finance_proj_no_stage')}</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_proj_supplier')}</label>
          <select style={inputStyle} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">{t('finance_proj_no_supplier')}</option>
            {store.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_payment')}</label>
            <select style={inputStyle} value={method} onChange={e => setMethod(e.target.value as FinancePaymentMethod)}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{t(PAYMENT_KEY[m])}</option>)}
            </select>
          </div>
          <div style={{ width: 110 }}>
            <label style={labelStyle}>{t('finance_proj_installments')}</label>
            <input style={inputStyle} type="number" min="1" max="120" value={installments} onChange={e => setInstallments(e.target.value)} />
          </div>
        </div>

        {schedule.length > 0 && (
          <div style={{ padding: '9px 11px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-secondary)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 5 }}>
              {t('finance_proj_installment_plan')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text)', ...tabularNums }}>
              {t('finance_proj_installment_summary', {
                n: schedule.length,
                value: formatBRL(schedule[0].amount),
                first: schedule[0].due_date,
                last: schedule[schedule.length - 1].due_date,
              })}
            </div>
          </div>
        )}

        <div>
          <label style={labelStyle}>{t('finance_proj_account')}</label>
          <select style={inputStyle} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">{t('finance_proj_no_account')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </div>

        <AttachmentField projectId={project.id} value={attachments} onChange={setAttachments} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || cents <= 0 || !description.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || cents <= 0 || !description.trim()}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>

        {expense && onDelete && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_proj_expense_delete_warning')}</span>
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }} onClick={async () => { await onDelete(); onClose() }}>{t('finance_confirm_delete')}</button>
              <button style={ghostBtnStyle} onClick={() => setConfirming(false)}>{t('finance_cancel')}</button>
            </div>
          ) : (
            <button style={{ ...ghostBtnStyle, color: 'var(--color-error)', justifyContent: 'center' }} onClick={() => setConfirming(true)}>{t('finance_delete')}</button>
          )
        )}
      </div>
    </Modal>
  )
}

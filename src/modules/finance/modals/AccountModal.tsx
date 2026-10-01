// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Field, FieldGroup } from '../../../components/Field'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import type { FinanceAccount, FinanceWorkspace } from '../../../types'
import { ACCOUNT_TYPE_ICONS } from '../financeFormat'
import {
EmojiInput,
inputStyle, labelStyle,
Modal,
ScopePicker
} from '../ui'

// ─── Account Modal ────────────────────────────────────────────────────────────

const ACCOUNT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316']

export function AccountModal({
  account, workspace, userId, onClose, onSave, onDelete,
}: {
  account?: FinanceAccount
  workspace?: FinanceWorkspace | null
  userId: string
  onClose: () => void
  onSave: (data: Omit<FinanceAccount, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'checking',
    initial_balance: account ? String(fromCents(account.initial_balance)) : '0',
    color: account?.color ?? '#6366f1',
    icon: account?.icon ?? '🏦',
    credit_limit: account?.credit_limit != null ? String(fromCents(account.credit_limit)) : '',
    workspace_id: account?.workspace_id ?? null as string | null,
  })

  const handleTypeChange = (accType: FinanceAccount['type']) => {
    setForm(f => ({ ...f, type: accType, icon: ACCOUNT_TYPE_ICONS[accType] ?? '🏦' }))
  }
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: form.name.trim(),
        type: form.type,
        initial_balance: toCents(form.initial_balance),
        color: form.color,
        icon: form.icon || ACCOUNT_TYPE_ICONS[form.type] || '🏦',
        // Cleared on purpose when the account is no longer a credit card.
        credit_limit: form.type === 'credit' && form.credit_limit.trim() ? toCents(form.credit_limit) : null,
        workspace_id: form.workspace_id,
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
      await onDelete?.()
      onClose()
    } catch {
      setError(t('finance_delete_error'))
    } finally {
      setSaving(false)
    }
  }

  const typeLabels: Record<string, string> = {
    checking: t('finance_account_type_checking'),
    savings: t('finance_account_type_savings'),
    credit: t('finance_account_type_credit'),
    cash: t('finance_account_type_cash'),
  }

  return (
    <Modal title={account ? t('finance_edit') : t('finance_new_account')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Field label={t('finance_account_name')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          )}</Field>
        </div>
        <div>
          <Field label={t('finance_account_type')} labelStyle={labelStyle}>{control => (
            <select {...control} style={inputStyle} value={form.type}
              onChange={e => handleTypeChange(e.target.value as FinanceAccount['type'])}>
              {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}</Field>
        </div>
        {workspace && (
          <ScopePicker
            value={form.workspace_id}
            onChange={ws => setForm(f => ({ ...f, workspace_id: ws }))}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            disabled={!!account && account.user_id !== userId}
          />
        )}
        <div>
          <Field label={t('finance_account_balance')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="number" step="0.01" value={form.initial_balance}
              onChange={e => setForm(f => ({ ...f, initial_balance: e.target.value }))} />
          )}</Field>
        </div>
        {form.type === 'credit' && (
          <div>
            <Field label={t('finance_account_credit_limit')} labelStyle={labelStyle}>{control => (
              <input {...control} style={inputStyle} type="number" step="0.01" min="0" value={form.credit_limit}
                onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))} />
            )}</Field>
          </div>
        )}
        <EmojiInput label={t('finance_goal_icon')} value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        <FieldGroup label={t('finance_account_color')} labelStyle={labelStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ACCOUNT_COLORS.map(c => (
              <button type="button" aria-label={t('common_color', { color: c })} aria-pressed={form.color === c} key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width: 28, height: 28, borderRadius: '50%', border: form.color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </FieldGroup>
      </div>
      {error && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        {account && onDelete && !confirming && (
          <button onClick={() => setConfirming(true)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trash2 size={13} />{t('finance_delete')}
          </button>
        )}
        {confirming && (
          <button onClick={handleDelete} disabled={saving}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, opacity: saving ? 0.7 : 1 }}>
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
    </Modal>
  )
}

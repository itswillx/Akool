// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Field, FieldGroup } from '@/shared/ui/Field'
import { useLanguage } from '../../../i18n/LanguageContext'
import {
type FinanceTxAgg
} from '../../../lib/financeCalc'
import type { FinanceCategory, FinanceTxType, FinanceWorkspace } from '../../../types'
import {
EmojiInput,
FIN_NEG,
FIN_POS,
FIN_POS_SOFT,
inputStyle, labelStyle,
Modal,
ScopePicker
} from '../ui'


// ─── Category Modal ───────────────────────────────────────────────────────────

const CATEGORY_COLORS = ['#f97316','#3b82f6','#8b5cf6','#ef4444','#ec4899','#06b6d4','#22c55e','#84cc16','#f59e0b','#10b981','#a855f7','#6b7280']

export function CategoryModal({
  category, transactions, workspace, userId, onClose, onSave, onDelete,
}: {
  category?: FinanceCategory
  transactions: FinanceTxAgg[]
  workspace?: FinanceWorkspace | null
  userId: string
  onClose: () => void
  onSave: (data: Omit<FinanceCategory, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    name: category?.name ?? '',
    type: category?.type ?? 'expense',
    icon: category?.icon ?? '📦',
    color: category?.color ?? '#6b7280',
    is_default: category?.is_default ?? false,
    workspace_id: category?.workspace_id ?? null as string | null,
  })
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inUse = category ? transactions.some(tx => tx.category_id === category.id) : false

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: form.name.trim(), type: form.type, icon: form.icon || '📦', color: form.color, is_default: form.is_default, workspace_id: form.workspace_id })
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

  return (
    <Modal title={category ? t('finance_cat_edit') : t('finance_cat_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Field label={t('finance_cat_name')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="text" value={form.name} autoFocus
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          )}</Field>
        </div>
        <FieldGroup label={t('finance_cat_type')} labelStyle={labelStyle}>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['expense', 'income'] as FinanceTxType[]).map(tp => (
              <button key={tp} onClick={() => setForm(f => ({ ...f, type: tp }))}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: '2px solid',
                  borderColor: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-border)',
                  backgroundColor: form.type === tp ? (tp === 'income' ? FIN_POS_SOFT : '#ef444422') : 'transparent',
                  color: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-text-muted)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 14,
                }}>
                {tp === 'income' ? t('finance_tx_income') : t('finance_tx_expense')}
              </button>
            ))}
          </div>
        </FieldGroup>
        {workspace && (
          <ScopePicker
            value={form.workspace_id}
            onChange={ws => setForm(f => ({ ...f, workspace_id: ws }))}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            disabled={!!category && category.user_id !== userId}
          />
        )}
        <EmojiInput label={t('finance_cat_icon')} value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        <FieldGroup label={t('finance_cat_color')} labelStyle={labelStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORY_COLORS.map(c => (
              <button aria-label={t('common_color', { color: c })} aria-pressed={form.color === c} key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width: 28, height: 28, borderRadius: '50%', border: form.color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </FieldGroup>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end', alignItems: 'center' }}>
        {category && onDelete && !confirming && (
          inUse ? (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_cat_in_use')}</span>
          ) : (
            <button onClick={() => setConfirming(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={13} />{t('finance_delete')}
            </button>
          )
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
      {error && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

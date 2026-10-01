// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useState } from 'react'
import { Field } from '../../../components/Field'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import type { FinanceBudget, FinanceCategory, FinanceWorkspace } from '../../../types'
import {
inputStyle, labelStyle,
Modal,
ScopePicker
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'
import { UserPicker } from './pickers'

// ─── Budget Modal ─────────────────────────────────────────────────────────────

export function BudgetModal({
  budget, personalCategories, workspaceCategories, month, personalExisting, workspaceExisting, workspace, partners, onClose, onSave,
}: {
  budget?: FinanceBudget
  personalCategories: FinanceCategory[]
  workspaceCategories: FinanceCategory[]
  month: string
  personalExisting: FinanceBudget[]
  workspaceExisting: FinanceBudget[]
  workspace?: FinanceWorkspace | null
  partners: PartnerProfile[]
  onClose: () => void
  onSave: (data: { category_id: string; month: string; amount_limit: number; shared_with_user_id: string | null; workspace_id: string | null }) => Promise<void>
}) {
  const { t } = useLanguage()
  // null = personal budget; workspace id = coworkspace budget. A workspace
  // budget references a workspace category, so the lists swap with the scope.
  const [scopeWs, setScopeWs] = useState<string | null>(budget?.workspace_id ?? null)
  const [catId, setCatId] = useState(budget?.category_id ?? '')
  const [limit, setLimit] = useState(budget ? String(fromCents(budget.amount_limit)) : '')
  const [sharedWith, setSharedWith] = useState(budget?.shared_with_user_id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories = scopeWs ? workspaceCategories : personalCategories
  const existing = scopeWs ? workspaceExisting : personalExisting
  const expenseCats = categories.filter(c => c.type === 'expense')
  // Exclude the budget's own category from "already used" — otherwise editing
  // a budget hides its own category (and, if it's the only one, the whole form).
  const usedIds = new Set(existing.filter(b => b.id !== budget?.id).map(b => b.category_id))
  const available = expenseCats.filter(c => !usedIds.has(c.id) || c.id === budget?.category_id)
  const effectiveCatId = catId || available[0]?.id || ''

  const handleSave = async () => {
    const amt = toCents(limit)
    if (!effectiveCatId || !amt || amt <= 0) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        category_id: effectiveCatId,
        month,
        amount_limit: amt,
        shared_with_user_id: scopeWs ? null : (sharedWith || null),
        workspace_id: scopeWs,
      })
      onClose()
    } catch {
      setError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(budget ? 'finance_edit_budget' : 'finance_new_budget')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {workspace && (
          <ScopePicker
            value={scopeWs}
            onChange={ws => { setScopeWs(ws); setCatId('') }}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
          />
        )}
        {available.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: 0 }}>{t('finance_all_categories_budgeted')}</p>
        ) : (
          <>
            <div>
              <Field label={t('finance_budget_category')} labelStyle={labelStyle}>{control => (
                <select {...control} style={inputStyle} value={effectiveCatId} onChange={e => setCatId(e.target.value)}>
                  {available.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
              )}</Field>
            </div>
            <div>
              <Field label={t('finance_budget_limit')} labelStyle={labelStyle}>{control => (
                <input {...control} style={inputStyle} type="number" min="0" step="0.01" value={limit}
                  onChange={e => setLimit(e.target.value)} />
              )}</Field>
            </div>
            {!scopeWs && (
              <UserPicker
                label={t('finance_share_with')}
                value={sharedWith}
                onChange={setSharedWith}
                knownPartners={partners}
              />
            )}
          </>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving || !effectiveCatId}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving || !effectiveCatId ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving || !effectiveCatId ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

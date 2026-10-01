// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useState } from 'react'
import { Field, FieldGroup } from '../../../components/Field'
import { UserAvatar } from '../../../components/UserAvatar'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import type { FinanceAccount, FinanceGoal, FinanceGoalShare } from '../../../types'
import {
EmojiInput,
inputStyle, labelStyle,
Modal
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'
import { UserPicker } from './pickers'

const GOAL_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#ec4899','#06b6d4','#8b5cf6','#f97316','#14b8a6']

// ─── Goal Modal ───────────────────────────────────────────────────────────────

export function GoalModal({ goal, accounts, onClose, onSave }: {
  goal?: FinanceGoal
  accounts: FinanceAccount[]
  onClose: () => void
  onSave: (data: Omit<FinanceGoal, 'id' | 'user_id' | 'created_at'>) => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    name: goal?.name ?? '',
    icon: goal?.icon ?? '🎯',
    color: goal?.color ?? '#6366f1',
    target_amount: goal ? String(fromCents(goal.target_amount)) : '',
    deadline: goal?.deadline ?? '',
    account_id: goal?.account_id ?? '',
    status: goal?.status ?? 'active',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const amt = toCents(form.target_amount)
    if (!form.name.trim() || !amt || !form.deadline) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: form.name.trim(),
        icon: form.icon,
        color: form.color,
        target_amount: amt,
        deadline: form.deadline,
        account_id: form.account_id || null,
        status: form.status,
      })
      onClose()
    } catch {
      setError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={goal ? t('finance_edit') : t('finance_goal_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Field label={t('finance_goal_name')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          )}</Field>
        </div>
        <EmojiInput label={t('finance_goal_icon')} value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        <FieldGroup label={t('finance_goal_color')} labelStyle={labelStyle}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GOAL_COLORS.map(c => (
              <button aria-label={t('common_color', { color: c })} aria-pressed={form.color === c} key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width: 28, height: 28, borderRadius: '50%', border: form.color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </FieldGroup>
        <div>
          <Field label={t('finance_goal_target')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="number" min="0" step="0.01" value={form.target_amount}
              onChange={e => setForm(f => ({ ...f, target_amount: e.target.value }))} />
          )}</Field>
        </div>
        <div>
          <Field label={t('finance_goal_deadline')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="date" value={form.deadline}
              onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
          )}</Field>
        </div>
        <div>
          <Field label={t('finance_goal_linked_account')} labelStyle={labelStyle}>{control => (
            <select {...control} style={inputStyle} value={form.account_id}
              onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
              <option value="">{t('finance_tx_none_account')}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
            </select>
          )}</Field>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
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

// ─── Contribution Modal ───────────────────────────────────────────────────────

export function ContributionModal({ goal, onClose, onSave }: {
  goal: FinanceGoal
  onClose: () => void
  onSave: (data: { goal_id: string; amount: number; note: string; date: string }) => Promise<void>
}) {
  const { t } = useLanguage()
  const today = new Date().toISOString().split('T')[0]
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const amt = toCents(amount)
    if (!amt || amt <= 0) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ goal_id: goal.id, amount: amt, note: note.trim(), date })
      onClose()
    } catch {
      setError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t('finance_goal_add_contribution')} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: `${goal.color}22`, borderRadius: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 22 }}>{goal.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{goal.name}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Field label={t('finance_goal_contribution_amount')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="number" min="0" step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} autoFocus />
          )}</Field>
        </div>
        <div>
          <Field label={t('finance_goal_contribution_date')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="date" value={date}
              onChange={e => setDate(e.target.value)} />
          )}</Field>
        </div>
        <div>
          <Field label={t('finance_goal_contribution_note')} labelStyle={labelStyle}>{control => (
            <input {...control} style={inputStyle} type="text" value={note}
              onChange={e => setNote(e.target.value)} placeholder={t('finance_contribution_note_placeholder')} />
          )}</Field>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: goal.color, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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

// ─── Goal Share Modal ────────────────────────────────────────────────────────────────

export function GoalShareModal({ goal, shares, onClose, onAddShare, onRemoveShare, partnerProfiles }: {
  goal: FinanceGoal
  shares: FinanceGoalShare[]
  onClose: () => void
  onAddShare: (goalId: string, userId: string) => Promise<void>
  onRemoveShare: (shareId: string) => Promise<void>
  partnerProfiles: PartnerProfile[]
}) {
  const { t } = useLanguage()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!selectedUserId) return
    setSaving(true)
    setError(null)
    try {
      await onAddShare(goal.id, selectedUserId)
      setSelectedUserId('')
    } catch {
      setError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${t('finance_goal_share_title')}: ${goal.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Current collaborators */}
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_goal_collaborators')}</p>
          {shares.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_goal_no_collaborators')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shares.map(s => {
                const p = s.profile
                const name = p?.display_name || p?.email || s.shared_with_user_id
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <UserAvatar name={name} seed={p?.email} emoji={p?.avatar_emoji} color={p?.avatar_color} url={p?.avatar_url} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{name}</p>
                      {p?.email && p.display_name && <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{p.email}</p>}
                    </div>
                    <button onClick={() => onRemoveShare(s.id)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                      {t('finance_goal_remove_collaborator')}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Add new collaborator */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
          <UserPicker
            label={t('finance_goal_add_collaborator')}
            value={selectedUserId}
            onChange={setSelectedUserId}
            knownPartners={partnerProfiles.filter(p => !shares.some(s => s.shared_with_user_id === p.id))}
          />
          {selectedUserId && (
            <button onClick={handleAdd} disabled={saving}
              style={{ marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? '...' : t('finance_goal_add_collaborator')}
            </button>
          )}
          {error && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
      </div>
    </Modal>
  )
}

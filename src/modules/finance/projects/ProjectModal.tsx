import { useState } from 'react'
import { Users } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import type { FinanceProject, FinanceProjectStatus } from '../../../types'
import { EmojiInput, Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle } from '../ui'
import { PROJECT_STATUSES, PROJECT_STATUS_KEY } from './projectsUi'

export interface ProjectForm {
  name: string
  description: string
  icon: string
  color: string
  status: FinanceProjectStatus
  budget_total: number
  started_on: string | null
  target_end_on: string | null
  workspace_id: string | null
}

const PROJECT_COLORS = ['#f59e0b', '#6366f1', '#10b981', '#ef4444', '#0ea5e9', '#a855f7', '#64748b']

export function ProjectModal({ project, workspaceId, onClose, onSave, onDelete }: {
  project?: FinanceProject
  /** The user's family workspace, when they belong to one. Enables the share toggle. */
  workspaceId: string | null
  onClose: () => void
  onSave: (form: ProjectForm) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [icon, setIcon] = useState(project?.icon ?? '🏗️')
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0])
  const [status, setStatus] = useState<FinanceProjectStatus>(project?.status ?? 'active')
  // Money lives as a string in the form and only becomes cents on submit.
  const [budget, setBudget] = useState(project && project.budget_total > 0 ? String(fromCents(project.budget_total)) : '')
  const [startedOn, setStartedOn] = useState(project?.started_on ?? '')
  const [targetEnd, setTargetEnd] = useState(project?.target_end_on ?? '')
  // New obras default to shared when a family workspace exists — a silently
  // private obra was exactly the confusion this toggle replaces. Editing
  // reflects whatever the obra currently is.
  const [shared, setShared] = useState(project ? project.workspace_id != null : workspaceId != null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        icon,
        color,
        status,
        budget_total: toCents(budget),
        started_on: startedOn || null,
        target_end_on: targetEnd || null,
        // Without the toggle (no workspace, or a member editing someone
        // else's obra) the current sharing is preserved — sending a changed
        // workspace_id from a non-owner would be rejected by the ws guard.
        workspace_id: workspaceId ? (shared ? workspaceId : null) : (project?.workspace_id ?? null),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={project ? t('finance_proj_edit') : t('finance_proj_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_proj_name')}</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={t('finance_proj_name_placeholder')} autoFocus />
        </div>

        <EmojiInput value={icon} onChange={setIcon} label={t('finance_proj_icon')} />

        <div>
          <label style={labelStyle}>{t('finance_proj_color')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PROJECT_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)}
                style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: 'pointer', border: color === c ? '2px solid var(--color-text)' : '1px solid var(--color-border)' }} />
            ))}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_proj_description')}</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>{t('finance_proj_status')}</label>
          <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as FinanceProjectStatus)}>
            {PROJECT_STATUSES.map(s => <option key={s} value={s}>{t(PROJECT_STATUS_KEY[s])}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_proj_budget_total')}</label>
          <input style={inputStyle} type="number" step="0.01" min="0" value={budget}
            onChange={e => setBudget(e.target.value)} placeholder={t('finance_proj_budget_optional')} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_started_on')}</label>
            <input style={inputStyle} type="date" value={startedOn} onChange={e => setStartedOn(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_target_end')}</label>
            <input style={inputStyle} type="date" value={targetEnd} onChange={e => setTargetEnd(e.target.value)} />
          </div>
        </div>

        {workspaceId && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface)', cursor: 'pointer' }}>
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
            <Users size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_proj_share_family')}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                {shared ? t('finance_proj_share_family_on') : t('finance_proj_share_family_off')}
              </span>
            </span>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || !name.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || !name.trim()}>
            {t('finance_save')}
          </button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>

        {project && onDelete && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_proj_delete_warning')}</span>
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }} onClick={async () => { await onDelete(); onClose() }}>
                {t('finance_confirm_delete')}
              </button>
              <button style={ghostBtnStyle} onClick={() => setConfirming(false)}>{t('finance_cancel')}</button>
            </div>
          ) : (
            <button style={{ ...ghostBtnStyle, color: 'var(--color-error)', justifyContent: 'center' }} onClick={() => setConfirming(true)}>
              {t('finance_delete')}
            </button>
          )
        )}
      </div>
    </Modal>
  )
}

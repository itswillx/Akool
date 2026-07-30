import { User, Users } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { labelStyle, segBtnStyle, segTrackStyle } from './tokens'

// Segmented "Pessoal | <workspace>" picker that decides a row's scope: null
// means personal, the workspace id means shared with the coworkspace. Callers
// only render it when a workspace exists. `disabled` covers editing someone
// else's row — the trg_*_ws_guard triggers only let the original owner
// relocate workspace_id, so the UI mirrors that instead of failing on save.
export function ScopePicker({ value, onChange, workspaceId, workspaceName, disabled, label, compact }: {
  value: string | null
  onChange: (workspaceId: string | null) => void
  workspaceId: string
  workspaceName: string
  disabled?: boolean
  /** Field label; defaults to t('finance_scope_label'). Pass null to hide. */
  label?: string | null
  /** Tighter paddings for inline rows (quick add). */
  compact?: boolean
}) {
  const { t } = useLanguage()
  const shared = value != null
  const btn = (active: boolean) => ({
    ...segBtnStyle(active),
    ...(compact ? { padding: '5px 9px', fontSize: 12 } : {}),
    ...(disabled ? { cursor: 'default' } : {}),
  })
  return (
    <div style={disabled ? { opacity: 0.6 } : undefined}>
      {label !== null && <label style={labelStyle}>{label ?? t('finance_scope_label')}</label>}
      <div style={segTrackStyle}>
        <button type="button" style={btn(!shared)} onClick={disabled ? undefined : () => onChange(null)}>
          <User size={13} />{t('finance_scope_personal')}
        </button>
        <button type="button" style={btn(shared)} onClick={disabled ? undefined : () => onChange(workspaceId)} title={t('finance_scope_workspace')}>
          <Users size={13} />{workspaceName}
        </button>
      </div>
    </div>
  )
}

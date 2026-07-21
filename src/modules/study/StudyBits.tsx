import type { ReactNode } from 'react'
import { CalendarClock, X } from 'lucide-react'
import type { StudyTopic, StudyTopicStatus } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { isTopicOverdue } from '../../lib/studyProgress'
import { avatarBg, formatDateISO, initialsOf, STATUS_COLOR, STATUS_LABEL_KEY } from './studyUi'

// Shared presentational pieces of the study module. Pure helpers/constants
// live in studyUi.ts; this file only exports components.

export function Avatar({ title, size = 44 }: { title: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.23), flexShrink: 0,
      backgroundColor: avatarBg(title), border: '1px solid var(--color-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.34), fontWeight: 700, color: 'var(--color-text)',
    }}>
      {initialsOf(title)}
    </div>
  )
}

export function ProgressBar({ pct, height = 6 }: { pct: number; height?: number }) {
  return (
    <div style={{ height, borderRadius: 999, backgroundColor: 'var(--color-border)', overflow: 'hidden', width: '100%' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', borderRadius: 999, backgroundColor: '#6366f1', transition: 'width 0.25s' }} />
    </div>
  )
}

export function StatusPill({ status }: { status: StudyTopicStatus }) {
  const { t } = useLanguage()
  const color = STATUS_COLOR[status]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, color, backgroundColor: `${color}1c`, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />
      {t(STATUS_LABEL_KEY[status])}
    </span>
  )
}

export function TargetChip({ topic }: { topic: Pick<StudyTopic, 'target_date' | 'status'> }) {
  const { t, lang } = useLanguage()
  if (!topic.target_date) return null
  const overdue = isTopicOverdue(topic)
  const color = overdue ? '#ef4444' : 'var(--color-text-muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, color, whiteSpace: 'nowrap', flexShrink: 0,
      backgroundColor: overdue ? '#ef44441c' : 'var(--color-hover)',
    }}>
      <CalendarClock size={11} />
      {formatDateISO(topic.target_date, lang)}
      {overdue && <span>· {t('study_target_overdue')}</span>}
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
      color: 'var(--color-text-muted)', marginBottom: 8,
    }}>
      {children}
    </div>
  )
}

// Deliberately does NOT close on backdrop click or Escape: these modals hold
// form state and pasted markdown, so only the explicit X (or Cancelar in the
// footer) dismisses them.
export function ModalShell({ title, onClose, children, isMobile }: {
  title: string
  onClose: () => void
  children: ReactNode
  isMobile?: boolean
}) {
  if (isMobile) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <div
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '16px 20px 24px', maxHeight: '95vh', overflowY: 'auto' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button onClick={onClose} type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 }}
    >
      <div
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width: 680, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

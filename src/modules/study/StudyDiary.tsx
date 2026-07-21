import { useState } from 'react'
import { NotebookPen, Trash2 } from 'lucide-react'
import type { StudyLog } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { SectionLabel } from './StudyBits'
import { formatTimestamp } from './studyUi'

// Per-topic study diary: quick composer (Ctrl+Enter logs) + reverse
// chronological entries. Deletion is confirmed by the caller (requestDelete).

interface StudyDiaryProps {
  logs: StudyLog[]
  onAdd: (content: string) => void
  onRequestDeleteLog: (log: StudyLog) => void
}

export default function StudyDiary({ logs, onAdd, onRequestDeleteLog }: StudyDiaryProps) {
  const { t, lang } = useLanguage()
  const [draft, setDraft] = useState('')

  const submit = () => {
    const content = draft.trim()
    if (!content) return
    setDraft('')
    onAdd(content)
  }

  return (
    <div>
      <SectionLabel>{t('study_diary')}</SectionLabel>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 12,
        border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', marginBottom: 12,
      }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }}
          placeholder={t('study_diary_placeholder')}
          rows={2}
          style={{ resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', lineHeight: 1.45 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={submit}
            disabled={!draft.trim()}
            type="button"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 7,
              border: 'none', backgroundColor: '#6366f1', color: '#fff', fontSize: 12.5, fontWeight: 600,
              cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.5,
            }}
          >
            <NotebookPen size={13} />
            {t('study_diary_add')}
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('study_diary_empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.map(log => (
            <div
              key={log.id}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', whiteSpace: 'pre-wrap', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{log.content}</p>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{formatTimestamp(log.created_at, lang)}</span>
              </div>
              <button
                onClick={() => onRequestDeleteLog(log)}
                title={t('study_delete_log_title')}
                type="button"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

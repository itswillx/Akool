import { useMemo } from 'react'
import { History, Trash2 } from 'lucide-react'
import type { StudyLog, StudyTopic } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { localDateISO } from '../../lib/studyProgress'
import { SectionLabel } from './StudyBits'
import { formatDateISO } from './studyUi'

// "Histórico": every diary entry across all topics, grouped by local day,
// newest first. New entries are logged from the topic detail view.

interface StudyHistoryProps {
  topics: StudyTopic[]
  logsByTopic: Record<string, StudyLog[]>
  onOpenTopic: (topicId: string) => void
  requestDelete: (title: string, message: string, onConfirm: () => void) => void
  deleteLog: (logId: string) => void
  isMobile?: boolean
}

export default function StudyHistory({ topics, logsByTopic, onOpenTopic, requestDelete, deleteLog, isMobile = false }: StudyHistoryProps) {
  const { t, lang } = useLanguage()

  const groups = useMemo(() => {
    const titleById = new Map(topics.map(topic => [topic.id, topic.title]))
    const all = Object.values(logsByTopic)
      .flat()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(log => ({ ...log, topicTitle: titleById.get(log.topic_id) ?? '' }))

    const byDay = new Map<string, typeof all>()
    for (const log of all) {
      const day = localDateISO(new Date(log.created_at))
      const list = byDay.get(day)
      if (list) list.push(log)
      else byDay.set(day, [log])
    }
    return [...byDay.entries()]
  }, [logsByTopic, topics])

  return (
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <History size={18} style={{ color: 'var(--color-text-muted)' }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('study_nav_history')}</h2>
      </div>

      {groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_diary_empty')}</p>
      ) : (
        groups.map(([day, logs]) => (
          <div key={day} style={{ marginBottom: 18 }}>
            <SectionLabel>{formatDateISO(day, lang)}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {logs.map(log => (
                <div
                  key={log.id}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      {log.topicTitle && (
                        <button
                          onClick={() => onOpenTopic(log.topic_id)}
                          type="button"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 11.5, fontWeight: 700, color: '#6366f1' }}
                        >
                          {log.topicTitle}
                        </button>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {new Date(log.created_at).toLocaleTimeString(lang === 'en' ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', whiteSpace: 'pre-wrap', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{log.content}</p>
                  </div>
                  <button
                    onClick={() => requestDelete(
                      t('study_delete_log_title'),
                      t('study_delete_log_message'),
                      () => deleteLog(log.id),
                    )}
                    title={t('study_delete_log_title')}
                    type="button"
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { CalendarClock, Play } from 'lucide-react'
import type { StudyCard, StudyTopic } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { isTopicOverdue, topicProgress } from '../../lib/studyProgress'
import { Avatar, ProgressBar, SectionLabel, StatusPill, TargetChip } from './StudyBits'

// "Planejamento": the queue of topics waiting to start (status planned, with
// a one-click start) and every topic with a target date, overdue ones first.

interface StudyPlanningProps {
  topics: StudyTopic[]
  cardsByTopic: Record<string, StudyCard[]>
  onOpen: (topicId: string) => void
  onStart: (topicId: string) => void
  isMobile?: boolean
}

export default function StudyPlanning({ topics, cardsByTopic, onOpen, onStart, isMobile = false }: StudyPlanningProps) {
  const { t } = useLanguage()

  const queue = useMemo(
    () => topics.filter(topic => topic.status === 'planned').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [topics],
  )

  const targets = useMemo(
    () => topics
      .filter(topic => topic.target_date)
      .sort((a, b) => {
        const aOver = isTopicOverdue(a) ? 0 : 1
        const bOver = isTopicOverdue(b) ? 0 : 1
        return aOver - bOver || (a.target_date ?? '').localeCompare(b.target_date ?? '')
      }),
    [topics],
  )

  return (
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarClock size={18} style={{ color: 'var(--color-text-muted)' }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('study_nav_planning')}</h2>
      </div>

      <div>
        <SectionLabel>{t('study_planning_queue')}</SectionLabel>
        {queue.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_planning_queue_empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {queue.map(topic => {
              const progress = topicProgress(cardsByTopic[topic.id] ?? [])
              return (
                <div
                  key={topic.id}
                  onClick={() => onOpen(topic.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer' }}
                >
                  <Avatar title={topic.title} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {topic.area.trim() && (
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{topic.area.trim()}</span>
                      )}
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                        {t('study_progress_points', { done: progress.done, total: progress.total })}
                      </span>
                      <TargetChip topic={topic} />
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onStart(topic.id) }}
                    type="button"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                  >
                    <Play size={12} />
                    {t('study_planning_start')}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <SectionLabel>{t('study_planning_targets')}</SectionLabel>
        {targets.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_planning_targets_empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {targets.map(topic => {
              const overdue = isTopicOverdue(topic)
              const progress = topicProgress(cardsByTopic[topic.id] ?? [])
              return (
                <div
                  key={topic.id}
                  onClick={() => onOpen(topic.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12,
                    border: overdue ? '1px solid #ef444466' : '1px solid var(--color-border)',
                    backgroundColor: overdue ? '#ef444410' : 'var(--color-surface)', cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic.title}</span>
                      <StatusPill status={topic.status} />
                      <TargetChip topic={topic} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                      <div style={{ flex: 1, maxWidth: 260 }}><ProgressBar pct={progress.pct} height={5} /></div>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{progress.pct}%</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

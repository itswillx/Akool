import { useMemo } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, GraduationCap, Target } from 'lucide-react'
import type { StudyCard, StudyLog, StudyTopic } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { countByStatus, isTopicOverdue, topicProgress } from '../../lib/studyProgress'
import { Avatar, ProgressBar, SectionLabel, TargetChip } from './StudyBits'
import { formatTimestamp } from './studyUi'

// "Visão geral": stat cards, the studying queue ("continue"), upcoming
// targets and the latest diary entries — everything computed client-side
// from the already-loaded topics/cards/logs.

interface StudyOverviewProps {
  topics: StudyTopic[]
  cardsByTopic: Record<string, StudyCard[]>
  logsByTopic: Record<string, StudyLog[]>
  loading: boolean
  onOpenTopic: (topicId: string) => void
  onGoTopics: () => void
  isMobile?: boolean
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: 14, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
        {icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--color-text)', lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{hint}</div>}
    </div>
  )
}

export default function StudyOverview({ topics, cardsByTopic, logsByTopic, loading, onOpenTopic, onGoTopics, isMobile = false }: StudyOverviewProps) {
  const { t, lang } = useLanguage()

  const counts = useMemo(() => countByStatus(topics), [topics])
  const globalProgress = useMemo(
    () => topicProgress(Object.values(cardsByTopic).flat()),
    [cardsByTopic],
  )

  const studying = useMemo(
    () => topics.filter(topic => topic.status === 'studying').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [topics],
  )

  const upcoming = useMemo(
    () => topics
      .filter(topic => topic.target_date && topic.status !== 'completed')
      .sort((a, b) => {
        const aOver = isTopicOverdue(a) ? 0 : 1
        const bOver = isTopicOverdue(b) ? 0 : 1
        return aOver - bOver || (a.target_date ?? '').localeCompare(b.target_date ?? '')
      })
      .slice(0, 5),
    [topics],
  )

  const recentLogs = useMemo(() => {
    const titleById = new Map(topics.map(topic => [topic.id, topic.title]))
    return Object.values(logsByTopic)
      .flat()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3)
      .map(log => ({ ...log, topicTitle: titleById.get(log.topic_id) ?? '' }))
  }, [logsByTopic, topics])

  if (loading) {
    return <p style={{ padding: 24, margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_loading')}</p>
  }

  return (
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
        <StatCard icon={<GraduationCap size={13} />} label={t('study_overview_total')} value={String(counts.planned + counts.studying + counts.paused + counts.completed)} />
        <StatCard icon={<BookOpen size={13} />} label={t('study_status_studying')} value={String(counts.studying)} />
        <StatCard icon={<CheckCircle2 size={13} />} label={t('study_status_completed')} value={String(counts.completed)} />
        <StatCard
          icon={<Target size={13} />}
          label={t('study_overview_points')}
          value={`${globalProgress.pct}%`}
          hint={t('study_progress_points', { done: globalProgress.done, total: globalProgress.total })}
        />
      </div>

      <div>
        <SectionLabel>{t('study_continue')}</SectionLabel>
        {studying.length === 0 ? (
          <button
            onClick={onGoTopics}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, padding: 0, textAlign: 'left' }}
          >
            {t('study_continue_empty')}
            <ArrowRight size={13} />
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {studying.map(topic => {
              const progress = topicProgress(cardsByTopic[topic.id] ?? [])
              return (
                <div
                  key={topic.id}
                  onClick={() => onOpenTopic(topic.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer' }}
                >
                  <Avatar title={topic.title} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
                      <div style={{ flex: 1, maxWidth: 260 }}><ProgressBar pct={progress.pct} height={5} /></div>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{progress.pct}%</span>
                    </div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#6366f1', flexShrink: 0 }}>
                    {t('study_open')}
                    <ArrowRight size={13} />
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 18 }}>
        <div>
          <SectionLabel>{t('study_upcoming_targets')}</SectionLabel>
          {upcoming.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_upcoming_empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcoming.map(topic => (
                <div
                  key={topic.id}
                  onClick={() => onOpenTopic(topic.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer' }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topic.title}</span>
                  <TargetChip topic={topic} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionLabel>{t('study_recent_logs')}</SectionLabel>
          {recentLogs.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_recent_logs_empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentLogs.map(log => (
                <div
                  key={log.id}
                  onClick={() => onOpenTopic(log.topic_id)}
                  style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {log.topicTitle && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.topicTitle}</span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{formatTimestamp(log.created_at, lang)}</span>
                  </div>
                  <p style={{
                    margin: 0, fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.45,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {log.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

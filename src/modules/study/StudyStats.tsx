import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import type { StudyCard, StudyLog, StudyTopic } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { countByStatus, logsPerDay, progressByArea, topicProgress } from '../../lib/studyProgress'
import { ProgressBar, SectionLabel } from './StudyBits'
import { STATUS_COLOR, STATUS_LABEL_KEY, STATUS_ORDER } from './studyUi'

// "Estatísticas": status counts, average progress, per-area breakdown and a
// simple 7-day diary activity strip — all pure client-side aggregations.

interface StudyStatsProps {
  topics: StudyTopic[]
  cardsByTopic: Record<string, StudyCard[]>
  logsByTopic: Record<string, StudyLog[]>
  isMobile?: boolean
}

export default function StudyStats({ topics, cardsByTopic, logsByTopic, isMobile = false }: StudyStatsProps) {
  const { t, lang } = useLanguage()

  const counts = useMemo(() => countByStatus(topics), [topics])
  const areas = useMemo(() => progressByArea(topics, cardsByTopic), [topics, cardsByTopic])

  const avgProgress = useMemo(() => {
    const withPoints = topics
      .map(topic => topicProgress(cardsByTopic[topic.id] ?? []))
      .filter(p => p.total > 0)
    if (withPoints.length === 0) return 0
    return Math.round(withPoints.reduce((sum, p) => sum + p.pct, 0) / withPoints.length)
  }, [topics, cardsByTopic])

  const activity = useMemo(
    () => logsPerDay(Object.values(logsByTopic).flat(), 7),
    [logsByTopic],
  )
  const activityTotal = activity.reduce((sum, day) => sum + day.count, 0)
  const activityMax = Math.max(1, ...activity.map(day => day.count))

  const weekday = (dateISO: string) => {
    const [y, m, d] = dateISO.split('-').map(Number)
    return new Date(y, m - 1, d)
      .toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', { weekday: 'short' })
      .slice(0, 3)
  }

  return (
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BarChart3 size={18} style={{ color: 'var(--color-text-muted)' }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('study_nav_stats')}</h2>
      </div>

      <div>
        <SectionLabel>{t('study_stats_by_status')}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
          {STATUS_ORDER.map(status => (
            <div key={status} style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: 13, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: STATUS_COLOR[status] }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: STATUS_COLOR[status] }} />
                {t(STATUS_LABEL_KEY[status])}
              </span>
              <span style={{ fontSize: 21, fontWeight: 800, color: 'var(--color-text)', lineHeight: 1 }}>{counts[status]}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{t('study_stats_avg_progress')}</SectionLabel>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--color-text)', lineHeight: 1, flexShrink: 0 }}>{avgProgress}%</span>
          <ProgressBar pct={avgProgress} height={8} />
        </div>
      </div>

      <div>
        <SectionLabel>{t('study_stats_by_area')}</SectionLabel>
        {areas.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_stats_by_area_empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {areas.map(row => (
              <div key={row.area || '(none)'} style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: '11px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.area || t('study_stats_no_area')}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {row.topics} · {t('study_progress_points', { done: row.done, total: row.total })} · {row.pct}%
                  </span>
                </div>
                <ProgressBar pct={row.pct} height={5} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionLabel>{t('study_stats_activity')}</SectionLabel>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 74 }}>
            {activity.map(day => (
              <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <div
                  title={`${day.date}: ${day.count}`}
                  style={{
                    width: '100%', maxWidth: 34, borderRadius: 5,
                    height: Math.max(4, Math.round((day.count / activityMax) * 46)),
                    backgroundColor: day.count > 0 ? '#6366f1' : 'var(--color-border)',
                  }}
                />
                <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{weekday(day.date)}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
            {t('study_stats_activity_hint', { count: activityTotal })}
          </p>
        </div>
      </div>
    </div>
  )
}

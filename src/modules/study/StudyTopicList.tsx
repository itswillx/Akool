import { useMemo, useState } from 'react'
import { ChevronRight, GraduationCap, Plus, Search } from 'lucide-react'
import type { StudyCard, StudyTopic, StudyTopicStatus } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { sortTopics, topicProgress } from '../../lib/studyProgress'
import { Avatar, ProgressBar, StatusPill, TargetChip } from './StudyBits'
import { STATUS_LABEL_KEY, STATUS_ORDER, useHover } from './studyUi'

// "Tópicos" view: search bar, status filter chips, a dashed create card and
// the topic rows (avatar + title + subtitle + progress), following the
// reference layout with the app's own theme colors.

interface StudyTopicListProps {
  topics: StudyTopic[]
  cardsByTopic: Record<string, StudyCard[]>
  loading: boolean
  onOpen: (topicId: string) => void
  onNew: () => void
  isMobile?: boolean
}

type Filter = 'all' | StudyTopicStatus

function TopicRow({ topic, cards, onOpen, isMobile }: {
  topic: StudyTopic
  cards: StudyCard[]
  onOpen: () => void
  isMobile: boolean
}) {
  const { t } = useLanguage()
  const [hov, hoverProps] = useHover()
  const progress = topicProgress(cards)
  const subtitle = [topic.area.trim(), topic.level.trim()].filter(Boolean).join(' • ')

  return (
    <div
      onClick={onOpen}
      {...hoverProps}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: isMobile ? '12px 14px' : '14px 16px',
        borderRadius: 12, border: '1px solid var(--color-border)', cursor: 'pointer', marginTop: 10,
        backgroundColor: hov ? 'var(--color-hover)' : 'var(--color-surface)', transition: 'background-color 0.12s',
      }}
    >
      <Avatar title={topic.title} size={isMobile ? 40 : 44} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
          }}>
            {topic.title}
          </span>
          <StatusPill status={topic.status} />
          <TargetChip topic={topic} />
        </div>
        {subtitle && (
          <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, maxWidth: 280 }}><ProgressBar pct={progress.pct} /></div>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            {t('study_progress_points', { done: progress.done, total: progress.total })} · {progress.pct}%
          </span>
        </div>
      </div>
      {!isMobile && <ChevronRight size={17} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
    </div>
  )
}

export default function StudyTopicList({ topics, cardsByTopic, loading, onOpen, onNew, isMobile = false }: StudyTopicListProps) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const counts = useMemo(() => {
    const byStatus: Record<Filter, number> = { all: topics.length, planned: 0, studying: 0, paused: 0, completed: 0 }
    for (const topic of topics) byStatus[topic.status]++
    return byStatus
  }, [topics])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortTopics(topics).filter(topic => {
      if (filter !== 'all' && topic.status !== filter) return false
      if (!q) return true
      return topic.title.toLowerCase().includes(q) || topic.area.toLowerCase().includes(q)
    })
  }, [topics, query, filter])

  const filterChip = (value: Filter, label: string) => {
    const active = filter === value
    return (
      <button
        key={value}
        onClick={() => setFilter(value)}
        type="button"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999,
          border: active ? 'none' : '1px solid var(--color-border)', cursor: 'pointer', flexShrink: 0,
          backgroundColor: active ? '#6366f1' : 'var(--color-surface)',
          color: active ? '#fff' : 'var(--color-text)', fontSize: 12, fontWeight: 600,
        }}
      >
        {label}
        <span style={{ opacity: 0.75, fontWeight: 500 }}>{counts[value]}</span>
      </button>
    )
  }

  return (
    <div style={{ padding: isMobile ? 16 : 24, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <GraduationCap size={18} style={{ color: 'var(--color-text-muted)' }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('study_title')}</h2>
      </div>

      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('study_search_placeholder')}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 36px', borderRadius: 10,
            border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)', fontSize: 13.5, outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {filterChip('all', t('study_filter_all'))}
        {STATUS_ORDER.map(status => filterChip(status, t(STATUS_LABEL_KEY[status])))}
      </div>

      <button
        onClick={onNew}
        type="button"
        style={{
          display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: 16, borderRadius: 12,
          border: '1.5px dashed var(--color-border)', background: 'transparent', cursor: 'pointer',
          textAlign: 'left', marginTop: 14, boxSizing: 'border-box',
        }}
      >
        <span style={{
          width: 44, height: 44, borderRadius: 10, backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#6366f1', flexShrink: 0,
        }}>
          <Plus size={20} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#6366f1' }}>{t('study_create_card_title')}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{t('study_create_card_hint')}</span>
        </span>
      </button>

      {loading ? (
        <p style={{ marginTop: 18, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_loading')}</p>
      ) : topics.length === 0 ? (
        <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          <GraduationCap size={38} strokeWidth={1.25} />
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{t('study_empty_title')}</p>
          <p style={{ margin: 0, fontSize: 13 }}>{t('study_empty_hint')}</p>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ marginTop: 18, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_empty_filtered')}</p>
      ) : (
        rows.map(topic => (
          <TopicRow
            key={topic.id}
            topic={topic}
            cards={cardsByTopic[topic.id] ?? []}
            onOpen={() => onOpen(topic.id)}
            isMobile={isMobile}
          />
        ))
      )}
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import { BarChart3, BookOpen, CalendarClock, History, LayoutDashboard, PlusCircle } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'

// Internal navigation of the study mini-app: grouped rail on desktop
// (INÍCIO / ESTUDOS / PLANEJAMENTO, like the reference layout), horizontal
// scrollable chips on mobile. Colors come from the app theme tokens only.

export type StudyViewName = 'overview' | 'topics' | 'history' | 'stats' | 'planning'

interface StudyNavProps {
  active: StudyViewName | null
  overdueCount: number
  onSelect: (view: StudyViewName) => void
  onNew: () => void
  isMobile?: boolean
}

const VIEW_ITEMS: { view: StudyViewName; labelKey: TranslationKey; icon: ReactNode }[] = [
  { view: 'overview', labelKey: 'study_nav_overview', icon: <LayoutDashboard size={15} /> },
  { view: 'topics', labelKey: 'study_nav_topics', icon: <BookOpen size={15} /> },
  { view: 'history', labelKey: 'study_nav_history', icon: <History size={15} /> },
  { view: 'stats', labelKey: 'study_nav_stats', icon: <BarChart3 size={15} /> },
  { view: 'planning', labelKey: 'study_nav_planning', icon: <CalendarClock size={15} /> },
]

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span style={{
      marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 999, backgroundColor: '#ef4444',
      color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', padding: '0 5px', flexShrink: 0,
    }}>
      {count}
    </span>
  )
}

function RailButton({ icon, label, active, onClick, badge }: {
  icon: ReactNode; label: string; active?: boolean; onClick: () => void; badge?: number
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      type="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px',
        borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
        backgroundColor: active ? 'var(--color-active)' : hov ? 'var(--color-hover)' : 'transparent',
        color: 'var(--color-text)', fontSize: 13.5, fontWeight: active ? 600 : 500,
      }}
    >
      <span style={{ display: 'flex', color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge != null && <Badge count={badge} />}
    </button>
  )
}

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
      color: 'var(--color-text-muted)', padding: '0 10px', marginBottom: 4,
    }}>
      {children}
    </div>
  )
}

export default function StudyNav({ active, overdueCount, onSelect, onNew, isMobile = false }: StudyNavProps) {
  const { t } = useLanguage()

  if (isMobile) {
    const chip = (key: string, label: string, opts: { active?: boolean; onClick: () => void; icon?: ReactNode; dot?: boolean }) => (
      <button
        key={key}
        onClick={opts.onClick}
        type="button"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
          border: opts.active ? 'none' : '1px solid var(--color-border)', cursor: 'pointer', flexShrink: 0,
          backgroundColor: opts.active ? '#6366f1' : 'var(--color-surface)',
          color: opts.active ? '#fff' : 'var(--color-text)', fontSize: 12.5, fontWeight: 600, position: 'relative',
        }}
      >
        {opts.icon}
        {label}
        {opts.dot && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0 }} />
        )}
      </button>
    )

    return (
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 12px', flexShrink: 0,
        borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)',
      }}>
        {chip('new', t('study_nav_new'), { onClick: onNew, icon: <PlusCircle size={13} /> })}
        {VIEW_ITEMS.map(item => chip(item.view, t(item.labelKey), {
          active: active === item.view,
          onClick: () => onSelect(item.view),
          dot: item.view === 'planning' && overdueCount > 0,
        }))}
      </div>
    )
  }

  return (
    <nav style={{
      width: 210, minWidth: 190, flexShrink: 0, height: '100%', overflowY: 'auto',
      borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)',
      padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box',
    }}>
      <div>
        <GroupTitle>{t('study_nav_group_home')}</GroupTitle>
        <RailButton icon={<LayoutDashboard size={15} />} label={t('study_nav_overview')} active={active === 'overview'} onClick={() => onSelect('overview')} />
        <RailButton icon={<PlusCircle size={15} />} label={t('study_nav_new')} onClick={onNew} />
      </div>
      <div>
        <GroupTitle>{t('study_nav_group_studies')}</GroupTitle>
        <RailButton icon={<BookOpen size={15} />} label={t('study_nav_topics')} active={active === 'topics'} onClick={() => onSelect('topics')} />
        <RailButton icon={<History size={15} />} label={t('study_nav_history')} active={active === 'history'} onClick={() => onSelect('history')} />
        <RailButton icon={<BarChart3 size={15} />} label={t('study_nav_stats')} active={active === 'stats'} onClick={() => onSelect('stats')} />
      </div>
      <div>
        <GroupTitle>{t('study_nav_group_planning')}</GroupTitle>
        <RailButton icon={<CalendarClock size={15} />} label={t('study_nav_planning')} active={active === 'planning'} onClick={() => onSelect('planning')} badge={overdueCount} />
      </div>
    </nav>
  )
}

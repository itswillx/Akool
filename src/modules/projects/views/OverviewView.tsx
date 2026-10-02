// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { AreaTrend, Donut, Legend, SegmentedBar, type ChartDatum } from '../../../components/Charts'
import { UserAvatar } from '../../../components/UserAvatar'
import { useLanguage } from '../../../i18n/LanguageContext'
import { countByAssignee, countByColumnId, countByPriority, createdPerWeek, dueBuckets, overviewSummary, PRIORITY_ORDER } from '../../../lib/projectStats'
import type { ProjectCard, ProjectColumn } from '../../../types'
import type { Member } from '../projectsShared'
import { PRIORITY_COLORS, todayStr } from '../projectsShared'

// ─── Overview ─────────────────────────────────────────────────────────────────

export function OverviewView({ columns, cards, members }: { columns: ProjectColumn[]; cards: ProjectCard[]; members: Member[] }) {
  const { t } = useLanguage()
  const today = todayStr()
  const s = overviewSummary(cards, today)

  const colCounts = countByColumnId(cards)
  const statusData: ChartDatum[] = columns.map(col => ({ label: col.name, value: colCounts[col.id] ?? 0, color: col.color }))
  const priCounts = countByPriority(cards)
  const priData: ChartDatum[] = PRIORITY_ORDER.map(p => ({ label: t(`projects_priority_${p}`), value: priCounts[p], color: PRIORITY_COLORS[p] }))

  const assignees = countByAssignee(cards).slice(0, 6)
  const maxAssignee = Math.max(1, ...assignees.map(a => a.count))

  const due = dueBuckets(cards, today)
  const dueSegs: ChartDatum[] = [
    { label: t('projects_overview_due_overdue'), value: due.overdue, color: '#ef4444' },
    { label: t('projects_overview_due_today'), value: due.today, color: '#f59e0b' },
    { label: t('projects_overview_due_week'), value: due.week, color: '#3b82f6' },
    { label: t('projects_overview_due_later'), value: due.later, color: 'var(--color-accent)' },
    { label: t('projects_overview_due_none'), value: due.none, color: 'var(--color-text-muted)' },
  ]

  const weekLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
  const trend = createdPerWeek(cards, 8, today).map(b => ({ label: weekLabel(b.weekStart), value: b.count }))

  const stat = (label: string, value: number | string, color: string, sub?: string) => (
    <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color }}>{value}</span>
        {sub && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)' }}>{sub}</span>}
      </div>
    </div>
  )
  const cardBox = (title: string, children: React.ReactNode, full?: boolean): React.ReactNode => (
    <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px', ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  )

  if (cards.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontSize: 14, color: 'var(--color-text-muted)' }}>{t('projects_overview_empty')}</div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {stat(t('projects_overview_total_cards'), s.total, 'var(--color-text)')}
        {stat(t('projects_overview_open'), s.open, 'var(--color-text)')}
        {stat(t('projects_overview_completed'), s.completed, '#22c55e', `${s.completionPct}%`)}
        {stat(t('projects_overview_overdue'), s.overdue, '#ef4444')}
        {stat(t('projects_overview_due_week'), s.dueThisWeekOpen, '#f59e0b')}
        {stat(t('projects_overview_unassigned'), s.unassigned, 'var(--color-accent)')}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {cardBox(t('projects_overview_by_column'), (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut data={statusData} centerValue={s.total} centerLabel={t('projects_overview_total_cards')} />
            <Legend items={statusData} />
          </div>
        ))}
        {cardBox(t('projects_overview_by_priority'), (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut data={priData} centerValue={s.total} centerLabel={t('projects_overview_total_cards')} />
            <Legend items={priData} />
          </div>
        ))}
        {cardBox(t('projects_overview_by_assignee'), (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {assignees.map(a => {
              const m = a.id ? members.find(mm => mm.id === a.id) : null
              const name = m ? (m.display_name || m.email) : t('projects_overview_unassigned')
              const w = (a.count / maxAssignee) * 100
              return (
                <div key={a.id ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m
                    ? <UserAvatar name={name} seed={m.email} emoji={m.avatar_emoji} color={m.avatar_color} url={m.avatar_url} size={22} />
                    : <span style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>–</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', flexShrink: 0 }}>{a.count}</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 999, backgroundColor: 'var(--color-hover)' }}><div style={{ width: `${w}%`, height: '100%', backgroundColor: 'var(--color-accent)', borderRadius: 999 }} /></div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {cardBox(t('projects_overview_by_due'), (
          <>
            <SegmentedBar segments={dueSegs} />
            <div style={{ marginTop: 14 }}><Legend items={dueSegs} /></div>
          </>
        ))}
        {cardBox(t('projects_overview_created_trend'), (
          <AreaTrend points={trend} color="var(--color-accent)" />
        ), true)}
      </div>
    </div>
  )
}

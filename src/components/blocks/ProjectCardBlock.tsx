import { createReactBlockSpec } from '@blocknote/react'
import { Calendar, CheckSquare, ExternalLink } from 'lucide-react'
import type { ProjectCardPriority } from '../../types'
import type { ProjectCardSnapshot } from '../../lib/projectImport'
import { useLanguage } from '../../i18n/LanguageContext'
import { usePages } from '../../contexts/PagesContext'
import { MarkdownText } from '../MarkdownText'

const PRIORITY_COLORS: Record<ProjectCardPriority, string> = {
  low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
}
const ACTIVE_BOARD_KEY = 'projects_active_board'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A note block that embeds a snapshot of a project (Kanban) card, staying linked
// to its source via `cardId` / `boardId`. Follows the DiagramBlock pattern: a
// non-editable custom block whose data lives entirely in string props.
export const ProjectCardBlock = createReactBlockSpec(
  {
    type: 'projectCard' as const,
    propSchema: {
      cardId: { default: '' },
      boardId: { default: '' },
      snapshot: { default: '{}' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const { t } = useLanguage()
      const { setActivePanel } = usePages()

      let snap: ProjectCardSnapshot | null = null
      try { snap = JSON.parse(block.props.snapshot || '{}') as ProjectCardSnapshot } catch { snap = null }
      const data = snap ?? ({} as Partial<ProjectCardSnapshot>)

      const priority = (data.priority ?? 'medium') as ProjectCardPriority
      const pColor = PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.medium
      const priorityLabel = t(`projects_priority_${priority}` as Parameters<typeof t>[0])

      const due = data.dueDate ? new Date(data.dueDate + 'T00:00:00') : null
      const overdue = !!due && !data.completed && due.getTime() < new Date(todayStr() + 'T00:00:00').getTime()
      const isToday = !!due && data.dueDate === todayStr()
      const dueColor = overdue ? '#ef4444' : isToday ? '#f59e0b' : 'var(--color-text-muted)'

      const checklist = data.checklist ?? []
      const checklistDone = checklist.filter(i => i.completed).length
      const checklistTotal = checklist.length

      const boardColor = data.boardColor || '#6366f1'

      const openInProject = () => {
        if (block.props.boardId) {
          try { localStorage.setItem(ACTIVE_BOARD_KEY, block.props.boardId) } catch { /* ignore */ }
        }
        setActivePanel('projects')
      }

      return (
        <div
          contentEditable={false}
          style={{
            margin: '12px 0',
            border: '1px solid var(--color-border)',
            borderLeft: `3px solid ${boardColor}`,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          {/* Header: board context + open button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: 13 }}>{data.boardIcon || '📋'}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {data.boardName || t('import_cards_modal_title')}
              {data.columnName ? <span style={{ color: 'var(--color-text-subtle)', fontWeight: 500 }}>{` · ${data.columnName}`}</span> : null}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={openInProject}
              title={t('project_card_block_open')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}
            >
              <ExternalLink size={12} />
              {t('project_card_block_open')}
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.35, textDecoration: data.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>
              {data.title || t('projects_new_card')}
            </span>

            {data.description ? (
              <MarkdownText text={data.description} style={{ fontSize: 12.5, color: 'var(--color-text-subtle)', lineHeight: 1.5 }} />
            ) : null}

            {(data.labels?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {data.labels!.map((l, i) => (
                  <span key={i} style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)', padding: '1px 6px', borderRadius: 4 }}>{l}</span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: pColor, backgroundColor: `${pColor}1f`, padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {priorityLabel}
              </span>
              {due && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: dueColor }}>
                  <Calendar size={11} />
                  {overdue ? t('projects_due_overdue') : isToday ? t('projects_due_today') : due.toLocaleDateString()}
                </span>
              )}
              {checklistTotal > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: checklistDone === checklistTotal ? '#22c55e' : 'var(--color-text-muted)' }}>
                  <CheckSquare size={11} />
                  {t('projects_checklist_progress').replace('{done}', String(checklistDone)).replace('{total}', String(checklistTotal))}
                </span>
              )}
            </div>
          </div>
        </div>
      )
    },
  }
)

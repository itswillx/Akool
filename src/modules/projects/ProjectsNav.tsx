import { useState, type ReactNode } from 'react'
import {
  BarChart3, GanttChartSquare, LayoutGrid, List as ListIcon, Pencil, Plus,
  Share2, Smartphone, Trash2, Upload,
} from 'lucide-react'
import type { ProjectBoard } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'

// Navegação interna do mini-app de projetos, no padrão do modules/study/StudyNav:
// faixa agrupada no desktop (QUADROS / VISUALIZAÇÃO / QUADRO), chips horizontais
// no mobile. Diferente do study, há dois eixos — qual quadro e qual visualização —
// então no mobile só as visualizações viram chips; o seletor de quadros continua
// dropdown no cabeçalho do painel. RailButton/GroupTitle são cópias locais dos
// primitivos do StudyNav de propósito: módulos não importam uns dos outros.

export type ViewMode = 'kanban' | 'compact' | 'list' | 'overview' | 'timeline'

// VALID_VIEWS (validação do valor persistido) mora no ProjectsPanel: exportar
// uma const daqui quebraria o fast refresh (react-refresh/only-export-components).
const VIEW_ITEMS: { view: ViewMode; labelKey: TranslationKey; icon: ReactNode }[] = [
  { view: 'kanban', labelKey: 'projects_view_kanban', icon: <LayoutGrid size={15} /> },
  { view: 'timeline', labelKey: 'projects_view_timeline', icon: <GanttChartSquare size={15} /> },
  { view: 'list', labelKey: 'projects_view_list', icon: <ListIcon size={15} /> },
  { view: 'overview', labelKey: 'projects_view_overview', icon: <BarChart3 size={15} /> },
  { view: 'compact', labelKey: 'projects_view_compact', icon: <Smartphone size={15} /> },
]

interface ProjectsNavProps {
  boards: ProjectBoard[]
  activeBoardId: string | null
  view: ViewMode
  isOwner: boolean
  isMobile?: boolean
  onSelectBoard: (id: string) => void
  onNewBoard: () => void
  onSelectView: (v: ViewMode) => void
  onImport: () => void
  onShare: () => void
  onEditBoard: () => void
  onDeleteBoard: () => void
}

function RailButton({ icon, label, active, danger, trailing, onClick }: {
  icon: ReactNode; label: string; active?: boolean; danger?: boolean; trailing?: ReactNode; onClick: () => void
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
        color: danger ? '#ef4444' : 'var(--color-text)', fontSize: 13.5, fontWeight: active ? 600 : 500,
      }}
    >
      <span style={{ display: 'flex', color: danger ? '#ef4444' : active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {trailing && <span style={{ marginLeft: 'auto', display: 'flex', color: 'var(--color-text-muted)', flexShrink: 0 }}>{trailing}</span>}
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

export default function ProjectsNav({
  boards, activeBoardId, view, isOwner, isMobile = false,
  onSelectBoard, onNewBoard, onSelectView, onImport, onShare, onEditBoard, onDeleteBoard,
}: ProjectsNavProps) {
  const { t } = useLanguage()
  const hasBoard = activeBoardId !== null && boards.some(b => b.id === activeBoardId)

  if (isMobile) {
    // Só o eixo de visualização vira chips; sem quadro ativo não há o que alternar.
    if (!hasBoard) return null
    return (
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 12px', flexShrink: 0,
        borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)',
      }}>
        {VIEW_ITEMS.map(item => (
          <button
            key={item.view}
            onClick={() => onSelectView(item.view)}
            type="button"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999,
              border: view === item.view ? 'none' : '1px solid var(--color-border)', cursor: 'pointer', flexShrink: 0,
              backgroundColor: view === item.view ? '#6366f1' : 'var(--color-surface)',
              color: view === item.view ? '#fff' : 'var(--color-text)', fontSize: 12.5, fontWeight: 600,
            }}
          >
            {item.icon}
            {t(item.labelKey)}
          </button>
        ))}
      </div>
    )
  }

  return (
    <nav style={{
      width: 200, minWidth: 180, flexShrink: 0, height: '100%', overflowY: 'auto',
      borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)',
      padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box',
    }}>
      <div>
        <GroupTitle>{t('projects_nav_group_boards')}</GroupTitle>
        {boards.map(b => (
          <RailButton
            key={b.id}
            icon={<span style={{ fontSize: 14, lineHeight: 1 }}>{b.icon}</span>}
            label={b.name}
            active={b.id === activeBoardId}
            trailing={b.is_shared ? <Share2 size={11} /> : undefined}
            onClick={() => onSelectBoard(b.id)}
          />
        ))}
        <RailButton icon={<Plus size={15} />} label={t('projects_new_board')} onClick={onNewBoard} />
      </div>
      {hasBoard && (
        <div>
          <GroupTitle>{t('projects_nav_group_views')}</GroupTitle>
          {VIEW_ITEMS.map(item => (
            <RailButton
              key={item.view}
              icon={item.icon}
              label={t(item.labelKey)}
              active={view === item.view}
              onClick={() => onSelectView(item.view)}
            />
          ))}
        </div>
      )}
      {hasBoard && isOwner && (
        <div>
          <GroupTitle>{t('projects_nav_group_board')}</GroupTitle>
          <RailButton icon={<Upload size={15} />} label={t('projects_import')} onClick={onImport} />
          <RailButton icon={<Share2 size={15} />} label={t('projects_share')} onClick={onShare} />
          <RailButton icon={<Pencil size={15} />} label={t('projects_edit')} onClick={onEditBoard} />
          <RailButton icon={<Trash2 size={15} />} label={t('projects_delete')} danger onClick={onDeleteBoard} />
        </div>
      )}
    </nav>
  )
}

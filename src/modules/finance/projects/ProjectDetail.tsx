import { useEffect, useState } from 'react'
import { ArrowLeft, Pencil, Users } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { FinanceAccount, FinanceProject, FinanceProjectItem } from '../../../types'
import { badgeStyle, projectStatusColor, PROJECT_STATUS_KEY } from './projectsUi'
import { ghostBtnStyle, segBtnStyle, segTrackStyle } from '../ui'
import { ProjectOverview } from './ProjectOverview'
import { ItemsView } from './ItemsView'
import { ExpensesView } from './ExpensesView'
import { StagesView } from './StagesView'
import { SuppliersView } from './SuppliersView'
import type { FinanceProjectsStore } from './useFinanceProjects'

type Section = 'overview' | 'items' | 'expenses' | 'stages' | 'suppliers'

const SECTIONS: { id: Section; key: Parameters<ReturnType<typeof useLanguage>['t']>[0] }[] = [
  { id: 'overview', key: 'finance_proj_nav_overview' },
  { id: 'items', key: 'finance_proj_nav_items' },
  { id: 'expenses', key: 'finance_proj_nav_expenses' },
  { id: 'stages', key: 'finance_proj_nav_stages' },
  { id: 'suppliers', key: 'finance_proj_nav_suppliers' },
]

// Persisted alongside the open obra: coming back to the tab should land on the
// same section, not reset to Resumo.
const SECTION_KEY = 'finance_project_section'

function storedSection(): Section {
  const saved = localStorage.getItem(SECTION_KEY)
  return SECTIONS.some(s => s.id === saved) ? saved as Section : 'overview'
}

export function ProjectDetail({ project, store, accounts, onBack, onEdit, onBuyItem }: {
  project: FinanceProject
  store: FinanceProjectsStore
  accounts: FinanceAccount[]
  onBack: () => void
  onEdit: () => void
  onBuyItem: (item: FinanceProjectItem) => void
}) {
  const { t } = useLanguage()
  const [section, setSection] = useState<Section>(storedSection)

  useEffect(() => { localStorage.setItem(SECTION_KEY, section) }, [section])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <button onClick={onBack} title={t('finance_proj_back')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${project.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
          {project.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </div>
          <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <span style={badgeStyle(projectStatusColor(project.status))}>{t(PROJECT_STATUS_KEY[project.status])}</span>
            {project.workspace_id && (
              <span style={badgeStyle('var(--color-text-muted)')} title={t('finance_proj_shared_badge')}>
                <Users size={10} />{t('finance_proj_shared_badge')}
              </span>
            )}
          </span>
        </div>
        <button style={ghostBtnStyle} onClick={onEdit}>
          <Pencil size={14} />{t('finance_edit')}
        </button>
      </div>

      <div style={{ ...segTrackStyle, alignSelf: 'flex-start', flexWrap: 'wrap', maxWidth: '100%' }}>
        {SECTIONS.map(s => (
          <button key={s.id} style={segBtnStyle(section === s.id)} onClick={() => setSection(s.id)}>{t(s.key)}</button>
        ))}
      </div>

      {section === 'overview' && <ProjectOverview project={project} store={store} />}
      {section === 'items' && <ItemsView project={project} store={store} onBuy={onBuyItem} />}
      {section === 'expenses' && <ExpensesView project={project} store={store} accounts={accounts} />}
      {section === 'stages' && <StagesView project={project} store={store} />}
      {section === 'suppliers' && <SuppliersView store={store} />}
    </div>
  )
}

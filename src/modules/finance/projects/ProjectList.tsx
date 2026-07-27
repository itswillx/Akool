import { HardHat, Plus, Users } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { projectTotals } from '../../../lib/financeProjectCalc'
import type { FinanceProject } from '../../../types'
import { cardSurfaceStyle, primaryBtnStyle, tabularNums } from '../ui'
import type { FinanceProjectsStore } from './useFinanceProjects'
import { PROJECT_STATUS_KEY, badgeStyle, budgetBarColor, emptyStateStyle, projectStatusColor } from './projectsUi'

export function ProjectList({ store, onOpen, onNew }: {
  store: FinanceProjectsStore
  onOpen: (project: FinanceProject) => void
  onNew: () => void
}) {
  const { t } = useLanguage()
  const { projects, stages, items, expenses, quotes } = store

  if (projects.length === 0) {
    return (
      <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>
        <HardHat size={30} style={{ opacity: 0.4, marginBottom: 10 }} />
        <div style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{t('finance_proj_empty_title')}</div>
        <div style={{ marginBottom: 16 }}>{t('finance_proj_empty_desc')}</div>
        <button style={{ ...primaryBtnStyle, margin: '0 auto' }} onClick={onNew}>
          <Plus size={15} />{t('finance_proj_new')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {projects.map(project => {
        const totals = projectTotals(project, stages, items, expenses, quotes)
        return (
          <button key={project.id} onClick={() => onOpen(project)}
            style={{ ...cardSurfaceStyle, padding: 16, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: `${project.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0 }}>
                {project.icon}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{formatBRL(totals.spent)}</span>
                {totals.limit > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', ...tabularNums }}>
                    {t('finance_proj_of_budget', { total: formatBRL(totals.limit) })}
                  </span>
                )}
              </div>
              {totals.limit > 0 && (
                <div style={{ height: 6, borderRadius: 3, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
                  <div style={{ width: `${totals.pct}%`, height: '100%', background: budgetBarColor(totals.pct, totals.over), transition: 'width 0.2s' }} />
                </div>
              )}
            </div>

            {totals.planned > 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', ...tabularNums }}>
                {t('finance_proj_still_to_buy', { value: formatBRL(totals.planned) })}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

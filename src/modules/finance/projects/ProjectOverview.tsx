import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { Donut, Legend, type ChartDatum } from '../../../components/Charts'
import { projectTotals, spentBySupplier, stageTotals } from '../../../lib/financeProjectCalc'
import type { FinanceProject } from '../../../types'
import { cardSurfaceStyle, sectionCaptionStyle, tabularNums } from '../ui'
import { budgetBarColor, emptyStateStyle } from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ ...cardSurfaceStyle, padding: '13px 15px', flex: '1 1 150px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: tone ?? 'var(--color-text)', ...tabularNums }}>{value}</div>
    </div>
  )
}

export function ProjectOverview({ project, store }: { project: FinanceProject; store: FinanceProjectsStore }) {
  const { t } = useLanguage()
  const stages = store.stages.filter(s => s.project_id === project.id)
  const items = store.items.filter(i => i.project_id === project.id)
  const expenses = store.expenses.filter(e => e.project_id === project.id)
  const totals = projectTotals(project, store.stages, store.items, store.expenses, store.quotes)

  const byStage: ChartDatum[] = stages
    .map(stage => ({
      label: stage.name,
      value: stageTotals(stage, items, expenses, store.quotes).spent,
      color: stage.color,
    }))
    .filter(d => d.value > 0)

  const stageless = expenses.filter(e => e.stage_id === null).reduce((sum, e) => sum + e.amount, 0)
  if (stageless > 0) byStage.push({ label: t('finance_proj_no_stage'), value: stageless, color: '#94a3b8' })

  const suppliers = spentBySupplier(expenses, store.suppliers, t('finance_proj_no_supplier')).slice(0, 5)
  const topTotal = suppliers[0]?.total ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label={t('finance_proj_spent')} value={formatBRL(totals.spent)} />
        <Stat label={t('finance_proj_still_to_buy_label')} value={formatBRL(totals.planned)} />
        <Stat label={t('finance_proj_committed')} value={formatBRL(totals.committed)} />
        {totals.limit > 0 && (
          <Stat
            label={totals.remaining >= 0 ? t('finance_proj_remaining') : t('finance_proj_over')}
            value={formatBRL(Math.abs(totals.remaining))}
            tone={totals.over ? 'var(--color-error)' : 'var(--color-done)'}
          />
        )}
      </div>

      {totals.limit > 0 && (
        <div style={{ ...cardSurfaceStyle, padding: 15 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
            <p style={sectionCaptionStyle}>{t('finance_proj_budget_usage')}</p>
            <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', ...tabularNums }}>
              {t('finance_proj_spent_of', { spent: formatBRL(totals.spent), limit: formatBRL(totals.limit) })}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
            <div style={{ width: `${totals.pct}%`, height: '100%', background: budgetBarColor(totals.pct, totals.over) }} />
          </div>
          {totals.projectedOverrun > 0 && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-error)', ...tabularNums }}>
              {t('finance_proj_projected_overrun', { value: formatBRL(totals.projectedOverrun) })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...cardSurfaceStyle, padding: 15, flex: '1 1 280px', minWidth: 0 }}>
          <p style={{ ...sectionCaptionStyle, marginBottom: 12 }}>{t('finance_proj_by_stage')}</p>
          {byStage.length === 0 ? (
            <div style={emptyStateStyle}>{t('finance_proj_no_data')}</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <Donut data={byStage} size={128} centerValue="" centerLabel={t('finance_proj_spent')} />
              <Legend items={byStage} formatValue={formatBRL} />
            </div>
          )}
        </div>

        <div style={{ ...cardSurfaceStyle, padding: 15, flex: '1 1 280px', minWidth: 0 }}>
          <p style={{ ...sectionCaptionStyle, marginBottom: 12 }}>{t('finance_proj_top_suppliers')}</p>
          {suppliers.length === 0 ? (
            <div style={emptyStateStyle}>{t('finance_proj_no_data')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {suppliers.map(s => (
                <div key={s.supplier_id ?? 'none'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ color: 'var(--color-text-muted)', ...tabularNums, flexShrink: 0, marginLeft: 8 }}>{formatBRL(s.total)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
                    <div style={{ width: topTotal > 0 ? `${(s.total / topTotal) * 100}%` : '0%', height: '100%', background: 'var(--color-btn-primary)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

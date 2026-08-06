import { useMemo, useState } from 'react'
import { Info, PiggyBank, TrendingUp, Wallet } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { monthsOfYear } from '../../../lib/financeCalc'
import {
  appliedByGroup, investmentMonthlySeries, investmentTotals, totalApplied,
} from '../../../lib/financeInvestmentCalc'
import { Donut, DualAreaTrend, Legend, type ChartDatum } from '../../../components/Charts'
import type {
  FinanceInvestment, FinanceInvestmentAssetClass, FinanceInvestmentMovement,
} from '../../../types'
import {
  cardSurfaceStyle, sectionCaptionStyle, segBtnStyle, segTrackStyle, tabularNums,
  FIN_ACCENT, FIN_NEG, FIN_POS, FIN_WARN,
} from '../ui'
import {
  ASSET_CLASS_COLOR, ASSET_CLASS_KEY, SLICE_PALETTE, emptyStateStyle,
} from './investmentsUi'

// The differentiated view: where the money is, not just what was spent.
//
// The headline number is COST, not market value. A checking-account statement
// only sees money that crossed the account, so a product capitalizing
// internally is invisible to the import — the card says so out loud instead of
// letting the user read it as a portfolio valuation.

const fmt = formatBRL

export function InvestmentsOverview({ investments, movements, month }: {
  investments: FinanceInvestment[]
  movements: FinanceInvestmentMovement[]
  month: string
}) {
  const { t, lang } = useLanguage()
  const locale = lang === 'en' ? 'en-US' : 'pt-BR'
  const [groupBy, setGroupBy] = useState<'institution' | 'asset_class'>('institution')

  const active = useMemo(() => investments.filter(i => !i.archived), [investments])
  const applied = useMemo(() => totalApplied(investments, movements), [investments, movements])

  // All-time split, so the hero card can show what went in, what came back and
  // what the products paid out.
  const lifetime = useMemo(() => {
    let contributed = 0, redeemed = 0, earned = 0, costs = 0
    for (const inv of active) contributed += inv.opening_balance
    for (const mov of movements) {
      if (mov.kind === 'contribution') contributed += mov.amount
      else if (mov.kind === 'redemption') redeemed += mov.amount
      else if (mov.kind === 'yield') earned += mov.amount
      else costs += mov.amount
    }
    return { contributed, redeemed, earned, costs }
  }, [active, movements])

  const monthTotals = useMemo(() => investmentTotals(month, movements), [month, movements])

  const year = Number(month.slice(0, 4))
  const months12 = useMemo(() => monthsOfYear(year), [year])
  const series = useMemo(
    () => investmentMonthlySeries(months12, movements, active.reduce((s, i) => s + i.opening_balance, 0)),
    [months12, movements, active],
  )
  const monthLabels = useMemo(
    () => months12.map(m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)
      .toLocaleDateString(locale, { month: 'short' }).replace('.', '')),
    [months12, locale],
  )

  const flowSeries = useMemo(() => {
    const inflow: number[] = []
    const outflow: number[] = []
    for (const ym of months12) {
      const totals = investmentTotals(ym, movements)
      inflow.push(totals.contributed)
      outflow.push(totals.redeemed + totals.earned)
    }
    return { inflow, outflow }
  }, [months12, movements])

  const slices: ChartDatum[] = useMemo(
    () => appliedByGroup(investments, movements, groupBy).map((s, i) => ({
      label: groupBy === 'asset_class'
        ? t(ASSET_CLASS_KEY[s.key as FinanceInvestmentAssetClass])
        : s.label,
      value: s.value,
      color: groupBy === 'asset_class'
        ? ASSET_CLASS_COLOR[s.key as FinanceInvestmentAssetClass]
        : SLICE_PALETTE[i % SLICE_PALETTE.length],
    })),
    [investments, movements, groupBy, t],
  )

  if (investments.length === 0) {
    return (
      <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>
        {t('finance_invest_empty')}
      </div>
    )
  }

  const statRow = (label: string, value: string, valueColor = 'var(--color-text)') => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: 'var(--color-text-subtle)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor, ...tabularNums }}>{value}</span>
    </div>
  )

  const heroCard = (
    label: string, icon: React.ReactNode, chipBg: string, chipColor: string,
    value: number, valueColor: string, rows: React.ReactNode, footer?: React.ReactNode,
  ) => (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: chipBg, color: chipColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor, ...tabularNums }}>{fmt(value)}</div>
      <div style={{ height: 1, background: 'var(--color-border)', margin: '12px 0 10px' }} />
      {rows}
      {footer && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-muted)' }}>{footer}</div>}
    </div>
  )

  const chartCard = (title: string, subtitle: string, body: React.ReactNode) => (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', minWidth: 0 }}>
      <span style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{title}</span>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '2px 0 12px' }}>{subtitle}</div>
      {body}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        {heroCard(
          t('finance_invest_total_applied'), <Wallet size={17} />, 'var(--color-active)', 'var(--color-text)',
          applied, 'var(--color-text)',
          <>
            {statRow(t('finance_invest_contributed'), fmt(lifetime.contributed))}
            {statRow(t('finance_invest_redeemed'), fmt(lifetime.redeemed))}
            {statRow(t('finance_invest_positions'), String(active.length))}
          </>,
          // Not a disclaimer for legal cover — it is the difference between
          // "principal" and "portfolio", and reading it wrong is the whole bug
          // this module exists to fix.
          <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 5 }}>
            <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            {t('finance_invest_cost_note')}
          </span>,
        )}
        {heroCard(
          t('finance_invest_month'), <PiggyBank size={17} />, 'var(--color-active)', 'var(--color-text)',
          monthTotals.net, monthTotals.net >= 0 ? 'var(--color-text)' : FIN_NEG,
          <>
            {statRow(t('finance_invest_kind_contribution'), fmt(monthTotals.contributed), FIN_NEG)}
            {statRow(t('finance_invest_kind_redemption'), fmt(monthTotals.redeemed), FIN_POS)}
            {statRow(t('finance_invest_kind_yield'), fmt(monthTotals.earned), FIN_POS)}
          </>,
        )}
        {heroCard(
          t('finance_invest_returns'), <TrendingUp size={17} />, 'var(--color-active)', 'var(--color-text)',
          lifetime.earned, FIN_POS,
          <>
            {statRow(t('finance_invest_costs'), fmt(lifetime.costs), FIN_WARN)}
            {statRow(t('finance_invest_net_returns'), fmt(lifetime.earned - lifetime.costs),
              lifetime.earned - lifetime.costs >= 0 ? FIN_POS : FIN_NEG)}
          </>,
          t('finance_invest_returns_note'),
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {chartCard(
          t('finance_invest_distribution'),
          t('finance_invest_distribution_sub'),
          <>
            <div style={{ ...segTrackStyle, marginBottom: 12 }}>
              <button style={segBtnStyle(groupBy === 'institution')} onClick={() => setGroupBy('institution')}>
                {t('finance_invest_by_institution')}
              </button>
              <button style={segBtnStyle(groupBy === 'asset_class')} onClick={() => setGroupBy('asset_class')}>
                {t('finance_invest_by_class')}
              </button>
            </div>
            {slices.length === 0 ? (
              <div style={emptyStateStyle}>{t('finance_invest_no_applied')}</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <Donut data={slices} centerValue={fmt(applied)} centerLabel={t('finance_invest_applied_short')} size={132} />
                <Legend items={slices} formatValue={fmt} />
              </div>
            )}
          </>,
        )}
        {chartCard(
          t('finance_invest_evolution'),
          // The gap between the two lines IS the accumulated return, which is
          // more informative than plotting the applied amount alone.
          t('finance_invest_evolution_sub'),
          <DualAreaTrend
            labels={monthLabels}
            series={[
              { name: t('finance_invest_applied_short'), color: FIN_ACCENT, values: series.applied },
              { name: t('finance_invest_contributed'), color: 'var(--color-text-muted)', values: series.contributed },
            ]}
            formatValue={fmt}
          />,
        )}
      </div>

      {chartCard(
        t('finance_invest_flow'),
        t('finance_invest_flow_sub'),
        <DualAreaTrend
          labels={monthLabels}
          series={[
            { name: t('finance_invest_kind_contribution'), color: FIN_NEG, values: flowSeries.inflow },
            { name: t('finance_invest_returns_short'), color: FIN_POS, values: flowSeries.outflow },
          ]}
          formatValue={fmt}
        />,
      )}
    </div>
  )
}

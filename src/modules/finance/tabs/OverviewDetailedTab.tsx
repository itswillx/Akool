import { useMemo } from 'react'
import { ChevronRight, Landmark, TrendingDown, TrendingUp, Users } from 'lucide-react'
import type {
  FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceGoalContribution,
  FinanceRecurring, FinanceRecurringEntry, FinanceTransaction,
} from '../../../types'
import { formatBRL } from '../../../lib/money'
import {
  accountBalance, budgetStatus, monthTotals, monthlySeries, monthsOfYear,
  pendingRecurringTotal, savingsRate, topCategories, totalsByCategory, transactionsInMonth,
} from '../../../lib/financeCalc'
import { Donut, DualAreaTrend } from '../../../components/Charts'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import {
  useFinanceMobile,
  cardSurfaceStyle, sectionCaptionStyle, ghostBtnStyle, tabularNums,
  FIN_ACCENT, FIN_NEG, FIN_NEG_SOFT, FIN_POS, FIN_POS_SOFT, FIN_WARN,
} from '../ui'
import type { TabId } from '../FinancePanel'

// Presentational "client-friendly" take on the finance overview, selected via
// profile.finance_dashboard_view === 'detailed' (the default). Read-only by
// design: paying/skipping bills stays in the simple view and the Recurring tab;
// here recurrings only surface aggregated as "expected" lines. Like the simple
// overview, `recurring`/`recurringEntries` are always the personal datasets even
// in family view (pre-existing limitation of the data hook).

const fmt = formatBRL

interface Props {
  transactions: FinanceTransaction[]
  categories: FinanceCategory[]
  accounts: FinanceAccount[]
  budgets: FinanceBudget[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  recurring: FinanceRecurring[]
  recurringEntries: FinanceRecurringEntry[]
  month: string
  onNavigate: (tab: TabId) => void
  workspaceName?: string | null
  onOpenWorkspaceView?: () => void
}

export default function OverviewDetailedTab({
  transactions, categories, accounts, budgets, goals, contributions,
  recurring, recurringEntries, month, onNavigate, workspaceName, onOpenWorkspaceView,
}: Props) {
  const { t, lang } = useLanguage()
  const { user, profile } = useAuth()
  const isMobile = useFinanceMobile()
  const locale = lang === 'en' ? 'en-US' : 'pt-BR'

  // ─── Aggregations (all cents, all via financeCalc) ─────────────────────────
  const monthTxs = useMemo(() => transactionsInMonth(transactions, month), [transactions, month])
  const totals = useMemo(() => monthTotals(monthTxs), [monthTxs])
  const expectedIncome = useMemo(
    () => pendingRecurringTotal(recurring, recurringEntries, month, 'income'),
    [recurring, recurringEntries, month],
  )
  const expectedExpense = useMemo(
    () => pendingRecurringTotal(recurring, recurringEntries, month, 'expense'),
    [recurring, recurringEntries, month],
  )

  const balances = useMemo(
    () => accounts.map(acc => ({ acc, balance: accountBalance(acc, transactions) })),
    [accounts, transactions],
  )
  const netWorth = balances.reduce((s, b) => s + b.balance, 0)
  const sumOf = (types: FinanceAccount['type'][]) =>
    balances.filter(b => types.includes(b.acc.type)).reduce((s, b) => s + b.balance, 0)
  const availableBalance = sumOf(['checking', 'cash'])
  const savedBalance = sumOf(['savings'])
  const cardsBalance = sumOf(['credit'])
  const goalsReserved = useMemo(() => {
    const active = new Set(goals.filter(g => g.status === 'active').map(g => g.id))
    return contributions.filter(c => active.has(c.goal_id)).reduce((s, c) => s + c.amount, 0)
  }, [goals, contributions])

  const monthBudgets = useMemo(() => budgets.filter(b => b.month === month), [budgets, month])
  const budgetedTotal = monthBudgets.reduce((s, b) => s + b.amount_limit, 0)
  const spendStatus = budgetStatus(totals.expense, budgetedTotal)
  const spendPctRaw = budgetedTotal > 0 ? (totals.expense / budgetedTotal) * 100 : 0

  const spentByCat = useMemo(() => totalsByCategory(monthTxs, 'expense'), [monthTxs])
  const incomeByCat = useMemo(() => totalsByCategory(monthTxs, 'income'), [monthTxs])
  const topExpenses = topCategories(spentByCat, 3)
  const incomeDist = topCategories(incomeByCat, 8)
  const incomeDistTotal = incomeDist.reduce((s, c) => s + c.amount, 0)
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  const year = Number(month.slice(0, 4))
  const months12 = useMemo(() => monthsOfYear(year), [year])
  const annual = useMemo(() => monthlySeries(transactions, months12), [transactions, months12])
  const monthLabels = useMemo(
    () => months12.map(m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)
      .toLocaleDateString(locale, { month: 'short' }).replace('.', '')),
    [months12, locale],
  )

  const rate = savingsRate(totals.income, totals.expense)

  // ─── Small shared pieces ────────────────────────────────────────────────────
  const pctStr = (v: number, digits = 1) => {
    const s = v.toFixed(digits)
    return lang === 'pt-BR' ? s.replace('.', ',') : s
  }

  const hour = new Date().getHours()
  const greetKey = hour >= 5 && hour < 12
    ? 'finance_greeting_morning' as const
    : hour < 18 ? 'finance_greeting_afternoon' as const : 'finance_greeting_evening' as const
  const displayName = profile?.display_name?.trim() || user?.email?.split('@')[0] || ''

  const dividerStyle = { borderTop: '1px solid var(--color-border)', margin: '12px 0 10px' } as const

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
      <div style={dividerStyle} />
      {rows}
      {footer && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-muted)' }}>{footer}</div>}
    </div>
  )

  const caption = (text: string) => <p style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{text}</p>

  const categoryChip = (categoryId: string) => {
    const cat = catMap.get(categoryId)
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{cat?.icon ?? '❔'}</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat?.name ?? '—'}</span>
      </span>
    )
  }

  const navigateLink = (tab: TabId, label: string) => (
    <button onClick={() => onNavigate(tab)}
      style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
      {label} <ChevronRight size={12} />
    </button>
  )

  // ─── Cards ──────────────────────────────────────────────────────────────────

  const netWorthCard = heroCard(
    t('finance_detail_net_worth'), <Landmark size={17} />, 'var(--color-active)', 'var(--color-text)',
    netWorth, netWorth >= 0 ? 'var(--color-text)' : FIN_NEG,
    <>
      {statRow(t('finance_detail_net_worth_available'), fmt(availableBalance))}
      {statRow(t('finance_detail_net_worth_saved'), fmt(savedBalance))}
      {statRow(t('finance_detail_net_worth_cards'), fmt(cardsBalance), cardsBalance < 0 ? FIN_NEG : 'var(--color-text)')}
    </>,
    goalsReserved > 0 ? t('finance_detail_net_worth_goals', { amount: fmt(goalsReserved) }) : undefined,
  )

  const incomeCard = heroCard(
    t('finance_detail_income_title'), <TrendingUp size={17} />, FIN_POS_SOFT, FIN_POS,
    totals.income, FIN_POS,
    <>
      {statRow(t('finance_detail_income_expected'), fmt(expectedIncome))}
      {statRow(t('finance_detail_month_balance'), fmt(totals.balance), totals.balance >= 0 ? 'var(--color-text)' : FIN_NEG)}
    </>,
    rate == null ? t('finance_overview_no_income') : t('finance_overview_savings_rate', { pct: rate }),
  )

  const expenseCard = heroCard(
    t('finance_detail_expense_title'), <TrendingDown size={17} />, FIN_NEG_SOFT, FIN_NEG,
    totals.expense, FIN_NEG,
    <>
      {statRow(t('finance_detail_expense_expected'), fmt(expectedExpense))}
      {statRow(t('finance_detail_budgeted'), fmt(budgetedTotal))}
    </>,
    navigateLink('recurring', t('finance_detail_view_recurring')),
  )

  const donutData = spendStatus.over
    ? [{ label: '', value: 1, color: FIN_NEG }]
    : [
        { label: '', value: totals.expense, color: FIN_ACCENT },
        { label: '', value: Math.max(spendStatus.remaining, 0), color: 'transparent' },
      ]

  const spendingCard = (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {caption(t('finance_detail_spending_title'))}
      {budgetedTotal > 0 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut data={donutData} size={130} thickness={16}
              centerValue={`${Math.round(spendPctRaw)}%`} centerLabel={t('finance_detail_budgeted')} />
            <div style={{ flex: 1, minWidth: 150 }}>
              {statRow(t('finance_detail_spending_of_budget'), `${pctStr(spendPctRaw)}%`)}
              {spendStatus.over
                ? statRow(t('finance_detail_budget_over'), fmt(-spendStatus.remaining), FIN_NEG)
                : statRow(t('finance_detail_budget_left'), fmt(spendStatus.remaining), FIN_POS)}
              {statRow(t('finance_detail_budgeted'), fmt(budgetedTotal))}
            </div>
          </div>
          {topExpenses.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 7 }}>{t('finance_detail_top_expenses')}:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {topExpenses.map(e => (
                  <div key={e.categoryId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    {categoryChip(e.categoryId)}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{fmt(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_detail_bva_empty')}</span>
          <button onClick={() => onNavigate('budgets')} style={ghostBtnStyle}>
            {t('finance_tab_budgets')} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )

  const seriesLegend = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {[[FIN_POS, t('finance_month_income')], [FIN_NEG, t('finance_month_expense')]].map(([color, label]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-text-subtle)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  )

  const annualCard = (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        {caption(`${t('finance_detail_annual_title')} · ${year}`)}
        {seriesLegend}
      </div>
      <DualAreaTrend
        labels={monthLabels}
        series={[
          { name: t('finance_month_income'), color: FIN_POS, values: annual.map(m => m.income) },
          { name: t('finance_month_expense'), color: FIN_NEG, values: annual.map(m => m.expense) },
        ]}
        height={isMobile ? 140 : 190}
        formatValue={fmt}
      />
    </div>
  )

  const incomeDistCard = (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {caption(t('finance_detail_income_dist_title'))}
      {incomeDist.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_detail_income_dist_empty')}</span>
      ) : (
        <>
          <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--color-hover)' }}>
            {incomeDist.map(seg => {
              const cat = catMap.get(seg.categoryId)
              return (
                <div key={seg.categoryId} title={`${cat?.name ?? '—'}: ${fmt(seg.amount)}`}
                  style={{ width: `${(seg.amount / incomeDistTotal) * 100}%`, background: cat?.color ?? '#9b9a97' }} />
              )
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {incomeDist.map(seg => {
              const cat = catMap.get(seg.categoryId)
              return (
                <div key={seg.categoryId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: cat?.color ?? '#9b9a97', flexShrink: 0 }} />
                  <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{cat?.name ?? '—'}</span>
                  <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, ...tabularNums }}>{pctStr((seg.amount / incomeDistTotal) * 100, 0)}%</span>
                  <span style={{ color: 'var(--color-text)', fontWeight: 600, flexShrink: 0, ...tabularNums }}>{fmt(seg.amount)}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )

  const bvaRows = monthBudgets
    .map(b => ({ budget: b, status: budgetStatus(spentByCat[b.category_id] ?? 0, b.amount_limit) }))
    .sort((a, b) => (b.status.limit > 0 ? b.status.spent / b.status.limit : 0) - (a.status.limit > 0 ? a.status.spent / a.status.limit : 0))

  const bvaCard = (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {caption(t('finance_detail_bva_title'))}
      {bvaRows.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_detail_bva_empty')}</span>
          <button onClick={() => onNavigate('budgets')} style={ghostBtnStyle}>
            {t('finance_tab_budgets')} <ChevronRight size={14} />
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px 22px' }}>
          {bvaRows.map(({ budget, status }) => (
            <div key={budget.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                {categoryChip(budget.category_id)}
                <span style={{ fontSize: 12, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                  <strong style={{ color: status.over ? FIN_NEG : 'var(--color-text)' }}>{fmt(status.spent)}</strong> / {fmt(status.limit)}
                </span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: 'var(--color-hover)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${status.pct}%`, background: status.over ? FIN_NEG : status.pct >= 85 ? FIN_WARN : FIN_POS, borderRadius: 999 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                <span>
                  {status.over
                    ? <>{t('finance_detail_budget_over')}: <span style={{ color: FIN_NEG, fontWeight: 600, ...tabularNums }}>{fmt(-status.remaining)}</span></>
                    : <>{t('finance_detail_budget_left')}: <span style={{ ...tabularNums }}>{fmt(status.remaining)}</span></>}
                </span>
                <span style={tabularNums}>{pctStr(status.limit > 0 ? (status.spent / status.limit) * 100 : 0, 0)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ─── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: '2px 0 0', fontSize: isMobile ? 18 : 21, fontWeight: 700, color: 'var(--color-text)' }}>
          {t(greetKey, { name: displayName })} 👋
        </h2>
        {workspaceName && onOpenWorkspaceView && (
          <button onClick={onOpenWorkspaceView} title={t('finance_ws_view_open')} style={ghostBtnStyle}>
            <Users size={14} />{workspaceName}<ChevronRight size={14} />
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
        {netWorthCard}
        {incomeCard}
        {expenseCard}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr', gap: 14, alignItems: 'stretch' }}>
        {spendingCard}
        {annualCard}
      </div>

      {incomeDistCard}

      {bvaCard}
    </div>
  )
}

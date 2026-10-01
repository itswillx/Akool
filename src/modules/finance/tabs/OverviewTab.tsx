// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { ChevronRight, CreditCard, RefreshCw, Star, Target, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { localeOf } from '../../../i18n/translations'
import {
balancesByAccount,
expenseByCategory,
monthlySeries, monthTotals,
sumByGoal, transactionsInMonth,
type FinanceTxAgg
} from '../../../lib/financeCalc'
import { localDateFromKey, localDateKey } from '../../../lib/localDate'
import type { FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceRecurring, FinanceRecurringEntry, FinanceTransaction } from '../../../types'
import type { TabId } from '../financeFormat'
import { fmt, last6Months, prevMonth } from '../financeFormat'
import { type ProjectsSection } from '../myprojects/section'
import {
cardSurfaceStyle,
FIN_ACCENT,
FIN_NEG,
FIN_NEG_SOFT,
FIN_POS,
FIN_POS_SOFT,
FIN_WARN,
ghostBtnStyle,
sectionCaptionStyle,
tabularNums,
useFinanceMobile
} from '../ui'

// ─── Overview Tab ─────────────────────────────────────────────────────────────

export function OverviewTab({ transactions, transactionsAgg, categories, month, recurring, recurringEntries, accounts, budgets, goals, contributions, onMarkPaid, onSkipEntry, onNavigate, workspaceName, onOpenWorkspaceView }: {
  transactions: FinanceTransaction[]
  transactionsAgg: FinanceTxAgg[]
  categories: FinanceCategory[]
  month: string
  recurring: FinanceRecurring[]
  recurringEntries: FinanceRecurringEntry[]
  accounts: FinanceAccount[]
  budgets: FinanceBudget[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  onMarkPaid: (entry: FinanceRecurringEntry, rec: FinanceRecurring) => void
  onSkipEntry: (entryId: string) => void
  onNavigate: (tab: TabId, section?: ProjectsSection) => void
  workspaceName?: string | null
  onOpenWorkspaceView?: () => void
}) {
  const { t, lang } = useLanguage()
  const isMobile = useFinanceMobile()
  const [confirm, setConfirm] = useState<{ entryId: string; action: 'pay' | 'skip' } | null>(null)

  // PERF-005: o painel re-renderiza a cada modal aberto ou filtro digitado, e
  // antes cada render refazia todas as varreduras abaixo. Memoizadas pelos
  // dados de que dependem, e numa passada só (helpers de lib/financeCalc).
  const { income, expense, prevIncome, prevExpense, expenseBycat } = useMemo(() => {
    const monthTxs = transactionsInMonth(transactions, month)
    const cur = monthTotals(monthTxs)
    // Previous-month totals power the "vs. mês anterior" deltas.
    const prev = monthTotals(transactionsInMonth(transactions, prevMonth(month)))
    return {
      monthTxs, income: cur.income, expense: cur.expense,
      prevIncome: prev.income, prevExpense: prev.expense,
      // Expense breakdown by category (donut + legend, and the budgets' spent).
      expenseBycat: expenseByCategory(monthTxs),
    }
  }, [transactions, month])
  const balance = income - expense

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const { topCats, donutTotal, donutGradient } = useMemo(() => {
    const topCats = Object.entries(expenseBycat).sort((a, b) => b[1] - a[1]).slice(0, 6)
    const donutTotal = topCats.reduce((s, [, v]) => s + v, 0)
    let donutAcc = 0
    const donutStops = topCats.map(([catId, amount]) => {
      const c = catMap.get(catId)
      const start = (donutAcc / donutTotal) * 100
      donutAcc += amount
      const end = (donutAcc / donutTotal) * 100
      return `${c?.color ?? '#9b9a97'} ${start.toFixed(2)}% ${end.toFixed(2)}%`
    })
    return { topCats, donutTotal, donutGradient: donutTotal > 0 ? `conic-gradient(${donutStops.join(',')})` : 'var(--color-border)' }
  }, [expenseBycat, catMap])

  // Last 6 months evolution — from the all-time aggregate set: the 6-month
  // window can reach outside the currently loaded month window.
  const { monthStats, maxBar } = useMemo(() => {
    const months6 = last6Months(month)
    const series = monthlySeries(transactionsAgg, months6)
    const monthStats = months6.map((m, i) => ({
      month: m,
      label: new Date(parseInt(m.split('-')[0]), parseInt(m.split('-')[1]) - 1, 1)
        .toLocaleDateString(localeOf(lang), { month: 'short' }),
      income: series[i].income,
      expense: series[i].expense,
    }))
    return { monthStats, maxBar: Math.max(...monthStats.flatMap(m => [m.income, m.expense]), 1) }
  }, [transactionsAgg, month, lang])

  // Upcoming bills — next 15 days + overdue pending entries. `today` entra nas
  // dependências para o horizonte andar na virada do dia.
  const today = localDateKey()
  const todayDate = useMemo(() => localDateFromKey(today), [today])
  const recMap = useMemo(() => new Map(recurring.map(r => [r.id, r])), [recurring])
  const upcomingEntries = useMemo(() => {
    const horizon = new Date(todayDate)
    horizon.setDate(horizon.getDate() + 15)
    return recurringEntries
      .filter(e => {
        if (e.status !== 'pending') return false
        const due = new Date(e.due_date + 'T12:00:00')
        return due <= horizon
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
  }, [recurringEntries, todayDate])

  // ─── Sector mini-summaries ──────────────────────────────────────────────────
  // Via the shared helper rather than inline arithmetic: três cópias da fórmula
  // foi como a sidebar e o dashboard acabaram discordando do banco. All-time,
  // so it reads the aggregate set rather than the month-windowed one.
  const accountsBalance = useMemo(() => {
    let sum = 0
    for (const balance of balancesByAccount(accounts, transactionsAgg).values()) sum += balance
    return sum
  }, [accounts, transactionsAgg])

  const { activeGoals, goalsPct } = useMemo(() => {
    const byGoal = sumByGoal(contributions)
    const activeGoals = goals.filter(g => g.status === 'active')
    const goalsTarget = activeGoals.reduce((s, g) => s + g.target_amount, 0)
    const goalsAccumulated = activeGoals.reduce((s, g) => s + (byGoal.get(g.id) ?? 0), 0)
    return { activeGoals, goalsPct: goalsTarget > 0 ? Math.min((goalsAccumulated / goalsTarget) * 100, 100) : 0 }
  }, [goals, contributions])

  const { monthBudgets, budgetsOver, budgetMini } = useMemo(() => {
    const monthBudgets = budgets.filter(b => b.month === month)
    const spentOf = (b: FinanceBudget) => expenseBycat[b.category_id] ?? 0
    return {
      monthBudgets,
      budgetsOver: monthBudgets.filter(b => spentOf(b) > b.amount_limit).length,
      budgetMini: monthBudgets.map(b => {
        const spent = spentOf(b)
        const pct = b.amount_limit > 0 ? Math.min((spent / b.amount_limit) * 100, 100) : 0
        return { id: b.id, name: catMap.get(b.category_id)?.name ?? '—', spent, limit: b.amount_limit, pct, over: spent > b.amount_limit }
      }).slice(0, 5),
    }
  }, [budgets, month, expenseBycat, catMap])

  const deltaNode = (cur: number, prev: number, higherIsBad: boolean) => {
    if (!prev) return <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>—</span>
    const d = ((cur - prev) / prev) * 100
    const up = d >= 0
    const good = higherIsBad ? !up : up
    return <span style={{ color: good ? FIN_POS : FIN_NEG, fontWeight: 600, ...tabularNums }}>{up ? '+' : '−'}{Math.abs(d).toFixed(1).replace('.', ',')}%</span>
  }

  const summaryCard = (label: string, value: number, icon: React.ReactNode, chipBg: string, chipColor: string, valueColor: string, sub: React.ReactNode) => (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: chipBg, color: chipColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor, ...tabularNums }}>{fmt(value)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12.5, color: 'var(--color-text-subtle)' }}>{sub}</div>
    </div>
  )

  const sectorCard = (key: string, icon: React.ReactNode, label: string, value: React.ReactNode, sub: string, tab: TabId, section?: ProjectsSection) => (
    <button key={key} onClick={() => onNavigate(tab, section)}
      style={{ textAlign: 'left', ...cardSurfaceStyle, padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-text-subtle)' }}>
          <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>{icon}</span>{label}
        </span>
        <ChevronRight size={16} style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{sub}</div>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Coworkspace view entry */}
      {workspaceName && onOpenWorkspaceView && (
        <div>
          <button onClick={onOpenWorkspaceView} title={t('finance_ws_view_open')} style={ghostBtnStyle}>
            <Users size={14} />{workspaceName}<ChevronRight size={14} />
          </button>
        </div>
      )}
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
        {summaryCard(t('finance_month_income'), income, <TrendingUp size={17} />, FIN_POS_SOFT, FIN_POS, 'var(--color-text)',
          <><span>{deltaNode(income, prevIncome, false)}</span><span>{t('finance_vs_prev_month')}</span></>)}
        {summaryCard(t('finance_month_expense'), expense, <TrendingDown size={17} />, FIN_NEG_SOFT, FIN_NEG, 'var(--color-text)',
          <><span>{deltaNode(expense, prevExpense, true)}</span><span>{t('finance_vs_prev_month')}</span></>)}
        {summaryCard(t('finance_month_balance'), balance, <Wallet size={17} />, 'var(--color-active)', 'var(--color-text)', balance >= 0 ? 'var(--color-text)' : FIN_NEG,
          <span>{t('finance_balance_sub')}</span>)}
      </div>

      {/* Sector shortcuts */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 14 }}>
        {sectorCard('accounts', <CreditCard size={16} />, t('finance_tab_accounts'),
          fmt(accountsBalance),
          accounts.length === 1 ? t('finance_overview_accounts_sub', { n: accounts.length }) : t('finance_overview_accounts_sub_plural', { n: accounts.length }),
          'accounts')}
        {sectorCard('goals', <Star size={16} />, t('finance_tab_goals'),
          activeGoals.length > 0 ? `${goalsPct.toFixed(0)}%` : '—',
          activeGoals.length === 1 ? t('finance_overview_goals_sub', { n: activeGoals.length }) : t('finance_overview_goals_sub_plural', { n: activeGoals.length }),
          'myprojects', 'goals')}
        {sectorCard('budgets', <Target size={16} />, t('finance_tab_budgets'),
          monthBudgets.length > 0 ? (budgetsOver > 0 ? t('finance_overview_budgets_over', { n: budgetsOver }) : t('finance_overview_budgets_ok')) : '—',
          monthBudgets.length === 1 ? t('finance_overview_budgets_sub', { n: monthBudgets.length }) : t('finance_overview_budgets_sub_plural', { n: monthBudgets.length }),
          'budgets')}
        {sectorCard('recurring', <RefreshCw size={16} />, t('finance_tab_recurring'),
          upcomingEntries.length > 0 ? String(upcomingEntries.length) : '—',
          upcomingEntries.length === 1 ? t('finance_overview_recurring_sub', { n: upcomingEntries.length }) : t('finance_overview_recurring_sub_plural', { n: upcomingEntries.length }),
          'recurring')}
      </div>

      {/* Monthly evolution */}
      <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={sectionCaptionStyle}>{t('finance_monthly_evolution')}</h3>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-subtle)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: FIN_POS }} />{t('finance_month_income')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: FIN_NEG }} />{t('finance_month_expense')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 172 }}>
          {monthStats.map(ms => (
            <div key={ms.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, height: '100%', justifyContent: 'flex-end' }}>
              <div title={`${t('finance_tx_income')}: ${fmt(ms.income)} · ${t('finance_tx_expense')}: ${fmt(ms.expense)}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: '100%', width: '100%', justifyContent: 'center' }}>
                <div style={{ width: 15, background: FIN_POS, borderRadius: '3px 3px 0 0', height: `${(ms.income / maxBar) * 100}%`, minHeight: ms.income > 0 ? 3 : 0, transition: 'height 0.4s ease' }} />
                <div style={{ width: 15, background: FIN_NEG, borderRadius: '3px 3px 0 0', height: `${(ms.expense / maxBar) * 100}%`, minHeight: ms.expense > 0 ? 3 : 0, transition: 'height 0.4s ease' }} />
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{ms.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gastos por categoria (donut) + Orçamentos do mês */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
          <h3 style={{ ...sectionCaptionStyle, marginBottom: 14 }}>{t('finance_overview_donut_title')}</h3>
          {donutTotal > 0 ? (
            <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
                <div style={{ width: 130, height: 130, borderRadius: '50%', background: donutGradient }} />
                <div style={{ position: 'absolute', inset: 19, background: 'var(--color-surface)', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_chart_total')}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{fmt(donutTotal)}</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, minWidth: 150 }}>
                {topCats.map(([catId, amount]) => {
                  const cat = catMap.get(catId)
                  if (!cat) return null
                  return (
                    <div key={catId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: cat.color }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.icon} {cat.name}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', width: 34, textAlign: 'right' }}>{Math.round((amount / donutTotal) * 100)}%</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', textAlign: 'right', ...tabularNums }}>{fmt(amount)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_no_transactions')}</div>
          )}
        </div>

        <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={sectionCaptionStyle}>{t('finance_budgets_of_month')}</h3>
            <button onClick={() => onNavigate('budgets')} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('finance_see_all')}</button>
          </div>
          {budgetMini.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {budgetMini.map(b => (
                <div key={b.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{b.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-subtle)', whiteSpace: 'nowrap', flexShrink: 0, ...tabularNums }}>{fmt(b.spent)} / {fmt(b.limit)}</span>
                  </div>
                  <div style={{ height: 7, background: 'var(--color-bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${b.pct}%`, background: b.over ? FIN_NEG : FIN_ACCENT, borderRadius: 5, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_no_budgets')}</div>
          )}
        </div>
      </div>

      {/* Upcoming bills (kept — actionable) */}
      {upcomingEntries.length > 0 && (
        <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
          <h3 style={{ ...sectionCaptionStyle, marginBottom: 14 }}>{t('finance_upcoming_bills')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcomingEntries.map(entry => {
              const rec = recMap.get(entry.recurring_id)
              if (!rec) return null
              const due = new Date(entry.due_date + 'T12:00:00')
              const diffDays = Math.round((due.getTime() - todayDate.getTime()) / 86400000)
              const badgeColor = diffDays < 0 ? FIN_NEG : diffDays <= 7 ? FIN_WARN : FIN_POS
              const badgeLabel = diffDays < 0 ? t('finance_upcoming_overdue') : diffDays === 0 ? t('finance_upcoming_today') : diffDays === 1 ? t('finance_upcoming_days_left', { n: diffDays }) : t('finance_upcoming_days_left_plural', { n: diffDays })
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{rec.is_variable ? '📋' : rec.type === 'income' ? '💰' : '💸'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.description}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {new Date(entry.due_date + 'T12:00:00').toLocaleDateString(localeOf(lang), { day: '2-digit', month: 'short' })}
                      {rec.is_variable ? ` · ${t('finance_upcoming_variable')}` : rec.amount != null ? ` · ${fmt(rec.amount)}` : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, backgroundColor: `${badgeColor}22`, color: badgeColor, fontWeight: 700, flexShrink: 0 }}>{badgeLabel}</span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {confirm?.entryId === entry.id ? (
                      <>
                        <button onClick={() => { if (confirm.action === 'pay') onMarkPaid(entry, rec); else onSkipEntry(entry.id); setConfirm(null) }}
                          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: confirm.action === 'pay' ? FIN_POS : FIN_NEG, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          ✓ {t('finance_confirm')}
                        </button>
                        <button onClick={() => setConfirm(null)}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setConfirm({ entryId: entry.id, action: 'pay' })}
                          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', backgroundColor: FIN_POS, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                          {t('finance_recurring_mark_paid')}
                        </button>
                        <button onClick={() => setConfirm({ entryId: entry.id, action: 'skip' })}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}>
                          {t('finance_recurring_skip')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

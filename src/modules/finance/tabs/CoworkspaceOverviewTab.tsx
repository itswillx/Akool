import { useMemo } from 'react'
import { ChevronLeft, Settings, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react'
import type {
  FinanceAccount, FinanceBudget, FinanceCategory,
  FinanceTransaction, FinanceWorkspace, FinanceWorkspaceMember,
} from '../../../types'
import { formatBRL } from '../../../lib/money'
import {
  accountBalance, budgetStatus, monthTotals, topCategories, totalsByCategory,
  totalsByUser, transactionsInMonth,
  type FinanceTxAgg,
} from '../../../lib/financeCalc'
import { Donut } from '../../../components/Charts'
import { UserAvatar } from '../../../components/UserAvatar'
import { useLanguage } from '../../../i18n/LanguageContext'
import {
  useFinanceMobile,
  cardSurfaceStyle, sectionCaptionStyle, ghostBtnStyle, tabularNums,
  FIN_ACCENT, FIN_NEG, FIN_NEG_SOFT, FIN_POS, FIN_POS_SOFT, FIN_WARN,
} from '../ui'

// Aggregated view of the coworkspace, rendered in place of the personal
// overview (entered via the chip there, left via "Voltar"). All datasets here
// are the family* ones: every member's rows with workspace_id set. Read-only:
// creating/editing shared rows happens in the normal tabs via each modal's
// scope picker.

const fmt = formatBRL

interface Props {
  workspace: FinanceWorkspace
  members: FinanceWorkspaceMember[]
  transactions: FinanceTransaction[]
  transactionsAgg: FinanceTxAgg[]
  budgets: FinanceBudget[]
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  month: string
  onBack: () => void
  onManage: () => void
}

export default function CoworkspaceOverviewTab({
  workspace, members, transactions, transactionsAgg, budgets, accounts, categories, month, onBack, onManage,
}: Props) {
  const { t, lang } = useLanguage()
  const isMobile = useFinanceMobile()

  const monthTxs = useMemo(() => transactionsInMonth(transactions, month), [transactions, month])
  const totals = useMemo(() => monthTotals(monthTxs), [monthTxs])
  const spentByCat = useMemo(() => totalsByCategory(monthTxs, 'expense'), [monthTxs])
  const topCats = topCategories(spentByCat, 6)
  const topCatsTotal = topCats.reduce((s, c) => s + c.amount, 0)
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const memberMap = useMemo(() => new Map(members.map(m => [m.user_id, m])), [members])

  // Every member shows up, even with zero spending; authors who already left
  // the workspace would have workspace_id nulled by leave_workspace, so the
  // members list covers everyone visible here.
  const spentByUser = useMemo(() => totalsByUser(monthTxs, 'expense'), [monthTxs])
  const memberSpending = useMemo(() =>
    members
      .map(m => ({ member: m, spent: spentByUser[m.user_id] ?? 0 }))
      .sort((a, b) => b.spent - a.spent),
    [members, spentByUser])
  const maxMemberSpent = Math.max(1, ...memberSpending.map(m => m.spent))

  const monthBudgets = useMemo(() => budgets.filter(b => b.month === month), [budgets, month])

  const pctStr = (v: number, digits = 1) => {
    const s = v.toFixed(digits)
    return lang === 'pt-BR' ? s.replace('.', ',') : s
  }

  const memberName = (userId: string) => {
    const p = memberMap.get(userId)?.profile
    return p?.display_name || p?.email || '?'
  }

  const caption = (text: string) => <p style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{text}</p>

  const summaryCard = (label: string, value: number, icon: React.ReactNode, chipBg: string, chipColor: string, valueColor: string) => (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: chipBg, color: chipColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor, ...tabularNums }}>{fmt(value)}</div>
    </div>
  )

  const avatarOf = (userId: string, size = 24) => {
    const p = memberMap.get(userId)?.profile
    return <UserAvatar name={memberName(userId)} seed={p?.email} emoji={p?.avatar_emoji} color={p?.avatar_color} url={p?.avatar_url} size={size} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header: back · workspace identity · manage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={ghostBtnStyle}>
          <ChevronLeft size={15} />{t('finance_ws_view_back')}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--color-active)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Users size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 18, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 3 }}>
              {members.map((m, i) => (
                <span key={m.id} title={memberName(m.user_id)} style={{ marginLeft: i === 0 ? 0 : -7, display: 'inline-flex', borderRadius: '50%', border: '2px solid var(--color-bg-secondary)' }}>
                  {avatarOf(m.user_id, 22)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <button onClick={onManage} style={ghostBtnStyle}>
          <Settings size={14} />{t('finance_ws_view_manage')}
        </button>
      </div>

      {/* Month summary */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
        {summaryCard(t('finance_month_income'), totals.income, <TrendingUp size={17} />, FIN_POS_SOFT, FIN_POS, FIN_POS)}
        {summaryCard(t('finance_month_expense'), totals.expense, <TrendingDown size={17} />, FIN_NEG_SOFT, FIN_NEG, FIN_NEG)}
        {summaryCard(t('finance_month_balance'), totals.balance, <Wallet size={17} />, 'var(--color-active)', 'var(--color-text)', totals.balance >= 0 ? 'var(--color-text)' : FIN_NEG)}
      </div>

      {/* Spending by member + by category */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14, alignItems: 'stretch' }}>
        <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {caption(t('finance_ws_view_members_spending'))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {memberSpending.map(({ member, spent }) => (
              <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {avatarOf(member.user_id, 28)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memberName(member.user_id)}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0, ...tabularNums }}>{fmt(spent)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--color-hover)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(spent / maxMemberSpent) * 100}%`, background: FIN_ACCENT, borderRadius: 999 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {caption(t('finance_ws_view_by_category'))}
          {topCats.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_ws_view_empty')}</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Donut
                data={topCats.map(c => ({ label: catMap.get(c.categoryId)?.name ?? '—', value: c.amount, color: catMap.get(c.categoryId)?.color ?? '#9b9a97' }))}
                size={120} thickness={15} centerValue={''} centerLabel={undefined}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 150 }}>
                {topCats.map(c => {
                  const cat = catMap.get(c.categoryId)
                  return (
                    <div key={c.categoryId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: cat?.color ?? '#9b9a97', flexShrink: 0 }} />
                      <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{cat?.name ?? '—'}</span>
                      <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, ...tabularNums }}>{pctStr(topCatsTotal > 0 ? (c.amount / topCatsTotal) * 100 : 0, 0)}%</span>
                      <span style={{ color: 'var(--color-text)', fontWeight: 600, flexShrink: 0, ...tabularNums }}>{fmt(c.amount)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Workspace budgets */}
      <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {caption(t('finance_ws_view_budgets'))}
        {monthBudgets.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_no_budgets')}</span>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px 22px' }}>
            {monthBudgets.map(budget => {
              const cat = catMap.get(budget.category_id)
              const status = budgetStatus(spentByCat[budget.category_id] ?? 0, budget.amount_limit)
              return (
                <div key={budget.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{cat?.icon ?? '📦'}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat?.name ?? '—'}</span>
                      <span title={memberName(budget.user_id)} style={{ display: 'inline-flex', flexShrink: 0 }}>{avatarOf(budget.user_id, 18)}</span>
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                      <strong style={{ color: status.over ? FIN_NEG : 'var(--color-text)' }}>{fmt(status.spent)}</strong> / {fmt(status.limit)}
                    </span>
                  </div>
                  <div style={{ height: 7, borderRadius: 999, background: 'var(--color-hover)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${status.pct}%`, background: status.over ? FIN_NEG : status.pct >= 85 ? FIN_WARN : FIN_POS, borderRadius: 999 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Shared accounts + recent shared transactions */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr', gap: 14, alignItems: 'start' }}>
        <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {caption(t('finance_ws_view_accounts'))}
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: -6 }}>{t('finance_ws_view_accounts_note')}</span>
          {accounts.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_no_accounts')}</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {accounts.map(acc => {
                const bal = accountBalance(acc, transactionsAgg)
                return (
                  <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 10, background: 'var(--color-bg)' }}>
                    <span style={{ fontSize: 16 }}>{acc.icon}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: bal >= 0 ? FIN_POS : FIN_NEG, flexShrink: 0, ...tabularNums }}>{fmt(bal)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ ...cardSurfaceStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {caption(t('finance_ws_view_recent'))}
          {monthTxs.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_ws_view_empty')}</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {monthTxs.slice(0, 8).map(tx => {
                const cat = tx.category_id ? catMap.get(tx.category_id) : null
                return (
                  <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: cat ? `${cat.color}22` : 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                      {cat ? cat.icon : (tx.type === 'income' ? '💰' : '💸')}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tx.description || cat?.name || '—'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                        {avatarOf(tx.user_id, 15)}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memberName(tx.user_id)}</span>
                        <span>·</span>
                        <span style={{ flexShrink: 0 }}>{new Date(tx.date + 'T12:00:00').toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: 'short' })}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: tx.type === 'income' ? FIN_POS : FIN_NEG, flexShrink: 0, ...tabularNums }}>
                      {tx.type === 'income' ? '+' : '−'}{fmt(tx.amount)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

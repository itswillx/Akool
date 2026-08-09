import { useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { FinanceAccount, FinanceGoal, FinanceGoalContribution, FinanceTransaction } from '../../../types'
import type { FinanceGraph, GraphNode } from '../../../lib/financeGraph'
import { neighborsOf, nodeMonthlySeries, nodeTransactions } from '../../../lib/financeGraph'
import { accountBalance, daysUntil, goalProgress } from '../../../lib/financeCalc'
import { formatBRL } from '../../../lib/money'
import { AreaTrend, DualAreaTrend } from '../../../components/Charts'
import { useLanguage } from '../../../i18n/LanguageContext'
import { badgeStyle, cardSurfaceStyle, sectionCaptionStyle, tabularNums, FIN_NEG, FIN_POS, FIN_WARN } from '../ui/tokens'

// Detalhe do nó selecionado: estatísticas, tendência mensal e ligações. No
// desktop ocupa a coluna direita (no lugar do ranking); no mobile vai dentro
// do Drawer — por isso o componente não conhece onde está montado.

export function NetworkDetailPanel({ node, graph, transactions, allTransactions, contributions, accounts, goals, months, onSelect, onBack }: {
  node: GraphNode
  graph: FinanceGraph
  /** Transações já filtradas (janela/conta/tipo) — base da tendência e stats. */
  transactions: FinanceTransaction[]
  /** Lista completa, para o saldo real da conta (independe dos filtros). */
  allTransactions: FinanceTransaction[]
  contributions: FinanceGoalContribution[]
  accounts: FinanceAccount[]
  goals: FinanceGoal[]
  months: string[]
  onSelect: (nodeId: string) => void
  onBack?: () => void
}) {
  const { t, lang } = useLanguage()
  const [showAllTxs, setShowAllTxs] = useState(false)

  const neighbors = useMemo(() => neighborsOf(graph, node.id), [graph, node.id])
  const txRows = useMemo(
    () => nodeTransactions(node, transactions, contributions),
    [node, transactions, contributions],
  )
  const series = useMemo(
    () => nodeMonthlySeries(node, transactions, contributions, months),
    [node, transactions, contributions, months],
  )
  const monthLabels = useMemo(
    () => months.map(m => {
      const [y, mo] = m.split('-').map(Number)
      return new Date(y, mo - 1, 1).toLocaleDateString(lang, { month: 'short' })
    }),
    [months, lang],
  )

  const account = node.kind === 'account' ? accounts.find(a => a.id === node.refId) : undefined
  const goal = node.kind === 'goal' ? goals.find(g => g.id === node.refId) : undefined
  const progress = goal ? goalProgress(goal.target_amount, node.value) : null
  const deadlineDays = goal ? daysUntil(goal.deadline) : null

  const kindLabel = node.kind === 'account' ? t('finance_network_kind_account')
    : node.kind === 'category' ? t('finance_network_kind_category')
    : t('finance_network_kind_goal')

  const stat = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)', ...tabularNums, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )

  return (
    <div style={{ ...cardSurfaceStyle, padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {onBack && (
        <button onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--color-text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          <ArrowLeft size={13} /> {t('finance_network_back_to_ranking')}
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
          background: `color-mix(in srgb, ${node.color} 18%, var(--color-surface))`, border: `1px solid ${node.color}`,
        }}>
          {node.icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</div>
          <span style={{ ...badgeStyle(node.color), marginTop: 2 }}>{kindLabel}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {stat(t('finance_network_stats_total'), formatBRL(node.value))}
        {stat(t('finance_network_stats_tx_count'), node.txCount)}
        {stat(t('finance_network_stats_links'), neighbors.length)}
        {account && stat(t('finance_network_stats_balance'), formatBRL(accountBalance(account, allTransactions)))}
        {goal && progress && stat(t('finance_network_stats_progress'), `${Math.round(progress.pctRaw)}%`)}
        {goal && deadlineDays != null && stat(
          t('finance_network_stats_deadline'),
          deadlineDays < 0
            ? <span style={{ color: FIN_NEG }}>{t('finance_network_deadline_overdue')}</span>
            : t('finance_network_deadline_days', { n: deadlineDays }),
        )}
      </div>

      {goal && progress && (
        <div style={{ width: '100%', height: 7, borderRadius: 999, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
          <div style={{ width: `${progress.pct}%`, height: '100%', borderRadius: 999, background: progress.pctRaw >= 100 ? FIN_POS : deadlineDays != null && deadlineDays < 0 ? FIN_WARN : node.color }} />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h4 style={sectionCaptionStyle}>{t('finance_network_trend_title')}</h4>
        {node.kind === 'account' ? (
          <DualAreaTrend
            labels={monthLabels}
            height={120}
            formatValue={formatBRL}
            series={[
              { name: t('finance_network_rank_income'), color: FIN_POS, values: series.map(s => s.income) },
              { name: t('finance_network_rank_expenses'), color: FIN_NEG, values: series.map(s => s.expense) },
            ]}
          />
        ) : (
          <AreaTrend
            height={80}
            color={node.color}
            formatValue={formatBRL}
            points={monthLabels.map((label, i) => ({ label, value: series[i].income + series[i].expense }))}
          />
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h4 style={sectionCaptionStyle}>{t('finance_network_transactions')}</h4>
        {txRows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', padding: '4px 0' }}>{t('finance_network_no_tx')}</div>
        ) : (
          <>
            <div style={{
              display: 'flex', flexDirection: 'column',
              maxHeight: showAllTxs ? 320 : undefined, overflowY: showAllTxs ? 'auto' : undefined,
            }}>
              {(showAllTxs ? txRows : txRows.slice(0, 8)).map(row => (
                <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: '1px solid var(--color-border)', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, width: 52, ...tabularNums }}>
                    {new Date(row.date + 'T12:00:00').toLocaleDateString(lang, { day: '2-digit', month: 'short' })}
                  </span>
                  <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {row.description || node.label}
                  </span>
                  <span style={{ fontWeight: 600, color: row.type === 'income' ? FIN_POS : FIN_NEG, flexShrink: 0, ...tabularNums }}>
                    {row.type === 'income' ? '+' : '−'}{formatBRL(row.amount)}
                  </span>
                </div>
              ))}
            </div>
            {txRows.length > 8 && (
              <button onClick={() => setShowAllTxs(v => !v)}
                style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--color-text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}>
                {showAllTxs ? t('finance_network_show_less') : t('finance_network_show_all', { n: txRows.length })}
              </button>
            )}
          </>
        )}
      </div>

      {neighbors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h4 style={sectionCaptionStyle}>{t('finance_network_connections')}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {neighbors.map(({ node: other, edge }) => (
              <button key={other.id} onClick={() => onSelect(other.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: other.color, flexShrink: 0 }} />
                <span style={{ flexShrink: 0 }}>{other.icon}</span>
                <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{other.label}</span>
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, flexShrink: 0, ...tabularNums }}>{formatBRL(edge.weight)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

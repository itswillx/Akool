import { useMemo, useState } from 'react'
import type { FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceTransaction } from '../../../types'
import { categoryNodeId, goalNodeId, rankCategories, rankGoalsByProgress } from '../../../lib/financeGraph'
import { formatBRL } from '../../../lib/money'
import { useLanguage } from '../../../i18n/LanguageContext'
import { cardSurfaceStyle, sectionCaptionStyle, segBtnStyle, segTrackStyle, tabularNums, FIN_NEG, FIN_POS } from '../ui/tokens'

// Ranking lateral: maiores gastos/receitas por categoria e metas por progresso,
// calculado sobre as transações já filtradas — o ranking acompanha os filtros.
// Linhas clicáveis selecionam o nó correspondente no grafo.

type RankMode = 'expenses' | 'income' | 'goals'

export function NetworkRanking({ categories, transactions, goals, contributions, onSelect }: {
  categories: FinanceCategory[]
  transactions: FinanceTransaction[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  onSelect: (nodeId: string) => void
}) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<RankMode>('expenses')

  const catRank = useMemo(
    () => (mode === 'goals' ? [] : rankCategories(categories, transactions, mode === 'expenses' ? 'expense' : 'income', 8)),
    [mode, categories, transactions],
  )
  const goalRank = useMemo(
    () => (mode === 'goals' ? rankGoalsByProgress(goals, contributions).slice(0, 8) : []),
    [mode, goals, contributions],
  )

  const maxTotal = Math.max(1, ...catRank.map(r => r.total))
  const barColor = mode === 'expenses' ? FIN_NEG : FIN_POS

  const row = (key: string, icon: string, label: string, valueText: string, pct: number, color: string, nodeId: string) => (
    <button key={key} onClick={() => onSelect(nodeId)}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, width: '100%' }}>
        <span style={{ flexShrink: 0 }}>{icon}</span>
        <span style={{ color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{label}</span>
        <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, flexShrink: 0, ...tabularNums }}>{valueText}</span>
      </div>
      <div style={{ width: '100%', height: 5, borderRadius: 999, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(2, pct))}%`, height: '100%', borderRadius: 999, background: color }} />
      </div>
    </button>
  )

  return (
    <div style={{ ...cardSurfaceStyle, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 4px' }}>
        <h3 style={sectionCaptionStyle}>{t('finance_network_ranking_title')}</h3>
      </div>
      <div style={{ ...segTrackStyle, alignSelf: 'stretch' }}>
        <button style={segBtnStyle(mode === 'expenses', { wide: true })} onClick={() => setMode('expenses')}>{t('finance_network_rank_expenses')}</button>
        <button style={segBtnStyle(mode === 'income', { wide: true })} onClick={() => setMode('income')}>{t('finance_network_rank_income')}</button>
        <button style={segBtnStyle(mode === 'goals', { wide: true })} onClick={() => setMode('goals')}>{t('finance_network_rank_goals')}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {mode !== 'goals' && catRank.map(r =>
          row(r.category.id, r.category.icon, r.category.name, formatBRL(r.total),
            (r.total / maxTotal) * 100, r.category.color || barColor, categoryNodeId(r.category.id)),
        )}
        {mode === 'goals' && goalRank.map(r =>
          row(r.goal.id, r.goal.icon, r.goal.name, `${Math.round(r.pctRaw)}%`,
            r.pct, r.goal.color, goalNodeId(r.goal.id)),
        )}
        {((mode === 'goals' && goalRank.length === 0) || (mode !== 'goals' && catRank.length === 0)) && (
          <div style={{ padding: '14px 8px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {t('finance_network_no_rank')}
          </div>
        )}
      </div>
    </div>
  )
}

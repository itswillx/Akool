import { Trash2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import type { FinanceInvestment, FinanceInvestmentMovement } from '../../../types'
import { cardSurfaceStyle, tabularNums } from '../ui'
import {
  MOVEMENT_KIND_KEY, badgeStyle, emptyStateStyle, movementColor, movementSign,
} from './investmentsUi'

const fmt = formatBRL

// Flat audit trail, newest first. `description` holds the raw statement line on
// purpose: when a number looks wrong, the answer is almost always in the text
// the bank actually printed.
export function MovementsView({ investments, movements, onDelete }: {
  investments: FinanceInvestment[]
  movements: FinanceInvestmentMovement[]
  onDelete: (id: string) => void
}) {
  const { t } = useLanguage()

  if (movements.length === 0) {
    return <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>{t('finance_invest_no_movements')}</div>
  }

  const positionLabel = (id: string) => {
    const inv = investments.find(i => i.id === id)
    if (!inv) return '—'
    return [inv.institution, inv.product].filter(Boolean).join(' · ')
  }

  const sorted = [...movements].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div style={{ ...cardSurfaceStyle, padding: 0, overflow: 'hidden' }}>
      {sorted.map((mov, i) => (
        <div key={mov.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap',
          borderBottom: i === sorted.length - 1 ? 'none' : '1px solid var(--color-border)',
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
            {mov.date.split('-').reverse().join('/')}
          </span>
          <span style={{ flex: 1, minWidth: 140 }}>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mov.description || t(MOVEMENT_KIND_KEY[mov.kind])}
            </span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)' }}>
              {positionLabel(mov.investment_id)}
            </span>
          </span>
          <span style={badgeStyle(movementColor(mov.kind))}>{t(MOVEMENT_KIND_KEY[mov.kind])}</span>
          <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, color: movementColor(mov.kind), ...tabularNums }}>
            {movementSign(mov.kind)}{fmt(mov.amount)}
          </span>
          <button
            onClick={() => onDelete(mov.id)}
            title={t('finance_invest_delete_movement')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 3, flexShrink: 0 }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

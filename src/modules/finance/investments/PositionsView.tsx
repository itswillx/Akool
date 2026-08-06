import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { positionBreakdown } from '../../../lib/financeInvestmentCalc'
import type { FinanceAccount, FinanceInvestment, FinanceInvestmentMovement } from '../../../types'
import { cardSurfaceStyle, ghostBtnStyle, tabularNums, FIN_NEG, FIN_POS, FIN_WARN } from '../ui'
import {
  ASSET_CLASS_ICON, ASSET_CLASS_KEY, MOVEMENT_KIND_KEY,
  badgeStyle, emptyStateStyle, movementColor, movementSign,
} from './investmentsUi'

const fmt = formatBRL

// One row per position, expandable into its breakdown and last movements.
// Everything shown is derived from the movements — there is no stored balance
// that could drift away from them.
export function PositionsView({ investments, movements, accounts, onEdit }: {
  investments: FinanceInvestment[]
  movements: FinanceInvestmentMovement[]
  accounts: FinanceAccount[]
  onEdit: (position: FinanceInvestment) => void
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (investments.length === 0) {
    return <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>{t('finance_invest_empty')}</div>
  }

  const accountName = (id: string | null) =>
    accounts.find(a => a.id === id)?.name ?? t('finance_invest_no_account')

  const detail = (label: string, value: string, color = 'var(--color-text)') => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: 'var(--color-text-subtle)' }}>{label}</span>
      <span style={{ fontWeight: 600, color, ...tabularNums }}>{value}</span>
    </div>
  )

  return (
    <div style={{ ...cardSurfaceStyle, padding: 0, overflow: 'hidden' }}>
      {investments.map((inv, i) => {
        const b = positionBreakdown(inv, movements)
        const open = expanded === inv.id
        const recent = movements
          .filter(m => m.investment_id === inv.id)
          .sort((a, b2) => b2.date.localeCompare(a.date))
          .slice(0, 5)
        return (
          <div key={inv.id} style={{ borderBottom: i === investments.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
            <button
              onClick={() => setExpanded(open ? null : inv.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 14px',
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                opacity: inv.archived ? 0.55 : 1,
              }}
            >
              <span style={{ fontSize: 17, flexShrink: 0 }}>{ASSET_CLASS_ICON[inv.asset_class]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[inv.institution, inv.product].filter(Boolean).join(' · ')}
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                  {t(ASSET_CLASS_KEY[inv.asset_class])} · {b.movementCount === 1
                    ? t('finance_invest_movement_count', { n: b.movementCount })
                    : t('finance_invest_movement_count_plural', { n: b.movementCount })}
                </span>
              </span>
              {inv.archived && <span style={badgeStyle('var(--color-text-muted)')}>{t('finance_invest_archived')}</span>}
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0, ...tabularNums }}>{fmt(b.applied)}</span>
              <span style={{ display: 'flex', flexShrink: 0, color: 'var(--color-text-muted)' }}>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
            </button>

            {open && (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  {inv.opening_balance !== 0 && detail(t('finance_invest_opening_balance'), fmt(inv.opening_balance))}
                  {detail(t('finance_invest_contributed'), fmt(b.contributed), FIN_NEG)}
                  {detail(t('finance_invest_redeemed'), fmt(b.redeemed), FIN_POS)}
                  {detail(t('finance_invest_kind_yield'), fmt(b.earned), FIN_POS)}
                  {detail(t('finance_invest_costs'), fmt(b.costs), FIN_WARN)}
                  {detail(t('finance_invest_account'), accountName(inv.account_id), 'var(--color-text-muted)')}
                </div>

                {recent.length > 0 && (
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    {recent.map((mov, j) => (
                      <div key={mov.id} style={{
                        display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
                        borderBottom: j === recent.length - 1 ? 'none' : '1px solid var(--color-border)',
                      }}>
                        <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                          {mov.date.slice(8)}/{mov.date.slice(5, 7)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mov.description || t(MOVEMENT_KIND_KEY[mov.kind])}
                        </span>
                        <span style={badgeStyle(movementColor(mov.kind))}>{t(MOVEMENT_KIND_KEY[mov.kind])}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0, color: movementColor(mov.kind), ...tabularNums }}>
                          {movementSign(mov.kind)}{fmt(mov.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => onEdit(inv)} style={{ ...ghostBtnStyle, alignSelf: 'flex-start' }}>
                  <Pencil size={14} /> {t('finance_invest_edit_position')}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

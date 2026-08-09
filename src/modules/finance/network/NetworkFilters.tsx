import { Search } from 'lucide-react'
import type { FinanceAccount } from '../../../types'
import type { GraphFilters } from '../../../lib/financeGraph'
import { formatBRL } from '../../../lib/money'
import { useLanguage } from '../../../i18n/LanguageContext'
import { DualRange } from '../../../components/DualRange'
import { cardSurfaceStyle, inputStyle, segBtnStyle, segTrackStyle } from '../ui/tokens'

// Barra de filtros do grafo: busca, período, tipo, conta e faixa de valores.
// Estado mora no NetworkTab; aqui só render + onChange.

const PERIODS: GraphFilters['months'][] = [1, 3, 6, 12]

export function NetworkFilters({ filters, onChange, accounts, bounds }: {
  filters: GraphFilters
  onChange: (next: GraphFilters) => void
  accounts: FinanceAccount[]
  bounds: { min: number; max: number }
}) {
  const { t } = useLanguage()

  const typeBtn = (value: GraphFilters['txType'], label: string) => (
    <button style={segBtnStyle(filters.txType === value)} onClick={() => onChange({ ...filters, txType: value })}>
      {label}
    </button>
  )

  return (
    <div style={{ ...cardSurfaceStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
      <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160, maxWidth: 280 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
        <input
          style={{ ...inputStyle, paddingLeft: 30 }}
          placeholder={t('finance_network_search_placeholder')}
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      <div style={segTrackStyle}>
        {PERIODS.map(m => (
          <button key={m} style={segBtnStyle(filters.months === m)} onClick={() => onChange({ ...filters, months: m })}>
            {t(`finance_network_period_${m}m` as const)}
          </button>
        ))}
      </div>

      <div style={segTrackStyle}>
        {typeBtn('all', t('finance_network_type_all'))}
        {typeBtn('income', t('finance_network_rank_income'))}
        {typeBtn('expense', t('finance_network_rank_expenses'))}
      </div>

      <select
        style={{ ...inputStyle, width: 'auto', minWidth: 130, cursor: 'pointer' }}
        value={filters.accountId ?? ''}
        onChange={e => onChange({ ...filters, accountId: e.target.value || null })}
      >
        <option value="">{t('finance_network_all_accounts')}</option>
        {accounts.map(a => (
          <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
        ))}
      </select>

      <DualRange
        label={t('finance_network_value_range')}
        bounds={bounds}
        min={filters.minValue}
        max={filters.maxValue}
        onChange={(minValue, maxValue) => onChange({ ...filters, minValue, maxValue })}
        format={formatBRL}
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { TranslationKey } from '../../../i18n/translations'
import type { FinanceAccount, FinanceInvestment, FinanceInvestmentMovement } from '../../../types'
import { segBtnStyle, segTrackStyle } from '../ui'
import { InvestmentsOverview } from './InvestmentsOverview'
import { MovementsView } from './MovementsView'
import { PositionModal } from './PositionModal'
import { PositionsView } from './PositionsView'
import { useInvestmentMutations } from './useInvestmentMutations'

type Section = 'overview' | 'positions' | 'movements'

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: 'overview', key: 'finance_invest_nav_overview' },
  { id: 'positions', key: 'finance_invest_nav_positions' },
  { id: 'movements', key: 'finance_invest_nav_movements' },
]

// Which section is open survives a reload, like the finance tab itself.
const SECTION_KEY = 'finance_investments_section'

function isSection(value: unknown): value is Section {
  return typeof value === 'string' && SECTIONS.some(s => s.id === value)
}

// Entry point of the Investimentos submodule.
//
// Unlike the Obras and Loja tabs, this one does NOT fetch: FinancePanel already
// loads positions and movements because every account balance depends on them.
// Taking them as props keeps a single copy, so the balance in the sidebar and
// the applied total in here can never disagree.
export default function FinanceInvestmentsTab({
  investments, movements, accounts, month, onChanged,
}: {
  investments: FinanceInvestment[]
  movements: FinanceInvestmentMovement[]
  accounts: FinanceAccount[]
  month: string
  onChanged: () => Promise<void> | void
}) {
  const { t } = useLanguage()
  const mutations = useInvestmentMutations(onChanged)
  const [section, setSection] = useState<Section>(() => {
    const saved = localStorage.getItem(SECTION_KEY)
    return isSection(saved) ? saved : 'overview'
  })
  useEffect(() => { localStorage.setItem(SECTION_KEY, section) }, [section])

  const [editing, setEditing] = useState<FinanceInvestment | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {mutations.error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: 'var(--color-error)', fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>{mutations.error}</span>
          <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', padding: 2, flexShrink: 0 }}
            onClick={mutations.clearError}>
            <X size={14} />
          </button>
        </div>
      )}

      <div style={segTrackStyle}>
        {SECTIONS.map(s => (
          <button key={s.id} style={segBtnStyle(section === s.id)} onClick={() => setSection(s.id)}>
            {t(s.key)}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <InvestmentsOverview investments={investments} movements={movements} month={month} />
      )}
      {section === 'positions' && (
        <PositionsView investments={investments} movements={movements} accounts={accounts} onEdit={setEditing} />
      )}
      {section === 'movements' && (
        <MovementsView investments={investments} movements={movements} onDelete={mutations.deleteMovement} />
      )}

      {editing && (
        <PositionModal
          position={editing}
          accounts={accounts}
          onSave={draft => mutations.savePosition(editing, draft)}
          onDelete={() => mutations.deletePosition(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

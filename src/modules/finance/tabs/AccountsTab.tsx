// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Pencil, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { activateProps } from '../../../lib/a11y'
import {
balancesByAccount,
type FinanceTxAgg
} from '../../../lib/financeCalc'
import type { FinanceAccount } from '../../../types'
import { fmt } from '../financeFormat'
import {
FIN_NEG,
FIN_POS
} from '../ui'

// ─── Accounts Tab ─────────────────────────────────────────────────────────────

export function AccountsTab({ accounts, transactions, onAdd, onEdit }: {
  accounts: FinanceAccount[]
  transactions: FinanceTxAgg[]
  onAdd: () => void
  onEdit: (acc: FinanceAccount) => void
}) {
  const { t } = useLanguage()

  // PERF-005: todos os saldos numa passada (antes, um filtro por conta).
  const balances = useMemo(() => balancesByAccount(accounts, transactions), [accounts, transactions])
  const accBalance = (acc: FinanceAccount) => balances.get(acc.id) ?? acc.initial_balance

  const typeLabel: Record<string, string> = {
    checking: t('finance_account_type_checking'),
    savings: t('finance_account_type_savings'),
    credit: t('finance_account_type_credit'),
    cash: t('finance_account_type_cash'),
  }

  const totalBalance = accounts.reduce((sum, acc) => sum + accBalance(acc), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {accounts.length > 0 && (
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            {t('finance_balance_total')}: <strong style={{ color: totalBalance >= 0 ? FIN_POS : FIN_NEG }}>{fmt(totalBalance)}</strong>
          </div>
        )}
        <button onClick={onAdd}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_new_account')}
        </button>
      </div>

      {accounts.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 0' }}>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center' }}>{t('finance_no_accounts')}</p>
          {/* UX-012: ação no estado vazio */}
          <button type="button" onClick={onAdd}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {t('finance_cta_new_account')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {accounts.map(acc => {
            const bal = accBalance(acc)
            return (
              <div key={acc.id} {...activateProps(() => onEdit(acc))} onClick={() => onEdit(acc)}
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', borderTop: `4px solid ${acc.color}`, transition: 'background-color 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>{acc.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {acc.name}
                      {acc.workspace_id && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-subtle)', background: 'var(--color-active)', borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>
                          <Users size={10} />{t('finance_scope_workspace')}
                        </span>
                      )}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>{typeLabel[acc.type]}</p>
                  </div>
                  <Pencil size={12} style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', flexShrink: 0 }} />
                </div>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: bal >= 0 ? FIN_POS : FIN_NEG }}>{fmt(bal)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

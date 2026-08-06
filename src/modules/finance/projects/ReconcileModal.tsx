import { useEffect, useMemo, useState } from 'react'
import { Link2, Link2Off, Search } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { reconcileCandidates } from '../../../lib/financeProjectCalc'
import type { FinanceProject, FinanceProjectExpense, FinanceTransaction } from '../../../types'
import { Modal, ghostBtnStyle, primaryBtnStyle, tabularNums, FIN_POS, FIN_WARN } from '../ui'
import { emptyStateStyle } from './projectsUi'

// Links works expenses that were entered by hand to the transactions the
// statement import created for the same payments.
//
// A works expense never generates a transaction on its own, so once the
// statement is imported the same money exists as two records with nothing
// connecting them — the works total and the month's expenses both describe it.
// Linking does not delete anything: the transaction stays the single cash-flow
// truth, and the expense becomes its works context.

export function ReconcileModal({ project, expenses, onLink, onClose }: {
  project: FinanceProject
  expenses: FinanceProjectExpense[]
  onLink: (expenseId: string, transactionId: string | null) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [transactions, setTransactions] = useState<FinanceTransaction[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('finance_transactions').select('id,date,amount,type,description').then(({ data }) => {
      if (!cancelled) setTransactions((data as FinanceTransaction[]) ?? [])
    })
    return () => { cancelled = true }
  }, [])

  // Every transaction already spoken for, so two expenses cannot claim the
  // same one. Built from the full expense list, not just this project's.
  const claimed = useMemo(
    () => new Set(expenses.flatMap(e => (e.transaction_id ? [e.transaction_id] : []))),
    [expenses],
  )

  const projectExpenses = expenses.filter(e => e.project_id === project.id)
  const unlinked = projectExpenses.filter(e => !e.transaction_id)
  const linked = projectExpenses.filter(e => e.transaction_id)

  const link = async (expenseId: string, transactionId: string | null) => {
    setBusy(expenseId)
    try { await onLink(expenseId, transactionId) } finally { setBusy(null) }
  }

  const body = () => {
    if (transactions === null) {
      return <div style={emptyStateStyle}>{t('finance_loading')}</div>
    }
    if (unlinked.length === 0 && linked.length === 0) {
      return <div style={emptyStateStyle}>{t('finance_proj_expenses_empty')}</div>
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {t('finance_reconcile_hint')}
        </p>

        {unlinked.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: FIN_POS }}>
            <Link2 size={15} /> {t('finance_reconcile_all_done')}
          </div>
        ) : (
          unlinked.map(e => {
            const candidates = reconcileCandidates(e, transactions, claimed)
            return (
              <div key={e.id} style={{ border: '1px solid var(--color-border)', borderRadius: 9, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--color-bg-secondary)' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                    {e.date.split('-').reverse().join('/')}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, ...tabularNums }}>{formatBRL(e.amount)}</span>
                </div>

                {candidates.length === 0 ? (
                  <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Search size={13} style={{ flexShrink: 0 }} />
                    {t('finance_reconcile_no_candidates')}
                  </div>
                ) : (
                  candidates.map((c, i) => (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', flexWrap: 'wrap',
                      borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                    }}>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                        {c.date.split('-').reverse().join('/')}
                      </span>
                      <span style={{ flex: 1, minWidth: 120, fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.description}
                      </span>
                      <button
                        onClick={() => link(e.id, c.id)}
                        disabled={busy === e.id}
                        style={{ ...primaryBtnStyle, padding: '5px 10px', fontSize: 12, opacity: busy === e.id ? 0.6 : 1 }}
                      >
                        <Link2 size={13} /> {t('finance_reconcile_link')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )
          })
        )}

        {linked.length > 0 && (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>
              {t('finance_reconcile_linked_section')}
            </div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 9 }}>
              {linked.map((e, i) => (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px',
                  borderBottom: i === linked.length - 1 ? 'none' : '1px solid var(--color-border)',
                }}>
                  <Link2 size={13} style={{ color: FIN_POS, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.description}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, flexShrink: 0, ...tabularNums }}>{formatBRL(e.amount)}</span>
                  <button
                    onClick={() => link(e.id, null)}
                    disabled={busy === e.id}
                    title={t('finance_reconcile_unlink')}
                    style={{ ...ghostBtnStyle, padding: '4px 8px', fontSize: 12, color: FIN_WARN }}
                  >
                    <Link2Off size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Modal title={t('finance_reconcile_title')} onClose={onClose} width={620}>
      {body()}
    </Modal>
  )
}

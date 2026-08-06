import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { saleNetReceived } from '../../../lib/financeStoreCalc'
import type { FinanceCategory, FinanceStoreSale } from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import type { ConfirmAction } from './saleTransitions'
import { todayISO, type FinanceStoreStore } from './useFinanceStore'

// Confirmação das transições com efeito colateral: vender (pode abrir a receita
// vinculada, com data escolhida), cancelar/reabrir (remove a receita, o estoque
// volta por derivação) e criar a receita depois do fato.
//
// Movido do SalesView sem alterar o comportamento, para que a lista e o kanban
// usem o mesmo modal — duplicá-lo seria duplicar a escrita em
// `finance_transactions`.
export function StatusConfirmModal({ store, sale, action, categories, onClose, onResolved }: {
  store: FinanceStoreStore
  sale: FinanceStoreSale
  action: ConfirmAction
  categories: FinanceCategory[]
  onClose: () => void
  /** true = confirmou, false = desistiu. O kanban usa isto para reverter o
   *  preview otimista do card; a lista ignora. */
  onResolved?: (confirmed: boolean) => void
}) {
  const { t } = useLanguage()
  const items = store.saleItems.filter(i => i.sale_id === sale.id)
  const net = saleNetReceived(sale, items)
  const [createTx, setCreateTx] = useState(!!sale.account_id)
  const [date, setDate] = useState(sale.sold_on ?? todayISO())
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)

  const txDescription = t('finance_store_tx_sale_desc', { items: items.map(i => i.product_name).join(', ') })

  const dismiss = () => {
    onResolved?.(false)
    onClose()
  }

  const confirm = async () => {
    setBusy(true)
    try {
      if (action === 'sold') {
        await store.setSaleStatus(sale.id, 'sold', { createTransaction: createTx, description: txDescription, date, categoryId: categoryId || null })
      } else if (action === 'cancelled') {
        await store.setSaleStatus(sale.id, 'cancelled')
      } else if (action === 'reopen') {
        await store.setSaleStatus(sale.id, 'negotiating')
      } else {
        await store.generateSaleIncome(sale.id, txDescription, categoryId || null)
      }
      onResolved?.(true)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // Without a category the income counts in the month's totals but is invisible
  // to "top categories" and to the budgets.
  const categorySelect = (
    <div>
      <label style={labelStyle}>{t('finance_store_tx_category')}</label>
      <select style={inputStyle} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
        <option value="">{t('finance_import_no_category')}</option>
        {categories.filter(c => c.type === 'income').map(c => (
          <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
        ))}
      </select>
      <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
        {t('finance_store_tx_category_hint')}
      </div>
    </div>
  )

  const title = action === 'sold' ? t('finance_store_mark_sold')
    : action === 'cancelled' ? t('finance_store_cancel_sale')
    : action === 'reopen' ? t('finance_store_revert_status')
    : t('finance_store_generate_income')

  return (
    <Modal title={title} onClose={dismiss}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {action === 'sold' && (
          <>
            <div style={{ fontSize: 13.5, color: 'var(--color-text)', ...tabularNums }}>
              {t('finance_store_sold_confirm', { value: formatBRL(net) })}
            </div>
            <div>
              <label style={labelStyle}>{t('finance_store_sold_on')}</label>
              <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={createTx} disabled={!sale.account_id}
                onChange={e => setCreateTx(e.target.checked)} />
              {t('finance_store_create_income')}
            </label>
            {createTx && categorySelect}
            {!sale.account_id && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_store_no_account_hint')}</div>
            )}
          </>
        )}
        {action === 'cancelled' && (
          <div style={{ fontSize: 13.5, color: 'var(--color-text)' }}>
            {sale.transaction_id
              ? t('finance_store_cancel_warning_tx', { value: formatBRL(net) })
              : t('finance_store_cancel_warning')}
          </div>
        )}
        {action === 'reopen' && (
          <div style={{ fontSize: 13.5, color: 'var(--color-text)' }}>
            {t('finance_store_reopen_warning', { value: formatBRL(net) })}
          </div>
        )}
        {action === 'income' && (
          <>
            <div style={{ fontSize: 13.5, color: 'var(--color-text)', ...tabularNums }}>
              {t('finance_store_income_confirm', { value: formatBRL(net) })}
            </div>
            {categorySelect}
          </>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: busy ? 0.7 : 1 }}
            onClick={confirm} disabled={busy}>{title}</button>
          <button style={ghostBtnStyle} onClick={dismiss}>{t('finance_cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

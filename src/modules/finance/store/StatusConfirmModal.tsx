import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { saleNetReceived } from '../../../lib/financeStoreCalc'
import type { FinanceCategory, FinanceStoreSale } from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import type { ConfirmAction } from './saleTransitions'
import { saleDateMax } from './saleDates'
import { todayISO, type FinanceStoreStore } from './useFinanceStore'

// Confirmação das transições com efeito colateral: vender (pode abrir a receita
// vinculada, com data escolhida), cancelar/reabrir (remove a receita, o estoque
// volta por derivação) e criar a receita depois do fato.
//
// Movido do SalesView sem alterar o comportamento, para que a lista e o kanban
// usem o mesmo modal — duplicá-lo seria duplicar a escrita em
// `finance_transactions`.
//
// API-028: a transição e a receita são uma RPC só (store_sale_set_status ou
// store_sale_generate_income). O servidor recusa receita com líquido <= 0
// (finance_transactions só aceita valor > 0), então "Criar receita" fica
// desligado com a dica, e a data vai até amanhã. onResolved recebe o resultado
// real: false quando o servidor recusou, para o kanban reverter o card.
export function StatusConfirmModal({ store, sale, action, categories, onClose, onResolved }: {
  store: FinanceStoreStore
  sale: FinanceStoreSale
  action: ConfirmAction
  categories: FinanceCategory[]
  onClose: () => void
  /** true = o servidor aplicou; false = desistiu ou o servidor recusou. O
   *  kanban usa isto para reverter o preview do card; a lista, para mostrar o
   *  erro na linha. */
  onResolved?: (confirmed: boolean) => void
}) {
  const { t } = useLanguage()
  const items = store.saleItems.filter(i => i.sale_id === sale.id)
  const net = saleNetReceived(sale, items)
  // Sem conta ou com líquido <= 0 não há receita para lançar.
  const canIncome = !!sale.account_id && net > 0
  const [createTx, setCreateTx] = useState(canIncome)
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
      let ok: boolean
      if (action === 'sold') {
        ok = await store.setSaleStatus(sale.id, 'sold', {
          createTransaction: createTx && canIncome, description: txDescription, date, categoryId: categoryId || null,
        })
      } else if (action === 'cancelled') {
        ok = await store.setSaleStatus(sale.id, 'cancelled')
      } else if (action === 'reopen') {
        ok = await store.setSaleStatus(sale.id, 'negotiating')
      } else {
        ok = await store.generateSaleIncome(sale.id, txDescription, categoryId || null)
      }
      onResolved?.(ok)
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

  // Vender sem data, ou lançar receita sem líquido, o servidor recusaria.
  const blocked = (action === 'sold' && !date) || (action === 'income' && !canIncome)

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
              <input style={inputStyle} type="date" value={date} max={saleDateMax()} required onChange={e => setDate(e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: canIncome ? 'pointer' : 'not-allowed' }}>
              <input type="checkbox" checked={createTx && canIncome} disabled={!canIncome}
                onChange={e => setCreateTx(e.target.checked)} />
              {t('finance_store_create_income')}
            </label>
            {createTx && canIncome && categorySelect}
            {!sale.account_id && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_store_no_account_hint')}</div>
            )}
            {!!sale.account_id && net <= 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_store_net_not_positive_hint')}</div>
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
            {net <= 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_store_net_not_positive_hint')}</div>
            )}
            {categorySelect}
          </>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: busy || blocked ? 0.7 : 1 }}
            onClick={confirm} disabled={busy || blocked}>{title}</button>
          <button style={ghostBtnStyle} onClick={dismiss}>{t('finance_cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

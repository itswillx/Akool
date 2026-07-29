import { useState } from 'react'
import { Plus, ShoppingBag, Undo2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { saleNetReceived, saleProfit } from '../../../lib/financeStoreCalc'
import type { FinanceStoreSale, FinanceStoreSaleStatus } from '../../../types'
import { Modal, FIN_NEG, FIN_POS, cardSurfaceStyle, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, segBtnStyle, segTrackStyle, tabularNums } from '../ui'
import { CHANNEL_KEY, SALE_STATUSES, SALE_STATUS_KEY, badgeStyle, emptyStateStyle, saleStatusColor } from './storeUi'
import { todayISO, type FinanceStoreStore } from './useFinanceStore'

// Forward and backward steps of the pipeline. Cancellation is offered
// separately while the sale has not been delivered.
const NEXT_STATUS: Partial<Record<FinanceStoreSaleStatus, FinanceStoreSaleStatus>> = {
  negotiating: 'sold',
  sold: 'shipped',
  shipped: 'delivered',
}
const PREV_STATUS: Partial<Record<FinanceStoreSaleStatus, FinanceStoreSaleStatus>> = {
  sold: 'negotiating',
  shipped: 'sold',
  delivered: 'shipped',
  cancelled: 'negotiating',
}

const NEXT_LABEL: Record<'sold' | 'shipped' | 'delivered', 'finance_store_mark_sold' | 'finance_store_mark_shipped' | 'finance_store_mark_delivered'> = {
  sold: 'finance_store_mark_sold',
  shipped: 'finance_store_mark_shipped',
  delivered: 'finance_store_mark_delivered',
}

type ConfirmAction = 'sold' | 'cancelled' | 'reopen' | 'income'

// Confirmation step for the transitions with side effects: selling (may open
// the linked income, with a pickable date), cancelling/reopening (removes it,
// stock returns) and creating the income after the fact.
function StatusConfirmModal({ store, sale, action, onClose }: {
  store: FinanceStoreStore
  sale: FinanceStoreSale
  action: ConfirmAction
  onClose: () => void
}) {
  const { t } = useLanguage()
  const items = store.saleItems.filter(i => i.sale_id === sale.id)
  const net = saleNetReceived(sale, items)
  const [createTx, setCreateTx] = useState(!!sale.account_id)
  const [date, setDate] = useState(sale.sold_on ?? todayISO())
  const [busy, setBusy] = useState(false)

  const txDescription = t('finance_store_tx_sale_desc', { items: items.map(i => i.product_name).join(', ') })

  const confirm = async () => {
    setBusy(true)
    try {
      if (action === 'sold') {
        await store.setSaleStatus(sale.id, 'sold', { createTransaction: createTx, description: txDescription, date })
      } else if (action === 'cancelled') {
        await store.setSaleStatus(sale.id, 'cancelled')
      } else if (action === 'reopen') {
        await store.setSaleStatus(sale.id, 'negotiating')
      } else {
        await store.generateSaleIncome(sale.id, txDescription)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const title = action === 'sold' ? t('finance_store_mark_sold')
    : action === 'cancelled' ? t('finance_store_cancel_sale')
    : action === 'reopen' ? t('finance_store_revert_status')
    : t('finance_store_generate_income')

  return (
    <Modal title={title} onClose={onClose}>
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
          <div style={{ fontSize: 13.5, color: 'var(--color-text)', ...tabularNums }}>
            {t('finance_store_income_confirm', { value: formatBRL(net) })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: busy ? 0.7 : 1 }}
            onClick={confirm} disabled={busy}>{title}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

// Sales pipeline: filterable list of sale cards with forward/backward status
// actions and a late "create income" escape hatch.
export function SalesView({ store, onNew, onEdit }: {
  store: FinanceStoreStore
  onNew: () => void
  onEdit: (sale: FinanceStoreSale) => void
}) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState<FinanceStoreSaleStatus | 'all'>('all')
  const [confirming, setConfirming] = useState<{ sale: FinanceStoreSale; action: ConfirmAction } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const visible = store.sales.filter(s => filter === 'all' || s.status === filter)

  const runDirect = async (sale: FinanceStoreSale, status: FinanceStoreSaleStatus) => {
    setBusyId(sale.id)
    try { await store.setSaleStatus(sale.id, status) } finally { setBusyId(null) }
  }

  const advance = (sale: FinanceStoreSale) => {
    const next = NEXT_STATUS[sale.status]
    if (!next) return
    if (next === 'sold') setConfirming({ sale, action: 'sold' })
    else runDirect(sale, next)
  }

  // Stepping back destroys the linked income only when the sale reopens to
  // negotiating — that one asks; the intermediate steps are instant.
  const revert = (sale: FinanceStoreSale) => {
    const prev = PREV_STATUS[sale.status]
    if (!prev) return
    if (prev === 'negotiating' && sale.transaction_id) setConfirming({ sale, action: 'reopen' })
    else runDirect(sale, prev)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        {/* Six options never fit a 375px track: scroll, don't wrap. */}
        <div className="finance-hide-scrollbar"
          style={{ ...segTrackStyle, flex: 1, minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <button style={segBtnStyle(filter === 'all')} onClick={() => setFilter('all')}>{t('finance_store_filter_all')}</button>
          {SALE_STATUSES.map(s => (
            <button key={s} style={segBtnStyle(filter === s)} onClick={() => setFilter(s)}>{t(SALE_STATUS_KEY[s])}</button>
          ))}
        </div>
        <button style={{ ...primaryBtnStyle, flexShrink: 0 }} onClick={onNew}><Plus size={15} />{t('finance_store_new_sale')}</button>
      </div>

      <div style={cardSurfaceStyle}>
        {visible.length === 0 && (
          <div style={emptyStateStyle}>
            <ShoppingBag size={22} style={{ marginBottom: 6, opacity: 0.6 }} />
            <div style={{ marginBottom: 12 }}>{t('finance_store_no_sales')}</div>
            <button style={primaryBtnStyle} onClick={onNew}><Plus size={15} />{t('finance_store_new_sale')}</button>
          </div>
        )}
        {visible.map((sale, index) => {
          const items = store.saleItems.filter(i => i.sale_id === sale.id)
          const customer = sale.customer_id ? store.customers.find(c => c.id === sale.customer_id) : null
          const profit = saleProfit(sale, items)
          const next = NEXT_STATUS[sale.status]
          const busy = busyId === sale.id
          const summary = items.map(i => `${i.quantity}× ${i.product_name}`).join(', ')
          const canIncome = (sale.status === 'sold' || sale.status === 'shipped' || sale.status === 'delivered')
            && !sale.transaction_id && !!sale.account_id
          return (
            <div key={sale.id}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '11px 14px', cursor: 'pointer', opacity: busy ? 0.6 : 1, borderBottom: index === visible.length - 1 ? 'none' : '1px solid var(--color-border)' }}
              onClick={() => onEdit(sale)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {summary || t('finance_store_sale')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {customer?.name ?? t('finance_store_no_customer')}
                    {sale.sold_on ? ` · ${sale.sold_on.slice(8, 10)}/${sale.sold_on.slice(5, 7)}/${sale.sold_on.slice(0, 4)}` : ''}
                  </div>
                </div>
                {/* Projection while negotiating, fact once sold, noise once cancelled. */}
                {sale.status !== 'cancelled' && (
                  <div style={{ textAlign: 'right', flexShrink: 0, ...tabularNums }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: sale.status === 'negotiating' ? 'var(--color-text-muted)' : profit >= 0 ? FIN_POS : FIN_NEG }}>
                      {formatBRL(profit)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                      {sale.status === 'negotiating' ? t('finance_store_profit_projected') : t('finance_store_profit')}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={badgeStyle(saleStatusColor(sale.status))}>{t(SALE_STATUS_KEY[sale.status])}</span>
                <span style={badgeStyle('var(--color-text-muted)')}>{t(CHANNEL_KEY[sale.channel])}</span>
                {sale.tracking_code && <span style={badgeStyle('var(--color-text-muted)')}>{sale.tracking_code}</span>}
                {sale.expected_delivery_on && sale.status !== 'delivered' && sale.status !== 'cancelled' && (
                  <span style={badgeStyle('var(--color-text-muted)')}>
                    {t('finance_store_eta_short', { date: `${sale.expected_delivery_on.slice(8, 10)}/${sale.expected_delivery_on.slice(5, 7)}` })}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {canIncome && (
                  <button style={{ ...ghostBtnStyle, padding: '5px 10px', fontSize: 12 }} disabled={busy}
                    onClick={e => { e.stopPropagation(); setConfirming({ sale, action: 'income' }) }}>
                    {t('finance_store_generate_income')}
                  </button>
                )}
                {next && (
                  <button style={{ ...ghostBtnStyle, padding: '5px 10px', fontSize: 12 }} disabled={busy}
                    onClick={e => { e.stopPropagation(); advance(sale) }}>
                    {t(NEXT_LABEL[next as 'sold' | 'shipped' | 'delivered'])}
                  </button>
                )}
                {PREV_STATUS[sale.status] && (
                  <button style={{ ...ghostBtnStyle, padding: '5px 10px', fontSize: 12 }} disabled={busy}
                    title={t('finance_store_revert_status')}
                    onClick={e => { e.stopPropagation(); revert(sale) }}>
                    <Undo2 size={13} />
                  </button>
                )}
                {(sale.status === 'negotiating' || sale.status === 'sold' || sale.status === 'shipped') && (
                  <button style={{ ...ghostBtnStyle, padding: '5px 10px', fontSize: 12, color: 'var(--color-error)' }} disabled={busy}
                    onClick={e => { e.stopPropagation(); setConfirming({ sale, action: 'cancelled' }) }}>
                    {t('finance_store_cancel_sale')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {confirming && (
        <StatusConfirmModal store={store} sale={confirming.sale} action={confirming.action}
          onClose={() => setConfirming(null)} />
      )}
    </div>
  )
}

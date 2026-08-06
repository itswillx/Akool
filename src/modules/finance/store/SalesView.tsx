import { useState } from 'react'
import { LayoutGrid, List as ListIcon, Plus, ShoppingBag, Undo2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { formatBRL } from '../../../lib/money'
import { saleProfit } from '../../../lib/financeStoreCalc'
import type { FinanceCategory, FinanceStoreSale, FinanceStoreSaleStatus } from '../../../types'
import { FIN_NEG, FIN_POS, cardSurfaceStyle, ghostBtnStyle, primaryBtnStyle, segBtnStyle, segTrackStyle, tabularNums } from '../ui'
import { CHANNEL_KEY, SALE_STATUSES, SALE_STATUS_KEY, badgeStyle, emptyStateStyle, saleStatusColor } from './storeUi'
import { SalesBoard } from './SalesBoard'
import { StatusConfirmModal } from './StatusConfirmModal'
import { NEXT_LABEL, NEXT_STATUS, PREV_STATUS, confirmActionFor, type ConfirmAction } from './saleTransitions'
import type { FinanceStoreStore } from './useFinanceStore'

// Pipeline de vendas em duas leituras: quadro (kanban de etapas, o padrão) e
// lista filtrável. As transições de status são as mesmas nos dois — moram em
// `saleTransitions.ts` e o modal de confirmação em `StatusConfirmModal.tsx`.

type SalesMode = 'board' | 'list'

const MODE_KEY = 'finance_store_sales_mode'

export function SalesView({ store, categories, onNew, onEdit }: {
  store: FinanceStoreStore
  categories: FinanceCategory[]
  onNew: () => void
  onEdit: (sale: FinanceStoreSale) => void
}) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<SalesMode>(() =>
    localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'board')
  const [filter, setFilter] = useState<FinanceStoreSaleStatus | 'all'>('all')
  const [confirming, setConfirming] = useState<{ sale: FinanceStoreSale; action: ConfirmAction } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const selectMode = (next: SalesMode) => {
    setMode(next)
    localStorage.setItem(MODE_KEY, next)
  }

  const visible = store.sales.filter(s => filter === 'all' || s.status === filter)

  const runDirect = async (sale: FinanceStoreSale, status: FinanceStoreSaleStatus) => {
    setBusyId(sale.id)
    try { await store.setSaleStatus(sale.id, status) } finally { setBusyId(null) }
  }

  // Avançar e voltar consultam a mesma tabela que o kanban: uma transição só
  // pede confirmação quando mexe em finance_transactions.
  const request = (sale: FinanceStoreSale, to: FinanceStoreSaleStatus) => {
    const action = confirmActionFor(sale.status, to, !!sale.transaction_id)
    if (action) setConfirming({ sale, action })
    else runDirect(sale, to)
  }

  const modeToggle = (
    <div style={{ ...segTrackStyle, flexShrink: 0 }}>
      <button style={segBtnStyle(mode === 'board')} onClick={() => selectMode('board')}>
        <LayoutGrid size={13} />{t('board_view_kanban')}
      </button>
      <button style={segBtnStyle(mode === 'list')} onClick={() => selectMode('list')}>
        <ListIcon size={13} />{t('board_view_list')}
      </button>
    </div>
  )

  const newBtn = (
    <button style={{ ...primaryBtnStyle, flexShrink: 0 }} onClick={onNew}>
      <Plus size={15} />{t('finance_store_new_sale')}
    </button>
  )

  // No celular o kanban não é oferecido (colunas lado a lado não cabem e o
  // arrastar brigaria com o scroll); a lista é a única leitura.
  if (mode === 'board' && !isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {modeToggle}
          {newBtn}
        </div>
        <SalesBoard store={store} categories={categories} onEdit={onEdit} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Six options never fit a 375px track: scroll, don't wrap. */}
        <div className="finance-hide-scrollbar"
          style={{ ...segTrackStyle, flex: 1, minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <button style={segBtnStyle(filter === 'all')} onClick={() => setFilter('all')}>{t('finance_store_filter_all')}</button>
          {SALE_STATUSES.map(s => (
            <button key={s} style={segBtnStyle(filter === s)} onClick={() => setFilter(s)}>{t(SALE_STATUS_KEY[s])}</button>
          ))}
        </div>
        {!isMobile && modeToggle}
        {newBtn}
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
          const prev = PREV_STATUS[sale.status]
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
                    onClick={e => { e.stopPropagation(); request(sale, next) }}>
                    {t(NEXT_LABEL[next as 'sold' | 'shipped' | 'delivered'])}
                  </button>
                )}
                {prev && (
                  <button style={{ ...ghostBtnStyle, padding: '5px 10px', fontSize: 12 }} disabled={busy}
                    title={t('finance_store_revert_status')}
                    onClick={e => { e.stopPropagation(); request(sale, prev) }}>
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
          categories={categories} onClose={() => setConfirming(null)} />
      )}
    </div>
  )
}

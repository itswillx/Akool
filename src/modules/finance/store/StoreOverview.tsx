import { Plus, Store } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import {
  averageUnitCost, monthAggregates, productStock, stockCapital,
} from '../../../lib/financeStoreCalc'
import { FIN_NEG, FIN_POS, cardSurfaceStyle, primaryBtnStyle, sectionCaptionStyle, tabularNums } from '../ui'
import { SALE_STATUSES, SALE_STATUS_KEY, badgeStyle, saleStatusColor } from './storeUi'
import type { FinanceStoreStore } from './useFinanceStore'

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ ...cardSurfaceStyle, padding: '14px 16px', flex: '1 1 150px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: color ?? 'var(--color-text)', ...tabularNums }}>
        {value}
      </div>
    </div>
  )
}

// Consolidated numbers of the store: capital sitting in stock, the selected
// month's result (driven by the panel's header arrows), the sale pipeline
// (all time — labelled as such) and where the capital is parked.
export function StoreOverview({ store, month, onNewProduct }: {
  store: FinanceStoreStore
  /** 'YYYY-MM' from the FinancePanel month navigator. */
  month: string
  onNewProduct: () => void
}) {
  const { t } = useLanguage()

  // First run: no numbers to show — invite instead of four zeroed cards.
  if (store.products.length === 0) {
    return (
      <div style={{ ...cardSurfaceStyle, padding: '48px 24px', textAlign: 'center' }}>
        <Store size={30} style={{ opacity: 0.5, color: 'var(--color-text-muted)' }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginTop: 10 }}>
          {t('finance_store_empty_title')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 16 }}>
          {t('finance_store_empty_desc')}
        </div>
        <button style={{ ...primaryBtnStyle, margin: '0 auto' }} onClick={onNewProduct}>
          <Plus size={15} />{t('finance_store_new_product')}
        </button>
      </div>
    )
  }

  const capital = stockCapital(store.products, store.purchases, store.saleItems, store.sales)
  const agg = monthAggregates(month, store.sales, store.saleItems)

  const pipeline = SALE_STATUSES
    .map(status => ({ status, count: store.sales.filter(s => s.status === status).length }))
    .filter(x => x.count > 0)

  // Where the money is parked: available units valued at their average cost.
  const parked = store.products
    .filter(p => !p.archived)
    .map(p => {
      const stock = productStock(p.id, store.purchases, store.saleItems, store.sales)
      return { p, stock, value: stock.available * averageUnitCost(p.id, store.purchases) }
    })
    .filter(x => x.stock.available > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label={t('finance_store_capital')} value={formatBRL(capital)} />
        <StatCard label={t('finance_store_month_profit')} value={formatBRL(agg.profit)}
          color={agg.profit >= 0 ? FIN_POS : FIN_NEG} />
        <StatCard label={t('finance_store_month_revenue')} value={formatBRL(agg.revenue)} />
        <StatCard label={t('finance_store_month_sales')} value={String(agg.count)} />
      </div>

      {pipeline.length > 0 && (
        <div>
          <p style={{ ...sectionCaptionStyle, marginBottom: 8 }}>{t('finance_store_pipeline_all_time')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pipeline.map(({ status, count }) => (
              <span key={status} style={{ ...badgeStyle(saleStatusColor(status)), fontSize: 12, padding: '4px 10px' }}>
                {count} · {t(SALE_STATUS_KEY[status])}
              </span>
            ))}
          </div>
        </div>
      )}

      {parked.length > 0 && (
        <div>
          <p style={{ ...sectionCaptionStyle, marginBottom: 8 }}>{t('finance_store_in_stock')}</p>
          <div style={cardSurfaceStyle}>
            {parked.map(({ p, stock, value }, index) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: index === parked.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                {p.kind === 'stock' && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                    {stock.available === 1
                      ? t('finance_store_available_count', { count: String(stock.available) })
                      : t('finance_store_available_count_plural', { count: String(stock.available) })}
                  </span>
                )}
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0, ...tabularNums }}>
                  {formatBRL(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

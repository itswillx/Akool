import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Users } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { customerHistory, customerStats, saleRevenue } from '../../../lib/financeStoreCalc'
import type { FinanceStoreCustomer } from '../../../types'
import { cardSurfaceStyle, primaryBtnStyle, tabularNums } from '../ui'
import { CHANNEL_KEY, SALE_STATUS_KEY, badgeStyle, emptyStateStyle, saleStatusColor } from './storeUi'
import type { FinanceStoreStore } from './useFinanceStore'

// Customer list with derived stats. Clicking a row expands the purchase
// history (the thing you usually want from a customer); editing is behind the
// pencil.
export function CustomersView({ store, onNew, onEdit }: {
  store: FinanceStoreStore
  onNew: () => void
  onEdit: (customer: FinanceStoreCustomer) => void
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={primaryBtnStyle} onClick={onNew}><Plus size={15} />{t('finance_store_customer_new')}</button>
      </div>

      <div style={cardSurfaceStyle}>
        {store.customers.length === 0 && (
          <div style={emptyStateStyle}>
            <Users size={22} style={{ marginBottom: 6, opacity: 0.6 }} />
            <div style={{ marginBottom: 12 }}>{t('finance_store_no_customers')}</div>
            <button style={primaryBtnStyle} onClick={onNew}><Plus size={15} />{t('finance_store_customer_new')}</button>
          </div>
        )}
        {store.customers.map((customer, index) => {
          const stats = customerStats(customer, store.sales, store.saleItems)
          const open = expanded === customer.id
          const history = open ? customerHistory(customer.id, store.sales) : []
          return (
            <div key={customer.id}
              style={{ borderBottom: index === store.customers.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer' }}
                onClick={() => setExpanded(open ? null : customer.id)}>
                <span style={{ color: 'var(--color-text-muted)', display: 'flex', flexShrink: 0 }}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)' }}>{customer.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={badgeStyle('var(--color-text-muted)')}>{t(CHANNEL_KEY[customer.channel])}</span>
                    {customer.city && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{customer.city}</span>}
                    {customer.phone && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{customer.phone}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, ...tabularNums }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{formatBRL(stats.total)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                    {stats.count === 1
                      ? t('finance_store_purchases_count', { count: String(stats.count) })
                      : t('finance_store_purchases_count_plural', { count: String(stats.count) })}
                  </div>
                </div>
                <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4, flexShrink: 0 }}
                  title={t('finance_store_customer_edit')}
                  onClick={e => { e.stopPropagation(); onEdit(customer) }}>
                  <Pencil size={14} />
                </button>
              </div>
              {open && history.length > 0 && (
                <div style={{ padding: '0 14px 10px 39px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.map(sale => {
                    const items = store.saleItems.filter(i => i.sale_id === sale.id)
                    return (
                      <div key={sale.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <span style={badgeStyle(saleStatusColor(sale.status))}>{t(SALE_STATUS_KEY[sale.status])}</span>
                        <span style={{ flex: 1, minWidth: 0, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {items.map(i => `${i.quantity}× ${i.product_name}`).join(', ') || t('finance_store_sale')}
                        </span>
                        <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, ...tabularNums }}>
                          {formatBRL(saleRevenue(sale, items))}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {open && history.length === 0 && (
                <div style={{ padding: '0 14px 10px 39px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                  {t('finance_store_no_sales')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

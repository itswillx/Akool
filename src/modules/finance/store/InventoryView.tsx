import { useState } from 'react'
import { Package, Plus, RotateCw, Search } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { averageUnitCost, productStock, uniqueItemState } from '../../../lib/financeStoreCalc'
import type { FinanceStoreProduct } from '../../../types'
import { cardSurfaceStyle, ghostBtnStyle, inputStyle, primaryBtnStyle, segBtnStyle, segTrackStyle, tabularNums } from '../ui'
import {
  CONDITION_KEY, KIND_KEY, UNIQUE_STATE_KEY, badgeStyle, emptyStateStyle, rowStyle, uniqueStateColor,
} from './storeUi'
import type { FinanceStoreStore } from './useFinanceStore'

type Filter = 'active' | 'archived'

// Product list with derived stock badges and a client-side name/category
// search. Clicking a row opens the edit modal; stock products get a restock
// shortcut.
export function InventoryView({ store, onNew, onEdit, onRestock }: {
  store: FinanceStoreStore
  onNew: () => void
  onEdit: (product: FinanceStoreProduct) => void
  onRestock: (product: FinanceStoreProduct) => void
}) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const visible = store.products
    .filter(p => (filter === 'archived' ? p.archived : !p.archived))
    .filter(p => !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term))

  const countLabel = (key: 'finance_store_available_count' | 'finance_store_reserved_count', n: number) =>
    n === 1 ? t(key, { count: String(n) }) : t(`${key}_plural`, { count: String(n) })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={segTrackStyle}>
          <button style={segBtnStyle(filter === 'active')} onClick={() => setFilter('active')}>{t('finance_store_filter_active')}</button>
          <button style={segBtnStyle(filter === 'archived')} onClick={() => setFilter('archived')}>{t('finance_store_filter_archived')}</button>
        </div>
        <button style={primaryBtnStyle} onClick={onNew}><Plus size={15} />{t('finance_store_new_product')}</button>
      </div>

      {store.products.length > 0 && (
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
          <input style={{ ...inputStyle, paddingLeft: 30 }} value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('finance_store_search_placeholder')} />
        </div>
      )}

      <div style={cardSurfaceStyle}>
        {visible.length === 0 && (
          <div style={emptyStateStyle}>
            <Package size={22} style={{ marginBottom: 6, opacity: 0.6 }} />
            <div style={{ marginBottom: term ? 0 : 12 }}>{t('finance_store_no_products')}</div>
            {!term && (
              <button style={primaryBtnStyle} onClick={onNew}><Plus size={15} />{t('finance_store_new_product')}</button>
            )}
          </div>
        )}
        {visible.map((product, index) => {
          const stock = productStock(product.id, store.purchases, store.saleItems, store.sales)
          const cost = averageUnitCost(product.id, store.purchases)
          const state = uniqueItemState(stock)
          return (
            <div key={product.id}
              style={{ ...rowStyle, cursor: 'pointer', borderBottom: index === visible.length - 1 ? 'none' : rowStyle.borderBottom }}
              onClick={() => onEdit(product)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {product.name}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {/* A unique item whose initial purchase never landed has no
                      unit on the shelf — show the honest count, not "in stock". */}
                  {product.kind === 'unique' && stock.purchased > 0 ? (
                    <span style={badgeStyle(uniqueStateColor(state))}>{t(UNIQUE_STATE_KEY[state])}</span>
                  ) : (
                    <span style={badgeStyle(stock.available > 0 ? 'var(--color-done)' : 'var(--color-text-muted)')}>
                      {countLabel('finance_store_available_count', stock.available)}
                    </span>
                  )}
                  {stock.reserved > 0 && product.kind === 'stock' && (
                    <span style={badgeStyle('var(--color-text-muted)')}>{countLabel('finance_store_reserved_count', stock.reserved)}</span>
                  )}
                  <span style={badgeStyle('var(--color-text-muted)')}>{t(KIND_KEY[product.kind])}</span>
                  <span style={badgeStyle('var(--color-text-muted)')}>{t(CONDITION_KEY[product.condition])}</span>
                  {product.category && <span style={badgeStyle('var(--color-text-muted)')}>{product.category}</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, ...tabularNums }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {cost > 0 ? formatBRL(cost) : '—'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                  {product.target_price > 0
                    ? t('finance_store_target_short', { value: formatBRL(product.target_price) })
                    : t('finance_store_cost_short')}
                </div>
              </div>
              {product.kind === 'stock' && !product.archived && (
                <button style={{ ...ghostBtnStyle, padding: '6px 10px', flexShrink: 0 }} title={t('finance_store_restock')}
                  onClick={e => { e.stopPropagation(); onRestock(product) }}>
                  <RotateCw size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

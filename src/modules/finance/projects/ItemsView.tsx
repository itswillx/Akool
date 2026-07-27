import { useState } from 'react'
import { ClipboardList, Plus } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { itemEstimatedTotal, itemExpectedCost } from '../../../lib/financeProjectCalc'
import type { FinanceProject, FinanceProjectItem, FinanceProjectItemStatus } from '../../../types'
import { cardSurfaceStyle, ghostBtnStyle, primaryBtnStyle, segBtnStyle, segTrackStyle, tabularNums } from '../ui'
import { ItemModal } from './ItemModal'
import {
  ITEM_STATUSES, ITEM_STATUS_KEY, badgeStyle, emptyStateStyle, formatQuantity, itemStatusColor, rowStyle,
} from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

type Filter = 'all' | FinanceProjectItemStatus

export function ItemsView({ project, store, onBuy }: {
  project: FinanceProject
  store: FinanceProjectsStore
  onBuy: (item: FinanceProjectItem) => void
}) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState<Filter>('all')
  const [modal, setModal] = useState<{ open: boolean; item?: FinanceProjectItem }>({ open: false })

  const all = store.items.filter(i => i.project_id === project.id)
  const items = filter === 'all' ? all : all.filter(i => i.status === filter)
  const stageName = (id: string | null) => store.stages.find(s => s.id === id)?.name

  // What the open shopping list is still expected to cost, using the chosen or
  // cheapest quote when there is one.
  const openTotal = all
    .filter(i => i.status !== 'purchased' && i.status !== 'cancelled')
    .reduce((sum, i) => sum + itemExpectedCost(i, store.quotes), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', ...tabularNums }}>
          {t('finance_proj_shopping_total', { value: formatBRL(openTotal) })}
        </div>
        <button style={primaryBtnStyle} onClick={() => setModal({ open: true })}>
          <Plus size={15} />{t('finance_proj_item_new')}
        </button>
      </div>

      <div style={{ ...segTrackStyle, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        <button style={segBtnStyle(filter === 'all')} onClick={() => setFilter('all')}>{t('finance_proj_filter_all')}</button>
        {ITEM_STATUSES.map(s => (
          <button key={s} style={segBtnStyle(filter === s)} onClick={() => setFilter(s)}>{t(ITEM_STATUS_KEY[s])}</button>
        ))}
      </div>

      {items.length === 0 ? (
        <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>
          <ClipboardList size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>{t('finance_proj_items_empty')}</div>
        </div>
      ) : (
        <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
          {items.map((item, idx) => {
            const expected = itemExpectedCost(item, store.quotes)
            const estimated = itemEstimatedTotal(item)
            const quoteCount = store.quotes.filter(q => q.item_id === item.id).length
            return (
              <div key={item.id} style={{ ...rowStyle, borderBottom: idx < items.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <button onClick={() => setModal({ open: true, item })}
                  style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    <span style={badgeStyle(itemStatusColor(item.status))}>{t(ITEM_STATUS_KEY[item.status])}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                    {formatQuantity(item.quantity)} {item.unit}
                    {stageName(item.stage_id) && ` · ${stageName(item.stage_id)}`}
                    {quoteCount > 0 && ` · ${t('finance_proj_quote_count', { n: quoteCount })}`}
                  </div>
                </button>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{formatBRL(expected)}</div>
                  {quoteCount > 0 && estimated > 0 && expected !== estimated && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textDecoration: 'line-through', ...tabularNums }}>
                      {formatBRL(estimated)}
                    </div>
                  )}
                </div>
                {item.status !== 'purchased' && item.status !== 'cancelled' && (
                  <button style={{ ...ghostBtnStyle, padding: '5px 9px', fontSize: 12 }} onClick={() => onBuy(item)}>
                    {t('finance_proj_bought')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal.open && (
        <ItemModal
          project={project}
          store={store}
          item={modal.item}
          onClose={() => setModal({ open: false })}
          onSave={async draft => {
            if (modal.item) await store.updateItem(modal.item.id, draft)
            else await store.createItem({ ...draft, project_id: project.id, sort_order: all.length })
          }}
          onDelete={modal.item ? () => store.deleteItem(modal.item!.id) : undefined}
          onBuy={item => { setModal({ open: false }); onBuy(item) }}
        />
      )}
    </div>
  )
}

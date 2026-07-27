import { useState } from 'react'
import { Check, ExternalLink, Plus, Trash2, TrendingDown } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL, toCents } from '../../../lib/money'
import { bestQuote, quoteSavings, quoteTotal } from '../../../lib/financeProjectCalc'
import type { FinanceProjectItem, FinanceProjectQuote } from '../../../types'
import { ghostBtnStyle, inputStyle, labelStyle, tabularNums } from '../ui'
import type { FinanceProjectsStore } from './useFinanceProjects'
import { emptyStateStyle } from './projectsUi'

// Price comparison for one shopping item: every store's offer side by side, the
// cheapest one flagged, and one click to lock it in as the chosen quote.
export function QuotesPanel({ item, store, projectId }: {
  item: FinanceProjectItem
  store: FinanceProjectsStore
  projectId: string
}) {
  const { t } = useLanguage()
  const [adding, setAdding] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [totalPrice, setTotalPrice] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const quotes = store.quotes.filter(q => q.item_id === item.id)
  const best = bestQuote(quotes, item)
  const savings = quoteSavings(quotes, item)

  const reset = () => {
    setSupplierId(''); setSupplierName(''); setUnitPrice(''); setTotalPrice(''); setUrl(''); setAdding(false)
  }

  const handleAdd = async () => {
    const unit = toCents(unitPrice)
    const closed = totalPrice.trim() ? toCents(totalPrice) : null
    if (unit <= 0 && closed == null) return
    setSaving(true)
    try {
      await store.createQuote(projectId, {
        item_id: item.id,
        supplier_id: supplierId || null,
        supplier_name: supplierId ? '' : supplierName.trim(),
        unit_price: unit,
        total_price: closed,
        quoted_on: null,
        url: url.trim(),
        notes: '',
      })
      reset()
    } finally {
      setSaving(false)
    }
  }

  const labelFor = (q: FinanceProjectQuote) =>
    store.suppliers.find(s => s.id === q.supplier_id)?.name || q.supplier_name || t('finance_proj_no_supplier')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{t('finance_proj_quotes')}</label>
        {savings && savings.savings > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--color-done)', display: 'inline-flex', alignItems: 'center', gap: 4, ...tabularNums }}>
            <TrendingDown size={12} />{t('finance_proj_savings', { value: formatBRL(savings.savings) })}
          </span>
        )}
      </div>

      {quotes.length === 0 ? (
        <div style={{ ...emptyStateStyle, padding: '16px 10px', fontSize: 12.5, border: '1px dashed var(--color-border)', borderRadius: 8 }}>
          {t('finance_proj_quotes_empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {quotes.map(q => {
            const total = quoteTotal(q, item)
            const isBest = best?.id === q.id
            const isChosen = item.chosen_quote_id === q.id
            return (
              <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface)', border: isChosen ? '1.5px solid var(--color-done)' : '1px solid var(--color-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(q)}</span>
                    {isBest && quotes.length > 1 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-done)', border: '1px solid var(--color-done)', borderRadius: 999, padding: '0 5px' }}>
                        {t('finance_proj_best')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', ...tabularNums }}>
                    {q.total_price != null
                      ? t('finance_proj_closed_price')
                      : t('finance_proj_unit_price_short', { value: formatBRL(q.unit_price) })}
                    {q.url && (
                      <a href={q.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: 'var(--color-text-muted)', display: 'inline-flex', verticalAlign: 'middle' }}>
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums, flexShrink: 0 }}>
                  {formatBRL(total)}
                </div>
                <button type="button" title={isChosen ? t('finance_proj_chosen') : t('finance_proj_choose')}
                  onClick={() => store.chooseQuote(item.id, isChosen ? null : q.id)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', padding: 3, color: isChosen ? 'var(--color-done)' : 'var(--color-text-muted)' }}>
                  <Check size={15} />
                </button>
                <button type="button" title={t('finance_delete')} onClick={() => store.deleteQuote(q.id)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', padding: 3, color: 'var(--color-error)' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {adding ? (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--color-border)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select style={inputStyle} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">{t('finance_proj_supplier_free_text')}</option>
            {store.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!supplierId && (
            <input style={inputStyle} value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder={t('finance_proj_store_placeholder')} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} type="number" step="0.01" min="0" value={unitPrice}
              onChange={e => setUnitPrice(e.target.value)} placeholder={t('finance_proj_unit_price')} />
            <input style={{ ...inputStyle, flex: 1 }} type="number" step="0.01" min="0" value={totalPrice}
              onChange={e => setTotalPrice(e.target.value)} placeholder={t('finance_proj_closed_price_placeholder')} />
          </div>
          <input style={inputStyle} value={url} onChange={e => setUrl(e.target.value)} placeholder={t('finance_proj_quote_url')} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={{ ...ghostBtnStyle, flex: 1, justifyContent: 'center' }} onClick={handleAdd} disabled={saving}>
              {t('finance_save')}
            </button>
            <button type="button" style={ghostBtnStyle} onClick={reset}>{t('finance_cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" style={{ ...ghostBtnStyle, marginTop: 8 }} onClick={() => setAdding(true)}>
          <Plus size={14} />{t('finance_proj_quote_new')}
        </button>
      )}
    </div>
  )
}

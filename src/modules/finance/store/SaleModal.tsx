import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL, fromCents, toCents } from '../../../lib/money'
import { averageUnitCost, productStock, saleProfit } from '../../../lib/financeStoreCalc'
import type { FinanceAccount, FinanceStoreChannel, FinanceStoreSale } from '../../../types'
import { Modal, FIN_NEG, FIN_POS, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, sectionCaptionStyle, tabularNums, useFinanceMobile } from '../ui'
import { AttachmentField } from '../projects/AttachmentField'
import { CHANNELS, CHANNEL_KEY } from './storeUi'
import { CustomerModal } from './CustomerModal'
import { STORE_ATTACHMENT_BUCKET, type FinanceStoreStore } from './useFinanceStore'

interface ItemDraft {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  unit_cost_at_sale: number
}

// Create/edit form for a sale. On create the items live in local state and are
// persisted in one batch after the sale row exists; on edit they are already
// rows — add/remove persist immediately (QuotesPanel pattern), and the price
// commits ON BLUR through a local string draft, so typing "12,50" never
// fights the re-render nor fires a write per keystroke.
// Status transitions live in SalesView, not here.
export function SaleModal({ store, sale, accounts, onClose }: {
  store: FinanceStoreStore
  sale?: FinanceStoreSale
  accounts: FinanceAccount[]
  onClose: () => void
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const [customerId, setCustomerId] = useState(sale?.customer_id ?? '')
  const [channel, setChannel] = useState<FinanceStoreChannel>(sale?.channel ?? 'olx')
  const [shippingMethod, setShippingMethod] = useState(sale?.shipping_method ?? '')
  const [tracking, setTracking] = useState(sale?.tracking_code ?? '')
  const [expectedDelivery, setExpectedDelivery] = useState(sale?.expected_delivery_on ?? '')
  const [soldOn, setSoldOn] = useState(sale?.sold_on ?? '')
  const [shippingCharged, setShippingCharged] = useState(sale && sale.shipping_charged > 0 ? String(fromCents(sale.shipping_charged)) : '')
  const [shippingCost, setShippingCost] = useState(sale && sale.shipping_cost > 0 ? String(fromCents(sale.shipping_cost)) : '')
  const [fees, setFees] = useState(sale && sale.fees > 0 ? String(fromCents(sale.fees)) : '')
  const [accountId, setAccountId] = useState(sale?.account_id ?? '')
  const [notes, setNotes] = useState(sale?.notes ?? '')
  const [attachments, setAttachments] = useState(sale?.attachments ?? [])
  const [drafts, setDrafts] = useState<ItemDraft[]>([])
  // Per-row price being typed; committed to cents on blur (or on save).
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  // Picker row state.
  const [pickId, setPickId] = useState('')
  const [pickQty, setPickQty] = useState('1')
  const [pickPrice, setPickPrice] = useState('')
  const [newCustomer, setNewCustomer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const persistedItems = sale ? store.saleItems.filter(i => i.sale_id === sale.id) : []
  const items = sale ? persistedItems : drafts
  const rowKey = (index: number) => (sale ? persistedItems[index].id : String(index))
  const soldOnVisible = !!sale && sale.status !== 'negotiating' && sale.status !== 'cancelled'

  const moneyDraft = {
    shipping_charged: toCents(shippingCharged),
    shipping_cost: toCents(shippingCost),
    fees: toCents(fees),
  }
  // Profit preview honours prices still sitting in the blur drafts.
  const previewItems = items.map((item, index) => {
    const draft = priceDrafts[rowKey(index)]
    return draft === undefined ? item : { ...item, unit_price: toCents(draft) }
  })
  const profit = saleProfit(moneyDraft, previewItems)

  // Products offered by the picker: not archived, with units on the shelf.
  // Units already in this form's local drafts are subtracted too.
  const draftedOf = (id: string) => drafts.filter(d => d.product_id === id).reduce((s, d) => s + d.quantity, 0)
  const pickable = store.products
    .filter(p => !p.archived)
    .map(p => ({ p, available: productStock(p.id, store.purchases, store.saleItems, store.sales).available - draftedOf(p.id) }))
    .filter(x => x.available > 0)

  const picked = pickable.find(x => x.p.id === pickId)

  const addItem = async () => {
    if (!picked) return
    const qty = Math.min(Math.max(1, Math.floor(Number(pickQty) || 1)), picked.available)
    const draft: ItemDraft = {
      product_id: picked.p.id,
      product_name: picked.p.name,
      quantity: qty,
      unit_price: pickPrice ? toCents(pickPrice) : picked.p.target_price,
      unit_cost_at_sale: averageUnitCost(picked.p.id, store.purchases),
    }
    if (sale) await store.addSaleItem({ ...draft, sale_id: sale.id })
    else setDrafts(prev => [...prev, draft])
    setPickId(''); setPickQty('1'); setPickPrice('')
  }

  const removeItem = async (index: number) => {
    if (sale) await store.removeSaleItem(persistedItems[index].id)
    else setDrafts(prev => prev.filter((_, i) => i !== index))
  }

  const commitPrice = async (index: number) => {
    const key = rowKey(index)
    const draft = priceDrafts[key]
    if (draft === undefined) return
    const cents = toCents(draft)
    setPriceDrafts(prev => { const { [key]: _committed, ...rest } = prev; return rest })
    if (sale) {
      if (cents !== persistedItems[index].unit_price) {
        await store.updateSaleItem(persistedItems[index].id, { unit_price: cents })
      }
    } else {
      setDrafts(prev => prev.map((d, i) => (i === index ? { ...d, unit_price: cents } : d)))
    }
  }

  const handleSave = async () => {
    if (items.length === 0 && !sale) return
    setSaving(true)
    try {
      const draft = {
        customer_id: customerId || null,
        channel,
        shipping_method: shippingMethod.trim(),
        tracking_code: tracking.trim(),
        expected_delivery_on: expectedDelivery || null,
        ...moneyDraft,
        account_id: accountId || null,
        notes: notes.trim(),
        attachments,
      }
      if (sale) {
        // Flush any price still in a draft before the sale-level save.
        for (let i = 0; i < persistedItems.length; i++) await commitPrice(i)
        await store.updateSale(sale.id, soldOnVisible ? { ...draft, sold_on: soldOn || null } : draft)
      } else {
        const finalItems = drafts.map((d, i) => {
          const pending = priceDrafts[String(i)]
          return pending === undefined ? d : { ...d, unit_price: toCents(pending) }
        })
        const created = await store.createSale(draft)
        if (created) {
          await store.addSaleItems(finalItems.map(d => ({ ...d, sale_id: created.id })))
        }
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const priceValue = (index: number) => {
    const draft = priceDrafts[rowKey(index)]
    if (draft !== undefined) return draft
    const item = items[index]
    return item.unit_price > 0 ? String(fromCents(item.unit_price)) : ''
  }

  return (
    <>
      <Modal title={sale ? t('finance_store_sale_edit') : t('finance_store_sale_new')} onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_customer')}</label>
              <select style={inputStyle} value={customerId} onChange={e => setCustomerId(e.target.value)}>
                <option value="">{t('finance_store_no_customer')}</option>
                {store.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button style={ghostBtnStyle} onClick={() => setNewCustomer(true)}><Plus size={14} />{t('finance_store_customer_new')}</button>
          </div>

          <div>
            <label style={labelStyle}>{t('finance_store_channel')}</label>
            <select style={inputStyle} value={channel} onChange={e => setChannel(e.target.value as FinanceStoreChannel)}>
              {CHANNELS.map(c => <option key={c} value={c}>{t(CHANNEL_KEY[c])}</option>)}
            </select>
          </div>

          <p style={sectionCaptionStyle}>{t('finance_store_items')}</p>

          {items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((item, index) => (
                <div key={rowKey(index)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.quantity}× {item.product_name}
                  </span>
                  <input style={{ ...inputStyle, width: 92 }} type="number" step="0.01" min="0"
                    value={priceValue(index)}
                    onChange={e => setPriceDrafts(prev => ({ ...prev, [rowKey(index)]: e.target.value }))}
                    onBlur={() => commitPrice(index)}
                    placeholder="0,00" />
                  <button type="button" onClick={() => removeItem(index)} title={t('finance_delete')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', padding: 2 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {pickable.length > 0 ? (
            isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select style={inputStyle} value={pickId} onChange={e => {
                  setPickId(e.target.value)
                  const target = pickable.find(x => x.p.id === e.target.value)
                  if (target && target.p.target_price > 0) setPickPrice(String(fromCents(target.p.target_price)))
                }}>
                  <option value="">{t('finance_store_pick_product')}</option>
                  {pickable.map(({ p, available }) => (
                    <option key={p.id} value={p.id}>{p.name}{p.kind === 'stock' ? ` (${available})` : ''}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {picked?.p.kind === 'stock' && (
                    <input style={{ ...inputStyle, width: 72 }} type="number" step="1" min="1" max={picked.available}
                      value={pickQty} onChange={e => setPickQty(e.target.value)} />
                  )}
                  <input style={{ ...inputStyle, flex: 1 }} type="number" step="0.01" min="0"
                    value={pickPrice} onChange={e => setPickPrice(e.target.value)} placeholder="0,00" />
                  <button style={{ ...ghostBtnStyle, padding: '8px 12px' }} onClick={addItem} disabled={!picked}><Plus size={14} /></button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select style={{ ...inputStyle, flex: 1 }} value={pickId} onChange={e => {
                  setPickId(e.target.value)
                  const target = pickable.find(x => x.p.id === e.target.value)
                  if (target && target.p.target_price > 0) setPickPrice(String(fromCents(target.p.target_price)))
                }}>
                  <option value="">{t('finance_store_pick_product')}</option>
                  {pickable.map(({ p, available }) => (
                    <option key={p.id} value={p.id}>{p.name}{p.kind === 'stock' ? ` (${available})` : ''}</option>
                  ))}
                </select>
                {picked?.p.kind === 'stock' && (
                  <input style={{ ...inputStyle, width: 64 }} type="number" step="1" min="1" max={picked.available}
                    value={pickQty} onChange={e => setPickQty(e.target.value)} />
                )}
                <input style={{ ...inputStyle, width: 92 }} type="number" step="0.01" min="0"
                  value={pickPrice} onChange={e => setPickPrice(e.target.value)} placeholder="0,00" />
                <button style={{ ...ghostBtnStyle, padding: '8px 10px' }} onClick={addItem} disabled={!picked}><Plus size={14} /></button>
              </div>
            )
          ) : items.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('finance_store_no_stock_hint')}</div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_shipping_charged')}</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={shippingCharged}
                onChange={e => setShippingCharged(e.target.value)} placeholder="0,00" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_shipping_cost')}</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={shippingCost}
                onChange={e => setShippingCost(e.target.value)} placeholder="0,00" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_fees')}</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={fees}
                onChange={e => setFees(e.target.value)} placeholder="0,00" />
            </div>
          </div>

          {items.length > 0 && (
            <div style={{ fontSize: 13, fontWeight: 600, color: profit >= 0 ? FIN_POS : FIN_NEG, ...tabularNums }}>
              {t('finance_store_profit')}: {formatBRL(profit)}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_shipping_method')}</label>
              <input style={inputStyle} value={shippingMethod} onChange={e => setShippingMethod(e.target.value)}
                placeholder={t('finance_store_shipping_placeholder')} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_expected_delivery')}</label>
              <input style={inputStyle} type="date" value={expectedDelivery} onChange={e => setExpectedDelivery(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_tracking')}</label>
              <input style={inputStyle} value={tracking} onChange={e => setTracking(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_account')}</label>
              <select style={inputStyle} value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">{t('finance_store_no_account')}</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
              </select>
            </div>
          </div>

          {soldOnVisible && (
            <div>
              <label style={labelStyle}>{t('finance_store_sold_on')}</label>
              <input style={inputStyle} type="date" value={soldOn} onChange={e => setSoldOn(e.target.value)} />
            </div>
          )}

          <div>
            <label style={labelStyle}>{t('finance_store_notes')}</label>
            <textarea style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {sale && (
            <AttachmentField projectId={sale.id} bucket={STORE_ATTACHMENT_BUCKET}
              value={attachments} onChange={setAttachments} />
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || (items.length === 0 && !sale) ? 0.7 : 1 }}
              onClick={handleSave} disabled={saving || (items.length === 0 && !sale)}>{t('finance_save')}</button>
            {/* Item edits already persisted, so "Cancel" would lie on edit. */}
            <button style={ghostBtnStyle} onClick={onClose}>{sale ? t('finance_store_close') : t('finance_cancel')}</button>
          </div>

          {sale && (
            confirming ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_store_sale_delete_warning')}</span>
                <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }}
                  onClick={async () => { await store.deleteSale(sale.id); onClose() }}>{t('finance_confirm_delete')}</button>
                <button style={ghostBtnStyle} onClick={() => setConfirming(false)}>{t('finance_cancel')}</button>
              </div>
            ) : (
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)', justifyContent: 'center' }} onClick={() => setConfirming(true)}>{t('finance_delete')}</button>
            )
          )}
        </div>
      </Modal>

      {/* Sibling, never nested inside the Modal: stacking two fixed overlays
          keeps one backdrop each and avoids the iOS clipping of fixed elements
          inside a -webkit-overflow-scrolling container. */}
      {newCustomer && (
        <CustomerModal store={store} onClose={() => setNewCustomer(false)}
          onCreated={created => setCustomerId(created.id)} />
      )}
    </>
  )
}

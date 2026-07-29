import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL, fromCents, toCents } from '../../../lib/money'
import { purchaseTotal } from '../../../lib/financeStoreCalc'
import type { FinanceAccount, FinanceStoreCondition, FinanceStoreProduct, FinanceStoreProductKind, FinanceStorePurchase } from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, sectionCaptionStyle, segBtnStyle, segTrackStyle, tabularNums } from '../ui'
import { AttachmentField } from '../projects/AttachmentField'
import { CATEGORY_SUGGESTIONS, CONDITIONS, CONDITION_KEY, KIND_KEY, PRODUCT_KINDS } from './storeUi'
import { STORE_ATTACHMENT_BUCKET, todayISO, type FinanceStoreStore } from './useFinanceStore'

// Create/edit form for a product. Creating ALWAYS registers the initial
// purchase in one go (cost 0 allowed — freebies and trades are stock too;
// skipping it would silently discard the quantity the user typed and leave
// the product unsellable). Editing exposes the purchase history, so a wrong
// cost can be fixed instead of poisoning the average forever.
export function ProductModal({ store, product, accounts, onClose, onEditPurchase, onAddPurchase }: {
  store: FinanceStoreStore
  product?: FinanceStoreProduct
  accounts: FinanceAccount[]
  onClose: () => void
  /** Edit mode: opens PurchaseModal for one purchase (the tab swaps modals). */
  onEditPurchase?: (purchase: FinanceStorePurchase) => void
  /** Edit mode: opens PurchaseModal for a new purchase of this product. */
  onAddPurchase?: () => void
}) {
  const { t } = useLanguage()
  const [kind, setKind] = useState<FinanceStoreProductKind>(product?.kind ?? 'unique')
  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [condition, setCondition] = useState<FinanceStoreCondition>(product?.condition ?? 'used')
  const [serial, setSerial] = useState(product?.serial_number ?? '')
  const [targetPrice, setTargetPrice] = useState(product && product.target_price > 0 ? String(fromCents(product.target_price)) : '')
  const [notes, setNotes] = useState(product?.notes ?? '')
  const [attachments, setAttachments] = useState(product?.attachments ?? [])
  // Initial purchase (create mode only).
  const [quantity, setQuantity] = useState('1')
  const [unitCost, setUnitCost] = useState('')
  const [otherCosts, setOtherCosts] = useState('')
  const [date, setDate] = useState(todayISO())
  const [supplierId, setSupplierId] = useState('')
  const [newSupplier, setNewSupplier] = useState('')
  const [accountId, setAccountId] = useState('')
  const [createExpense, setCreateExpense] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const qty = kind === 'unique' ? 1 : Math.max(1, Math.floor(Number(quantity) || 1))
  const totalCost = qty * toCents(unitCost) + toCents(otherCosts)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const draft = {
        kind,
        name: name.trim(),
        category: category.trim(),
        condition,
        serial_number: kind === 'unique' ? serial.trim() : '',
        notes: notes.trim(),
        target_price: toCents(targetPrice),
        attachments,
      }
      if (product) {
        await store.updateProduct(product.id, draft)
      } else {
        const created = await store.createProduct(draft)
        if (created) {
          let supplier = supplierId || null
          if (supplierId === '__new' && newSupplier.trim()) {
            supplier = (await store.createSupplier(newSupplier.trim()))?.id ?? null
          } else if (supplierId === '__new') supplier = null
          await store.createPurchase({
            product_id: created.id,
            supplier_id: supplier,
            quantity: qty,
            unit_cost: toCents(unitCost),
            other_costs: toCents(otherCosts),
            date,
            account_id: accountId || null,
            notes: '',
            attachments: [],
          }, {
            createTransaction: createExpense,
            description: t('finance_store_tx_purchase_desc', { name: name.trim() }),
          })
        }
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={product ? t('finance_store_product_edit') : t('finance_store_product_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!product && (
          <div style={{ ...segTrackStyle, alignSelf: 'stretch' }}>
            {PRODUCT_KINDS.map(k => (
              <button key={k} style={segBtnStyle(kind === k, { wide: true })} onClick={() => setKind(k)}>{t(KIND_KEY[k])}</button>
            ))}
          </div>
        )}

        <div>
          <label style={labelStyle}>{t('finance_store_product_name')}</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
            placeholder={t('finance_store_product_placeholder')} autoFocus />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_store_category')}</label>
            <input style={inputStyle} list="finance-store-categories" value={category} onChange={e => setCategory(e.target.value)} />
            <datalist id="finance-store-categories">
              {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div style={{ width: 130 }}>
            <label style={labelStyle}>{t('finance_store_condition')}</label>
            <select style={inputStyle} value={condition} onChange={e => setCondition(e.target.value as FinanceStoreCondition)}>
              {CONDITIONS.map(c => <option key={c} value={c}>{t(CONDITION_KEY[c])}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {kind === 'unique' && (
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t('finance_store_serial')}</label>
              <input style={inputStyle} value={serial} onChange={e => setSerial(e.target.value)} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_store_target_price')}</label>
            <input style={inputStyle} type="number" step="0.01" min="0" value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)} placeholder="0,00" />
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_store_notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 52, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {!product && (
          <>
            <p style={sectionCaptionStyle}>{t('finance_store_initial_purchase')}</p>

            <div style={{ display: 'flex', gap: 10 }}>
              {kind === 'stock' && (
                <div style={{ width: 90 }}>
                  <label style={labelStyle}>{t('finance_store_quantity')}</label>
                  <input style={inputStyle} type="number" step="1" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{t('finance_store_unit_cost')}</label>
                <input style={inputStyle} type="number" step="0.01" min="0" value={unitCost}
                  onChange={e => setUnitCost(e.target.value)} placeholder="0,00" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{t('finance_store_other_costs')}</label>
                <input style={inputStyle} type="number" step="0.01" min="0" value={otherCosts}
                  onChange={e => setOtherCosts(e.target.value)} placeholder="0,00" />
              </div>
            </div>

            {totalCost > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: -6, ...tabularNums }}>
                {t('finance_store_purchase_total', { value: formatBRL(totalCost) })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{t('finance_store_purchase_date')}</label>
                <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>{t('finance_store_supplier')}</label>
                <select style={inputStyle} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">{t('finance_store_no_supplier')}</option>
                  {store.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new">{t('finance_store_new_supplier')}</option>
                </select>
              </div>
            </div>

            {supplierId === '__new' && (
              <input style={inputStyle} value={newSupplier} onChange={e => setNewSupplier(e.target.value)}
                placeholder={t('finance_store_supplier_name_placeholder')} />
            )}

            <div>
              <label style={labelStyle}>{t('finance_store_account')}</label>
              <select style={inputStyle} value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">{t('finance_store_no_account')}</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={createExpense} disabled={!accountId}
                onChange={e => setCreateExpense(e.target.checked)} />
              {t('finance_store_create_expense')}
            </label>
          </>
        )}

        {product && (
          <div>
            <p style={{ ...sectionCaptionStyle, marginBottom: 8 }}>{t('finance_store_purchases')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {store.purchases.filter(p => p.product_id === product.id).map(p => (
                <button key={p.id} type="button" onClick={() => onEditPurchase?.(p)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)', cursor: onEditPurchase ? 'pointer' : 'default', textAlign: 'left', width: '100%' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flexShrink: 0, ...tabularNums }}>
                    {p.date.slice(8, 10)}/{p.date.slice(5, 7)}/{p.date.slice(0, 4)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tabularNums }}>
                    {p.quantity}× {formatBRL(p.unit_cost)}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0, ...tabularNums }}>
                    {formatBRL(purchaseTotal(p))}
                  </span>
                </button>
              ))}
              {onAddPurchase && (
                <button type="button" style={{ ...ghostBtnStyle, justifyContent: 'center' }} onClick={onAddPurchase}>
                  <Plus size={14} />{t('finance_store_add_purchase')}
                </button>
              )}
            </div>
          </div>
        )}

        {product && (
          <AttachmentField projectId={product.id} bucket={STORE_ATTACHMENT_BUCKET}
            value={attachments} onChange={setAttachments} />
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || !name.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || !name.trim()}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>

        {product && (
          <>
            <button style={{ ...ghostBtnStyle, justifyContent: 'center' }}
              onClick={async () => { await store.updateProduct(product.id, { archived: !product.archived }); onClose() }}>
              {product.archived ? t('finance_store_unarchive') : t('finance_store_archive')}
            </button>
            {confirming ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_store_product_delete_warning')}</span>
                <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }}
                  onClick={async () => { await store.deleteProduct(product.id); onClose() }}>{t('finance_confirm_delete')}</button>
                <button style={ghostBtnStyle} onClick={() => setConfirming(false)}>{t('finance_cancel')}</button>
              </div>
            ) : (
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)', justifyContent: 'center' }} onClick={() => setConfirming(true)}>{t('finance_delete')}</button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

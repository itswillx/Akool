import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL, fromCents, toCents } from '../../../lib/money'
import type { FinanceAccount, FinanceCategory, FinanceStoreProduct, FinanceStorePurchase, FinanceStorePurchaseStatus } from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import { AttachmentField } from '../projects/AttachmentField'
import { PURCHASE_STATUSES, PURCHASE_STATUS_KEY } from './storeUi'
import { STORE_ATTACHMENT_BUCKET, todayISO, type FinanceStoreStore } from './useFinanceStore'

// Restock (or fix) a purchase of a product. For kind='unique' the quantity is
// pinned to 1 — one row in products is one physical unit.
export function PurchaseModal({ store, product, purchase, accounts, categories, onClose }: {
  store: FinanceStoreStore
  product: FinanceStoreProduct
  purchase?: FinanceStorePurchase
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [quantity, setQuantity] = useState(String(purchase?.quantity ?? 1))
  const [unitCost, setUnitCost] = useState(purchase && purchase.unit_cost > 0 ? String(fromCents(purchase.unit_cost)) : '')
  const [otherCosts, setOtherCosts] = useState(purchase && purchase.other_costs > 0 ? String(fromCents(purchase.other_costs)) : '')
  const [date, setDate] = useState(purchase?.date ?? todayISO())
  const [supplierId, setSupplierId] = useState(purchase?.supplier_id ?? '')
  const [newSupplier, setNewSupplier] = useState('')
  const [accountId, setAccountId] = useState(purchase?.account_id ?? '')
  const [createExpense, setCreateExpense] = useState(false)
  const [categoryId, setCategoryId] = useState('')
  // Uma compra criada por aqui já aconteceu, então nasce 'received'. Quem quer
  // registrar uma cotação escolhe 'quoting' — e aí ela NÃO conta no estoque
  // nem no custo médio.
  const [status, setStatus] = useState<FinanceStorePurchaseStatus>(purchase?.status ?? 'received')
  const [notes, setNotes] = useState(purchase?.notes ?? '')
  const [attachments, setAttachments] = useState(purchase?.attachments ?? [])
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const qty = product.kind === 'unique' ? 1 : Math.max(1, Math.floor(Number(quantity) || 1))
  const total = qty * toCents(unitCost) + toCents(otherCosts)

  const handleSave = async () => {
    setSaving(true)
    try {
      let supplier = supplierId || null
      if (supplierId === '__new') {
        supplier = newSupplier.trim() ? (await store.createSupplier(newSupplier.trim()))?.id ?? null : null
      }
      const draft = {
        product_id: product.id,
        supplier_id: supplier,
        quantity: qty,
        unit_cost: toCents(unitCost),
        other_costs: toCents(otherCosts),
        date,
        account_id: accountId || null,
        notes: notes.trim(),
        attachments,
        status,
      }
      if (purchase) await store.updatePurchase(purchase.id, draft)
      else await store.createPurchase(draft, {
        createTransaction: createExpense,
        description: t('finance_store_tx_purchase_desc', { name: product.name }),
        categoryId: categoryId || null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={purchase ? t('finance_store_purchase_edit') : t('finance_store_restock_title')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{product.name}</div>

        <div>
          <label style={labelStyle}>{t('finance_store_purchase_phase')}</label>
          <select style={inputStyle} value={status}
            onChange={e => setStatus(e.target.value as FinanceStorePurchaseStatus)}>
            {PURCHASE_STATUSES.map(s => (
              <option key={s} value={s}>{t(PURCHASE_STATUS_KEY[s])}</option>
            ))}
          </select>
          {status === 'quoting' && (
            <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
              {t('finance_store_purchase_quoting_hint')}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {product.kind === 'stock' && (
            <div style={{ width: 90 }}>
              <label style={labelStyle}>{t('finance_store_quantity')}</label>
              <input style={inputStyle} type="number" step="1" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} autoFocus />
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

        {total > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: -6, ...tabularNums }}>
            {t('finance_store_purchase_total', { value: formatBRL(total) })}
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

        {!purchase && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={createExpense} disabled={!accountId}
                onChange={e => setCreateExpense(e.target.checked)} />
              {t('finance_store_create_expense')}
            </label>
            {createExpense && (
              <div>
                <label style={labelStyle}>{t('finance_store_tx_category')}</label>
                <select style={inputStyle} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                  <option value="">{t('finance_import_no_category')}</option>
                  {categories.filter(c => c.type === 'expense').map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
                <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                  {t('finance_store_tx_category_hint')}
                </div>
              </div>
            )}
          </>
        )}

        <div>
          <label style={labelStyle}>{t('finance_store_notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {purchase && (
          <AttachmentField projectId={purchase.id} bucket={STORE_ATTACHMENT_BUCKET}
            value={attachments} onChange={setAttachments} />
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>

        {purchase && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_store_purchase_delete_warning')}</span>
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }}
                onClick={async () => { await store.deletePurchase(purchase.id); onClose() }}>{t('finance_confirm_delete')}</button>
              <button style={ghostBtnStyle} onClick={() => setConfirming(false)}>{t('finance_cancel')}</button>
            </div>
          ) : (
            <button style={{ ...ghostBtnStyle, color: 'var(--color-error)', justifyContent: 'center' }} onClick={() => setConfirming(true)}>{t('finance_delete')}</button>
          )
        )}
      </div>
    </Modal>
  )
}

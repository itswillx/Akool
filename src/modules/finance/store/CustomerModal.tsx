import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { FinanceStoreChannel, FinanceStoreCustomer } from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle } from '../ui'
import { CHANNELS, CHANNEL_KEY } from './storeUi'
import type { FinanceStoreStore } from './useFinanceStore'

// Create/edit form for a customer. Deleting keeps the sale history — the FK is
// ON DELETE SET NULL, mirrored by the hook.
export function CustomerModal({ store, customer, onClose, onCreated }: {
  store: FinanceStoreStore
  customer?: FinanceStoreCustomer
  onClose: () => void
  /** Lets the sale form pick the customer it just created inline. */
  onCreated?: (customer: FinanceStoreCustomer) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [city, setCity] = useState(customer?.city ?? '')
  const [channel, setChannel] = useState<FinanceStoreChannel>(customer?.channel ?? 'olx')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const draft = { name: name.trim(), phone: phone.trim(), city: city.trim(), channel, notes: notes.trim() }
      if (customer) await store.updateCustomer(customer.id, draft)
      else {
        const created = await store.createCustomer(draft)
        if (created) onCreated?.(created)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={customer ? t('finance_store_customer_edit') : t('finance_store_customer_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_store_customer_name')}</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_store_phone')}</label>
            <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="(19) 99999-9999" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_store_city')}</label>
            <input style={inputStyle} value={city} onChange={e => setCity(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_store_origin')}</label>
          <select style={inputStyle} value={channel} onChange={e => setChannel(e.target.value as FinanceStoreChannel)}>
            {CHANNELS.map(c => <option key={c} value={c}>{t(CHANNEL_KEY[c])}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_store_notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 52, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || !name.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || !name.trim()}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>

        {customer && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_store_customer_delete_warning')}</span>
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }}
                onClick={async () => { await store.deleteCustomer(customer.id); onClose() }}>{t('finance_confirm_delete')}</button>
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

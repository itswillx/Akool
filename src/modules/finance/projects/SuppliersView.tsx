import { useState } from 'react'
import { Phone, Plus, Store } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import { spentBySupplier } from '../../../lib/financeProjectCalc'
import type { FinanceSupplier } from '../../../types'
import { Modal, cardSurfaceStyle, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import { emptyStateStyle, rowStyle } from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

function SupplierModal({ supplier, onClose, onSave, onDelete }: {
  supplier?: FinanceSupplier
  onClose: () => void
  onSave: (form: { name: string; phone: string; website: string; notes: string }) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [website, setWebsite] = useState(supplier?.website ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), phone: phone.trim(), website: website.trim(), notes: notes.trim() })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={supplier ? t('finance_proj_supplier_edit') : t('finance_proj_supplier_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_proj_supplier_name')}</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={t('finance_proj_store_placeholder')} autoFocus />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_proj_phone')}</label>
          <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_proj_website')}</label>
          <input style={inputStyle} value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_proj_notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 52, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || !name.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || !name.trim()}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>
        {supplier && onDelete && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_proj_supplier_delete_warning')}</span>
              <button style={{ ...ghostBtnStyle, color: 'var(--color-error)' }} onClick={async () => { await onDelete(); onClose() }}>{t('finance_confirm_delete')}</button>
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

// Suppliers are scoped to the user, not to one project — the spend ranking is
// deliberately computed across every obra ("quanto já gastei na Leroy").
export function SuppliersView({ store }: { store: FinanceProjectsStore }) {
  const { t } = useLanguage()
  const [modal, setModal] = useState<{ open: boolean; supplier?: FinanceSupplier }>({ open: false })
  const spend = spentBySupplier(store.expenses, store.suppliers, t('finance_proj_no_supplier'))
  const totalFor = (id: string) => spend.find(s => s.supplier_id === id)?.total ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_proj_suppliers_hint')}</div>
        <button style={primaryBtnStyle} onClick={() => setModal({ open: true })}>
          <Plus size={15} />{t('finance_proj_supplier_new')}
        </button>
      </div>

      {store.suppliers.length === 0 ? (
        <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>
          <Store size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>{t('finance_proj_suppliers_empty')}</div>
        </div>
      ) : (
        <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
          {store.suppliers.map((supplier, idx) => (
            <button key={supplier.id} onClick={() => setModal({ open: true, supplier })}
              style={{ ...rowStyle, width: '100%', background: 'none', border: 'none', borderBottom: idx < store.suppliers.length - 1 ? '1px solid var(--color-border)' : 'none', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--color-text-muted)' }}>
                <Store size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-text)' }}>{supplier.name}</div>
                {supplier.phone && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Phone size={11} />{supplier.phone}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', ...tabularNums, flexShrink: 0 }}>
                {formatBRL(totalFor(supplier.id))}
              </div>
            </button>
          ))}
        </div>
      )}

      {modal.open && (
        <SupplierModal
          supplier={modal.supplier}
          onClose={() => setModal({ open: false })}
          onSave={async form => {
            if (modal.supplier) await store.updateSupplier(modal.supplier.id, form)
            else await store.createSupplier(form)
          }}
          onDelete={modal.supplier ? () => store.deleteSupplier(modal.supplier!.id) : undefined}
        />
      )}
    </div>
  )
}

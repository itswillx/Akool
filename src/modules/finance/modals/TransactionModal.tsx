// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Camera, ChevronDown, Download, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Field, FieldGroup } from '../../../components/Field'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import { resolveSignedUrl } from '../../../lib/storageUrl'
import { supabase } from '../../../lib/supabase'
import { uploadContextBucket, validateUpload } from '../../../lib/uploadValidation'
import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceTxType, FinanceWorkspace } from '../../../types'
import {
Drawer,
FIN_ACCENT,
FIN_NEG,
FIN_NEG_SOFT,
FIN_POS,
FIN_POS_SOFT,
ghostBtnStyle,
inputStyle, labelStyle,
Modal,
primaryBtnStyle,
segBtnStyle,
segTrackStyle,
useFinanceMobile
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'
import { UserPicker } from './pickers'

interface TxForm {
  type: FinanceTxType
  amount: string
  description: string
  date: string
  account_id: string
  category_id: string
  shared_with_user_id: string
  share_with_family: boolean
}

// QA-003: exportado para o teste de componente (TransactionModal.test.tsx).
export function TransactionModal({
  tx, personalAccounts, familyAccounts, personalCategories, familyCategories, partners, userId, workspace, onClose, onSave, onDelete,
}: {
  tx?: FinanceTransaction
  personalAccounts: FinanceAccount[]
  familyAccounts: FinanceAccount[]
  personalCategories: FinanceCategory[]
  familyCategories: FinanceCategory[]
  partners: PartnerProfile[]
  userId: string
  workspace?: FinanceWorkspace | null
  onClose: () => void
  onSave: (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState<TxForm>({
    type: tx?.type ?? 'expense',
    amount: tx ? String(fromCents(tx.amount)) : '',
    description: tx?.description ?? '',
    date: tx?.date ?? today,
    account_id: tx?.account_id ?? '',
    category_id: tx?.category_id ?? '',
    shared_with_user_id: tx?.shared_with_user_id ?? '',
    // New transactions default to personal; editing keeps the row's scope.
    share_with_family: tx ? !!(tx.workspace_id && workspace) : false,
  })
  // Categories/accounts depend on whether the transaction is shared with the family (workspace-scoped) or personal
  const categories = form.share_with_family ? familyCategories : personalCategories
  const accounts = form.share_with_family ? familyAccounts : personalAccounts
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)

  // Resolve o photo_url armazenado (path do bucket privado) para uma signed URL
  // uma unica vez ao montar; escolha de arquivo novo sobrescreve via handlePhotoChange.
  useEffect(() => {
    let active = true
    if (tx?.photo_url) {
      resolveSignedUrl('transaction-photos', tx.photo_url).then(url => {
        if (active) setPhotoPreview(url)
      })
    }
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const filteredCats = categories.filter(c => c.type === form.type)

  const handlePhotoChange = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setPhotoFile(file)
    setPhotoRemoved(false)
    setConfirmRemovePhoto(false)
    const reader = new FileReader()
    reader.onload = e => setPhotoPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handlePhotoRemove = () => {
    setPhotoFile(null)
    setPhotoPreview(null)
    setPhotoRemoved(true)
    setConfirmRemovePhoto(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const handlePhotoDownload = async () => {
    if (!photoPreview) return
    try {
      const res = await fetch(photoPreview)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `comprovante_${Date.now()}.${blob.type.split('/')[1] ?? 'jpg'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(photoPreview, '_blank')
    }
  }

  const handleSave = async () => {
    const amt = toCents(form.amount)
    if (!amt || amt <= 0) return
    setSaving(true)
    setSaveError(null)

    let photoUrl: string | null | undefined = undefined
    if (photoFile) {
      // SEC-011: tipo e tamanho conferidos antes do upload; a extensão vem do
      // MIME validado, nunca do nome do arquivo.
      const checked = validateUpload('transaction-photo', photoFile)
      if (!checked.ok) {
        setSaveError(t(checked.reason === 'too_large' ? 'upload_error_too_large' : 'upload_error_invalid_type'))
        setSaving(false)
        return
      }
      const path = `${userId}/${Date.now()}.${checked.ext}`
      const { error: uploadErr } = await supabase.storage
        .from(uploadContextBucket('transaction-photo'))
        .upload(path, checked.file, { contentType: checked.file.type, upsert: false })
      if (uploadErr) {
        setSaveError(t('finance_photo_upload_error'))
        setSaving(false)
        return
      }
      // Bucket privado: persiste o path; a URL assinada e' gerada no render.
      photoUrl = path
    } else if (photoRemoved) {
      photoUrl = null
    } else {
      photoUrl = tx?.photo_url ?? null
    }

    try {
      await onSave({
        type: form.type,
        amount: amt,
        description: form.description.trim(),
        date: form.date,
        account_id: form.account_id || null,
        category_id: form.category_id || null,
        shared_with_user_id: form.share_with_family ? null : (form.shared_with_user_id || null),
        workspace_id: (form.share_with_family && workspace) ? workspace.id : null,
        photo_url: photoUrl ?? null,
      })
      onClose()
    } catch {
      setSaveError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await onDelete?.()
      onClose()
    } catch {
      setSaveError(t('finance_delete_error'))
    } finally {
      setSaving(false)
    }
  }

  const accent = form.type === 'income' ? FIN_POS : FIN_NEG

  const photoSection = (
    <FieldGroup label={t('finance_tx_receipt')} labelStyle={labelStyle}>
      {photoPreview ? (
        <div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={photoPreview}
              alt={t('finance_tx_receipt')}
              style={{ display: 'block', maxHeight: 120, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--color-border)', objectFit: 'contain', backgroundColor: '#000' }}
            />
            <div style={{ position: 'absolute', top: 5, right: 5, display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={handlePhotoDownload}
                title={t('finance_photo_download')}
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemovePhoto(true)}
                title={t('finance_photo_remove')}
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {confirmRemovePhoto && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: '#dc2626' }}>{t('finance_photo_remove_confirm')}</span>
              <button type="button" onClick={handlePhotoRemove}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {t('finance_remove')}
              </button>
              <button type="button" onClick={() => setConfirmRemovePhoto(false)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', fontSize: 12, cursor: 'pointer' }}>
                {t('finance_cancel')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, border: '1.5px dashed var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 14, width: '100%', justifyContent: 'center' }}
        >
          <Camera size={16} />
          {t('finance_tx_attach_receipt')}
        </button>
      )}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoChange(f) }}
      />
    </FieldGroup>
  )

  // ─── Mobile: quick-entry bottom sheet ───────────────────────────────────────
  if (isMobile) {
    return (
      <Modal title={tx ? t('finance_edit') : t('finance_new_transaction')} onClose={onClose}>
        {/* Type toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {(['expense', 'income'] as FinanceTxType[]).map(tp => (
            <button
              key={tp}
              onClick={() => setForm(f => ({ ...f, type: tp, category_id: '' }))}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12, border: '2px solid',
                borderColor: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-border)',
                backgroundColor: form.type === tp ? (tp === 'income' ? FIN_POS_SOFT : '#ef444422') : 'transparent',
                color: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-text-muted)',
                cursor: 'pointer', fontWeight: 700, fontSize: 15,
              }}
            >
              {tp === 'income' ? t('finance_tx_income') : t('finance_tx_expense')}
            </button>
          ))}
        </div>

        {/* Big amount */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0 18px' }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-muted)' }}>R$</span>
          <input
            inputMode="decimal"
            type="text"
            aria-label={t('finance_tx_amount')}
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^0-9.,]/g, '') }))}
            placeholder="0,00"
            className="keep-font-size"
            style={{ width: '60%', border: 'none', backgroundColor: 'transparent', fontSize: 44, fontWeight: 800, color: accent, textAlign: 'center', padding: 0 }}
          />
        </div>

        {/* Category chips */}
        <FieldGroup label={t('finance_tx_category')} labelStyle={labelStyle} style={{ marginBottom: 16 }}>
          <div className="finance-hide-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
            <button type="button" onClick={() => setForm(f => ({ ...f, category_id: '' }))}
              style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 20, border: '1.5px solid', borderColor: !form.category_id ? 'var(--color-text)' : 'var(--color-border)', backgroundColor: !form.category_id ? 'var(--color-active)' : 'var(--color-surface)', color: !form.category_id ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', minHeight: 40 }}>
              {t('finance_tx_none_category')}
            </button>
            {filteredCats.map(c => {
              const sel = form.category_id === c.id
              return (
                <button key={c.id} type="button" onClick={() => setForm(f => ({ ...f, category_id: c.id }))}
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 20, border: '1.5px solid', borderColor: sel ? c.color : 'var(--color-border)', backgroundColor: sel ? `${c.color}22` : 'var(--color-surface)', color: sel ? c.color : 'var(--color-text)', cursor: 'pointer', fontSize: 13, fontWeight: sel ? 700 : 500, whiteSpace: 'nowrap', minHeight: 40 }}>
                  <span style={{ fontSize: 16 }}>{c.icon}</span>{c.name}
                </button>
              )
            })}
          </div>
        </FieldGroup>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <Field label={t('finance_tx_description')} labelStyle={labelStyle}>{control => (
            <input {...control} style={{ ...inputStyle, padding: '12px 12px', fontSize: 15 }} type="text" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={form.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')} />
          )}</Field>
        </div>

        {/* More options (collapsed) */}
        <button type="button" onClick={() => setShowMore(s => !s)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 0', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 600 }}>
          <ChevronDown size={15} style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          {t('finance_more_options')}
        </button>
        {showMore && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
            <div>
              <Field label={t('finance_tx_date')} labelStyle={labelStyle}>{control => (
                <input {...control} style={{ ...inputStyle, padding: '12px 12px', fontSize: 15 }} type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              )}</Field>
            </div>
            <div>
              <Field label={t('finance_tx_account')} labelStyle={labelStyle}>{control => (
                <select {...control} style={{ ...inputStyle, padding: '12px 12px', fontSize: 15 }} value={form.account_id}
                  onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
                  <option value="">{t('finance_tx_none_account')}</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                  ))}
                </select>
              )}</Field>
            </div>
            {workspace ? (
              <FieldGroup label={t('finance_share_family')} labelStyle={labelStyle}>
                <button type="button" onClick={() => setForm(f => ({ ...f, share_with_family: !f.share_with_family, category_id: '', account_id: '' }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: form.share_with_family ? 'var(--color-active)' : 'var(--color-bg)', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: form.share_with_family ? FIN_ACCENT : 'var(--color-border)', position: 'relative', transition: 'background-color 0.2s', flexShrink: 0 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', top: 2, left: form.share_with_family ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{workspace.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                      {form.share_with_family ? t('finance_scope_shared_on') : t('finance_scope_personal_only')}
                    </span>
                  </div>
                </button>
              </FieldGroup>
            ) : (
              <UserPicker
                label={t('finance_share_with')}
                value={form.shared_with_user_id}
                onChange={id => setForm(f => ({ ...f, shared_with_user_id: id }))}
                knownPartners={partners}
              />
            )}
            {photoSection}
          </div>
        )}

        {/* Sticky footer actions */}
        <div style={{ position: 'sticky', bottom: 0, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20, paddingTop: 12, backgroundColor: 'var(--color-bg)' }}>
          {saveError && (
            <div style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
              {saveError}
            </div>
          )}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '15px 16px', borderRadius: 12, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
            {t('finance_save')}
          </button>
          {tx && onDelete && (
            confirming ? (
              <button onClick={handleDelete} disabled={saving}
                style={{ padding: '13px 16px', borderRadius: 12, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 15, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {t('finance_confirm_delete')}
              </button>
            ) : (
              <button onClick={() => setConfirming(true)}
                style={{ padding: '13px 16px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Trash2 size={15} />{t('finance_delete')}
              </button>
            )
          )}
        </div>
      </Modal>
    )
  }

  // ─── Desktop: right-side drawer ──────────────────────────────────────────────
  return (
    <Drawer
      title={tx ? t('finance_edit') : t('finance_new_transaction')}
      onClose={onClose}
      footer={
        <>
          {tx && onDelete && (
            confirming ? (
              <button onClick={handleDelete} disabled={saving}
                style={{ border: 'none', background: FIN_NEG, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {t('finance_confirm_delete')}
              </button>
            ) : (
              <button onClick={() => setConfirming(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${FIN_NEG}`, background: 'var(--color-surface)', color: FIN_NEG, fontSize: 13, fontWeight: 600, padding: '9px 13px', borderRadius: 8, cursor: 'pointer' }}>
                <Trash2 size={15} />{t('finance_delete')}
              </button>
            )
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtnStyle}>{t('finance_cancel')}</button>
          <button onClick={handleSave} disabled={saving} style={{ ...primaryBtnStyle, padding: '10px 18px', opacity: saving ? 0.7 : 1 }}>{t('finance_save')}</button>
        </>
      }
    >
      {/* Type toggle */}
      <div style={{ ...segTrackStyle, display: 'flex' }}>
        <button onClick={() => setForm(f => ({ ...f, type: 'expense', category_id: '' }))} style={segBtnStyle(form.type === 'expense', { wide: true })}>{t('finance_tx_expense')}</button>
        <button onClick={() => setForm(f => ({ ...f, type: 'income', category_id: '' }))} style={segBtnStyle(form.type === 'income', { wide: true })}>{t('finance_tx_income')}</button>
      </div>

      <div>
        <Field label={t('finance_tx_amount')} labelStyle={labelStyle}>{control => (
          <input {...control} style={inputStyle} type="number" min="0" step="0.01" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
        )}</Field>
      </div>
      <div>
        <Field label={t('finance_tx_description')} labelStyle={labelStyle}>{control => (
          <input {...control} style={inputStyle} type="text" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder={form.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')} />
        )}</Field>
      </div>
      <div>
        <Field label={t('finance_tx_category')} labelStyle={labelStyle}>{control => (
          <select {...control} style={inputStyle} value={form.category_id}
            onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">{t('finance_tx_none_category')}</option>
            {filteredCats.map(c => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
        )}</Field>
      </div>
      <div>
        <Field label={t('finance_tx_account')} labelStyle={labelStyle}>{control => (
          <select {...control} style={inputStyle} value={form.account_id}
            onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
            <option value="">{t('finance_tx_none_account')}</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
            ))}
          </select>
        )}</Field>
      </div>
      <div>
        <Field label={t('finance_tx_date')} labelStyle={labelStyle}>{control => (
          <input {...control} style={inputStyle} type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        )}</Field>
      </div>
      {workspace ? (
        <FieldGroup label={t('finance_share_family')} labelStyle={labelStyle}>
          <button type="button" onClick={() => setForm(f => ({ ...f, share_with_family: !f.share_with_family, category_id: '', account_id: '' }))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: form.share_with_family ? 'var(--color-active)' : 'var(--color-surface)', cursor: 'pointer', transition: 'all 0.15s' }}>
            <div style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: form.share_with_family ? FIN_ACCENT : 'var(--color-border)', position: 'relative', transition: 'background-color 0.2s', flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', top: 2, left: form.share_with_family ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{workspace.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                {form.share_with_family ? t('finance_scope_shared_on') : t('finance_scope_personal_only')}
              </span>
            </div>
          </button>
        </FieldGroup>
      ) : (
        <UserPicker
          label={t('finance_share_with')}
          value={form.shared_with_user_id}
          onChange={id => setForm(f => ({ ...f, shared_with_user_id: id }))}
          knownPartners={partners}
        />
      )}

      {photoSection}

      {saveError && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: FIN_NEG_SOFT, color: FIN_NEG, fontSize: 13, fontWeight: 600 }}>
          {saveError}
        </div>
      )}
    </Drawer>
  )
}

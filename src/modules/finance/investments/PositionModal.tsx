import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import type { FinanceAccount, FinanceInvestment, FinanceInvestmentAssetClass } from '../../../types'
import { Modal, inputStyle, labelStyle, primaryBtnStyle, ghostBtnStyle, FIN_NEG } from '../ui'
import { ASSET_CLASSES, ASSET_CLASS_KEY } from './investmentsUi'
import type { PositionDraft } from './useInvestmentMutations'

// Positions are born from the statement import, so this modal only EDITS.
// It exists even though there is no manual entry flow, because the import has
// no way to know two things:
//   • `opening_balance` — what was already applied before the first imported
//     statement. Without it the applied total starts at zero for someone who
//     has held a CDB for years.
//   • the label — the classifier names the product from regex tokens
//     ('C6 · CDB'), which is right but not always how the user calls it.
export function PositionModal({ position, accounts, onSave, onDelete, onClose }: {
  position: FinanceInvestment
  accounts: FinanceAccount[]
  onSave: (draft: PositionDraft) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [institution, setInstitution] = useState(position.institution)
  const [product, setProduct] = useState(position.product)
  const [assetClass, setAssetClass] = useState<FinanceInvestmentAssetClass>(position.asset_class)
  const [accountId, setAccountId] = useState(position.account_id ?? '')
  const [opening, setOpening] = useState(String(fromCents(position.opening_balance)))
  const [archived, setArchived] = useState(position.archived)
  const [notes, setNotes] = useState(position.notes)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await onSave({
      institution: institution.trim(),
      product: product.trim(),
      asset_class: assetClass,
      account_id: accountId || null,
      opening_balance: toCents(opening),
      archived,
      notes: notes.trim(),
    })
    onClose()
  }

  return (
    <Modal title={t('finance_invest_edit_position')} onClose={onClose} width={480}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={labelStyle}>{t('finance_invest_institution')}</label>
            <input style={inputStyle} value={institution} onChange={e => setInstitution(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={labelStyle}>{t('finance_invest_product')}</label>
            <input style={inputStyle} value={product} onChange={e => setProduct(e.target.value)} required />
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_invest_class')}</label>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={assetClass}
            onChange={e => setAssetClass(e.target.value as FinanceInvestmentAssetClass)}>
            {ASSET_CLASSES.map(c => <option key={c} value={c}>{t(ASSET_CLASS_KEY[c])}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_invest_account')}</label>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">{t('finance_invest_no_account')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_invest_opening_balance')}</label>
          <input style={inputStyle} type="number" step="0.01" value={opening} onChange={e => setOpening(e.target.value)} />
          <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
            {t('finance_invest_opening_balance_hint')}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_invest_notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} style={{ cursor: 'pointer' }} />
          {t('finance_invest_archive')}
        </label>

        <div style={{ display: 'flex', gap: 9, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
          {confirmDelete ? (
            <>
              <span style={{ flex: 1, fontSize: 12.5, color: FIN_NEG, alignSelf: 'center' }}>
                {t('finance_invest_delete_confirm')}
              </span>
              <button type="button" onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>
                {t('finance_import_back')}
              </button>
              <button type="button" onClick={async () => { await onDelete(); onClose() }}
                style={{ ...primaryBtnStyle, background: FIN_NEG }}>
                {t('finance_invest_delete_position')}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...ghostBtnStyle, color: FIN_NEG }}>
                {t('finance_invest_delete_position')}
              </button>
              <div style={{ flex: 1 }} />
              <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>
                {t('finance_save')}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}

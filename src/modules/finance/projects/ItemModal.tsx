import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL, fromCents, toCents } from '../../../lib/money'
import { itemEstimatedTotal } from '../../../lib/financeProjectCalc'
import type {
  FinanceProject,
  FinanceProjectItem,
  FinanceProjectItemPriority,
  FinanceProjectItemStatus,
} from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import { AttachmentField } from './AttachmentField'
import { QuotesPanel } from './QuotesPanel'
import {
  ITEM_PRIORITIES, ITEM_STATUSES, ITEM_STATUS_KEY, PRIORITY_KEY, UNIT_SUGGESTIONS,
} from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

export interface ItemDraft {
  stage_id: string | null
  name: string
  notes: string
  quantity: number
  unit: string
  estimated_unit_price: number
  status: FinanceProjectItemStatus
  priority: FinanceProjectItemPriority
  attachments: FinanceProjectItem['attachments']
}

export function ItemModal({ project, store, item, onClose, onSave, onDelete, onBuy }: {
  project: FinanceProject
  store: FinanceProjectsStore
  item?: FinanceProjectItem
  onClose: () => void
  onSave: (draft: ItemDraft) => Promise<void>
  onDelete?: () => Promise<void>
  /** Opens the expense modal pre-filled from this item and its chosen quote. */
  onBuy?: (item: FinanceProjectItem) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(item?.name ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit ?? 'un')
  const [price, setPrice] = useState(item && item.estimated_unit_price > 0 ? String(fromCents(item.estimated_unit_price)) : '')
  const [stageId, setStageId] = useState(item?.stage_id ?? '')
  const [status, setStatus] = useState<FinanceProjectItemStatus>(item?.status ?? 'planned')
  const [priority, setPriority] = useState<FinanceProjectItemPriority>(item?.priority ?? 'normal')
  const [attachments, setAttachments] = useState(item?.attachments ?? [])
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const stages = store.stages.filter(s => s.project_id === project.id)
  const qty = Number(quantity.replace(',', '.')) || 0
  const estimated = itemEstimatedTotal({ quantity: qty, estimated_unit_price: toCents(price) })

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({
        stage_id: stageId || null,
        name: name.trim(),
        notes: notes.trim(),
        quantity: qty,
        unit: unit.trim() || 'un',
        estimated_unit_price: toCents(price),
        status,
        priority,
        attachments,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={item ? t('finance_proj_item_edit') : t('finance_proj_item_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_proj_item_name')}</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)}
            placeholder={t('finance_proj_item_placeholder')} autoFocus />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_qty')}</label>
            <input style={inputStyle} type="number" step="0.001" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div style={{ width: 100 }}>
            <label style={labelStyle}>{t('finance_proj_unit')}</label>
            <input style={inputStyle} list="finance-proj-units" value={unit} onChange={e => setUnit(e.target.value)} />
            <datalist id="finance-proj-units">
              {UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_unit_price')}</label>
            <input style={inputStyle} type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0,00" />
          </div>
        </div>

        {estimated > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: -6, ...tabularNums }}>
            {t('finance_proj_estimated_total', { value: formatBRL(estimated) })}
          </div>
        )}

        <div>
          <label style={labelStyle}>{t('finance_proj_stage')}</label>
          <select style={inputStyle} value={stageId} onChange={e => setStageId(e.target.value)}>
            <option value="">{t('finance_proj_no_stage')}</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_item_status')}</label>
            <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as FinanceProjectItemStatus)}>
              {ITEM_STATUSES.map(s => <option key={s} value={s}>{t(ITEM_STATUS_KEY[s])}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('finance_proj_priority')}</label>
            <select style={inputStyle} value={priority} onChange={e => setPriority(e.target.value as FinanceProjectItemPriority)}>
              {ITEM_PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEY[p])}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_proj_notes')}</label>
          <textarea style={{ ...inputStyle, minHeight: 52, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={t('finance_proj_item_notes_placeholder')} />
        </div>

        {/* Quotes need a persisted item to hang off, so they only show on edit. */}
        {item
          ? <QuotesPanel item={item} store={store} projectId={project.id} />
          : <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_proj_quotes_after_save')}</div>}

        {item && <AttachmentField projectId={project.id} value={attachments} onChange={setAttachments} />}

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || !name.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || !name.trim()}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>

        {item && onBuy && item.status !== 'purchased' && (
          <button style={{ ...ghostBtnStyle, justifyContent: 'center' }} onClick={() => onBuy(item)}>
            <ShoppingCart size={14} />{t('finance_proj_buy_now')}
          </button>
        )}

        {item && onDelete && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_proj_item_delete_warning')}</span>
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

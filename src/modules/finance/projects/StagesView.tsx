import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { fromCents, toCents } from '../../../lib/money'
import { formatBRL } from '../../../lib/money'
import { stageTotals } from '../../../lib/financeProjectCalc'
import type { FinanceProject, FinanceProjectStage } from '../../../types'
import { EmojiInput, Modal, cardSurfaceStyle, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, segBtnStyle, segTrackStyle, tabularNums } from '../ui'
import type { FinanceProjectsStore } from './useFinanceProjects'
import { budgetBarColor, emptyStateStyle } from './projectsUi'
import { StagesBoard } from './StagesBoard'

const STAGE_COLORS = ['#64748b', '#f59e0b', '#6366f1', '#10b981', '#ef4444', '#0ea5e9', '#a855f7']

function StageModal({ stage, onClose, onSave, onDelete }: {
  stage?: FinanceProjectStage
  onClose: () => void
  onSave: (form: { name: string; icon: string; color: string; budget_amount: number }) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(stage?.name ?? '')
  const [icon, setIcon] = useState(stage?.icon ?? '🧱')
  const [color, setColor] = useState(stage?.color ?? STAGE_COLORS[0])
  const [budget, setBudget] = useState(stage && stage.budget_amount > 0 ? String(fromCents(stage.budget_amount)) : '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), icon, color, budget_amount: toCents(budget) })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={stage ? t('finance_proj_stage_edit') : t('finance_proj_stage_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_proj_stage_name')}</label>
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={t('finance_proj_stage_placeholder')} autoFocus />
        </div>
        <EmojiInput value={icon} onChange={setIcon} label={t('finance_proj_icon')} />
        <div>
          <label style={labelStyle}>{t('finance_proj_color')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STAGE_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)}
                style={{ width: 28, height: 28, borderRadius: 7, background: c, cursor: 'pointer', border: color === c ? '2px solid var(--color-text)' : '1px solid var(--color-border)' }} />
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('finance_proj_stage_budget')}</label>
          <input style={inputStyle} type="number" step="0.01" min="0" value={budget}
            onChange={e => setBudget(e.target.value)} placeholder={t('finance_proj_budget_optional')} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: saving || !name.trim() ? 0.7 : 1 }}
            onClick={handleSave} disabled={saving || !name.trim()}>{t('finance_save')}</button>
          <button style={ghostBtnStyle} onClick={onClose}>{t('finance_cancel')}</button>
        </div>
        {stage && onDelete && (
          confirming ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_proj_stage_delete_warning')}</span>
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

// Duas leituras das mesmas etapas: "Orçamento" gerencia as etapas (criar,
// editar, teto × gasto) e "Quadro de itens" mostra os itens distribuídos entre
// elas, arrastáveis. O quadro traz o próprio toggle Kanban/Lista.
type StagesMode = 'budget' | 'board'

const MODE_KEY = 'finance_proj_stages_mode'

export function StagesView({ project, store }: { project: FinanceProject; store: FinanceProjectsStore }) {
  const { t } = useLanguage()
  const [modal, setModal] = useState<{ open: boolean; stage?: FinanceProjectStage }>({ open: false })
  const [mode, setMode] = useState<StagesMode>(() =>
    localStorage.getItem(MODE_KEY) === 'board' ? 'board' : 'budget')
  const stages = store.stages.filter(s => s.project_id === project.id)
  const items = store.items.filter(i => i.project_id === project.id)
  const expenses = store.expenses.filter(e => e.project_id === project.id)

  const selectMode = (next: StagesMode) => {
    setMode(next)
    localStorage.setItem(MODE_KEY, next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={segTrackStyle}>
          <button style={segBtnStyle(mode === 'budget')} onClick={() => selectMode('budget')}>
            {t('finance_proj_stages_view_budget')}
          </button>
          <button style={segBtnStyle(mode === 'board')} onClick={() => selectMode('board')}>
            {t('finance_proj_stages_view_board')}
          </button>
        </div>
        <button style={primaryBtnStyle} onClick={() => setModal({ open: true })}>
          <Plus size={15} />{t('finance_proj_stage_new')}
        </button>
      </div>

      {mode === 'board' && <StagesBoard project={project} store={store} />}

      {mode === 'budget' && (stages.length === 0 ? (
        <div style={{ ...cardSurfaceStyle, ...emptyStateStyle }}>{t('finance_proj_stages_empty')}</div>
      ) : (
        <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
          {stages.map((stage, idx) => {
            const totals = stageTotals(stage, items, expenses, store.quotes)
            return (
              <div key={stage.id} style={{ padding: '13px 15px', borderBottom: idx < stages.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: `${stage.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    {stage.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{stage.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', ...tabularNums }}>
                      {totals.limit > 0
                        ? t('finance_proj_spent_of', { spent: formatBRL(totals.spent), limit: formatBRL(totals.limit) })
                        : t('finance_proj_spent_no_limit', { spent: formatBRL(totals.spent) })}
                      {totals.planned > 0 && ` · ${t('finance_proj_still_to_buy', { value: formatBRL(totals.planned) })}`}
                    </div>
                  </div>
                  <button onClick={() => setModal({ open: true, stage })} title={t('finance_edit')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
                    <Pencil size={14} />
                  </button>
                </div>
                {totals.limit > 0 && (
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
                    <div style={{ width: `${totals.pct}%`, height: '100%', background: budgetBarColor(totals.pct, totals.over) }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {modal.open && (
        <StageModal
          stage={modal.stage}
          onClose={() => setModal({ open: false })}
          onSave={async form => {
            if (modal.stage) await store.updateStage(modal.stage.id, form)
            else await store.createStage({ ...form, project_id: project.id, sort_order: stages.length })
          }}
          onDelete={modal.stage ? () => store.deleteStage(modal.stage!.id) : undefined}
        />
      )}
    </div>
  )
}

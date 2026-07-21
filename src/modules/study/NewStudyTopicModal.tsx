import { useState } from 'react'
import { ArrowLeft, CalendarClock, Check, Copy, Sparkles } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { buildStudyPrompt, STUDY_LEVELS } from '../../lib/studyPrompt'
import type { StudyParseResult } from '../../lib/studyMarkdownParser'
import { localDateISO } from '../../lib/studyProgress'
import { addDuration, type DurationUnit } from '../../lib/studySchedule'
import type { CreateTopicForm } from './useStudyTopics'
import ImportStudyMarkdown from './ImportStudyMarkdown'
import { ModalShell } from './StudyBits'
import { formatDateISO } from './studyUi'

// Two-step creation flow: (1) the user fills the title (plus optional area /
// level / focus) and either creates an empty study or moves on to (2) copy
// the standardized prompt, run it in Claude and paste the generated .md back
// for a live-parsed preview before creating the study with all its cards.

interface NewStudyTopicModalProps {
  open: boolean
  onClose: () => void
  onCreateManual: (form: CreateTopicForm) => Promise<boolean>
  onImport: (parsed: StudyParseResult, form: CreateTopicForm) => Promise<boolean>
  isMobile?: boolean
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box' as const, padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: 13.5, outline: 'none', fontFamily: 'inherit',
}

const labelStyle = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', marginBottom: 5, display: 'block',
}

export default function NewStudyTopicModal({ open, onClose, onCreateManual, onImport, isMobile }: NewStudyTopicModalProps) {
  const { t, lang } = useLanguage()
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState('')
  const [area, setArea] = useState('')
  const [level, setLevel] = useState('')
  const [objective, setObjective] = useState('')
  const [durationQty, setDurationQty] = useState('')
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('weeks')
  const [includeQuiz, setIncludeQuiz] = useState(false)
  const [quizCount, setQuizCount] = useState<5 | 10 | 15>(10)
  const [copied, setCopied] = useState(false)
  const [parsed, setParsed] = useState<StudyParseResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!open) return null

  // "Em quanto tempo pretende concluir?" — empty/invalid means no target.
  const qty = Math.floor(Number(durationQty))
  const targetDate = durationQty.trim() !== '' && Number.isFinite(qty) && qty > 0
    ? addDuration(localDateISO(), qty, durationUnit)
    : null

  const form: CreateTopicForm = { title, area, level, objective, target_date: targetDate }
  const promptInput = { ...form, duration: targetDate ? { qty, unit: durationUnit } : null, quizCount: includeQuiz ? quizCount : null }
  const canSubmitTitle = title.trim().length > 0
  const canImport = !!parsed && parsed.cards.length > 0

  const reset = () => {
    setStep(1)
    setTitle('')
    setArea('')
    setLevel('')
    setObjective('')
    setDurationQty('')
    setDurationUnit('weeks')
    setIncludeQuiz(false)
    setQuizCount(10)
    setCopied(false)
    setParsed(null)
    setSaving(false)
    setErrorMsg(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const copyPrompt = async () => {
    const prompt = buildStudyPrompt(promptInput)
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleManual = async () => {
    if (!canSubmitTitle || saving) return
    setSaving(true)
    setErrorMsg(null)
    const ok = await onCreateManual(form)
    setSaving(false)
    if (ok) reset()
    else setErrorMsg(t('study_error_generic'))
  }

  const handleImport = async () => {
    if (!parsed || !canImport || saving) return
    setSaving(true)
    setErrorMsg(null)
    const ok = await onImport(parsed, form)
    setSaving(false)
    if (ok) reset()
    else setErrorMsg(t('study_error_generic'))
  }

  const primaryBtn = (label: string, onClick: () => void, disabled: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      {label}
    </button>
  )

  const secondaryBtn = (label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
    >
      {label}
    </button>
  )

  return (
    <ModalShell title={t('study_new_title')} onClose={handleClose} isMobile={isMobile}>
      {step === 1 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>{t('study_form_title')}</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('study_form_title_placeholder')} style={inputStyle} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>{t('study_form_area')}</label>
              <input value={area} onChange={e => setArea(e.target.value)} placeholder={t('study_area_placeholder')} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('study_form_level')}</label>
              <select
                value={level}
                onChange={e => setLevel(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">{t('study_level_none')}</option>
                {STUDY_LEVELS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('study_form_objective')}</label>
            <input value={objective} onChange={e => setObjective(e.target.value)} placeholder={t('study_objective_placeholder')} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('study_form_duration')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={durationQty}
                onChange={e => setDurationQty(e.target.value)}
                placeholder={t('study_form_duration_placeholder')}
                style={{ ...inputStyle, flex: '0 0 90px', width: 'auto' }}
              />
              <select
                value={durationUnit}
                onChange={e => setDurationUnit(e.target.value as DurationUnit)}
                style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
              >
                <option value="days">{t('study_duration_days')}</option>
                <option value="weeks">{t('study_duration_weeks')}</option>
                <option value="months">{t('study_duration_months')}</option>
              </select>
            </div>
            {targetDate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <CalendarClock size={12} />
                {t('study_form_duration_hint', { date: formatDateISO(targetDate, lang) })}
              </div>
            )}
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>
              <input
                type="checkbox"
                checked={includeQuiz}
                onChange={e => setIncludeQuiz(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer' }}
              />
              {t('study_form_quiz')}
            </label>
            {includeQuiz && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('study_form_quiz_count')}</span>
                {([5, 10, 15] as const).map(count => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setQuizCount(count)}
                    style={{
                      padding: '5px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                      border: quizCount === count ? 'none' : '1px solid var(--color-border)',
                      background: quizCount === count ? '#6366f1' : 'var(--color-bg)',
                      color: quizCount === count ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {count}
                  </button>
                ))}
              </div>
            )}
          </div>

          {errorMsg && (
            <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef444418', color: '#ef4444', fontSize: 12 }}>{errorMsg}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {secondaryBtn(t('study_cancel'), handleClose)}
            {secondaryBtn(saving ? t('study_importing') : t('study_new_manual'), handleManual, !canSubmitTitle || saving)}
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canSubmitTitle}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: canSubmitTitle ? 'pointer' : 'default', opacity: canSubmitTitle ? 1 : 0.5 }}
            >
              <Sparkles size={14} />
              {t('study_new_generate')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button
            type="button"
            onClick={() => setStep(1)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: 0, border: 'none', background: 'none', color: 'var(--color-text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <ArrowLeft size={13} />
            {t('study_back_step')}
          </button>

          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>{t('study_step_prompt')}</div>
            <textarea
              readOnly
              value={buildStudyPrompt(promptInput)}
              rows={7}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={copyPrompt}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 8, border: 'none', background: copied ? '#22c55e' : '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('study_prompt_copied') : t('study_copy_prompt')}
              </button>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1, minWidth: 180 }}>{t('study_prompt_hint')}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>{t('study_step_import')}</div>
            <ImportStudyMarkdown onResult={setParsed} />
          </div>

          {errorMsg && (
            <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef444418', color: '#ef4444', fontSize: 12 }}>{errorMsg}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            {secondaryBtn(t('study_cancel'), handleClose)}
            {primaryBtn(saving ? t('study_importing') : t('study_import_confirm'), handleImport, !canImport || saving)}
          </div>
        </div>
      )}
    </ModalShell>
  )
}

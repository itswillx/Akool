import { useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { StudyParseResult } from '../../lib/studyMarkdownParser'
import ImportStudyMarkdown from './ImportStudyMarkdown'
import { ModalShell } from './StudyBits'

// Appends the cards of a pasted/uploaded .md into an existing topic. Topic
// metadata in the file is ignored on purpose (the hint says so).

interface ImportStudyAppendModalProps {
  open: boolean
  onClose: () => void
  onAppend: (parsed: StudyParseResult) => Promise<number>
  isMobile?: boolean
}

export default function ImportStudyAppendModal({ open, onClose, onAppend, isMobile }: ImportStudyAppendModalProps) {
  const { t } = useLanguage()
  const [parsed, setParsed] = useState<StudyParseResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!open) return null

  const canAppend = !!parsed && parsed.cards.length > 0

  const handleClose = () => {
    setParsed(null)
    setSaving(false)
    setResultMsg(null)
    setErrorMsg(null)
    onClose()
  }

  const handleAppend = async () => {
    if (!parsed || !canAppend || saving) return
    setSaving(true)
    setErrorMsg(null)
    const count = await onAppend(parsed)
    setSaving(false)
    if (count > 0) {
      setResultMsg(t('study_append_success', { count }))
      setTimeout(handleClose, 1500)
    } else {
      setErrorMsg(t('study_error_generic'))
    }
  }

  return (
    <ModalShell title={t('study_append_title')} onClose={handleClose} isMobile={isMobile}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {t('study_append_hint')}
        </p>

        <ImportStudyMarkdown onResult={setParsed} />

        {errorMsg && (
          <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef444418', color: '#ef4444', fontSize: 12 }}>{errorMsg}</div>
        )}
        {resultMsg && (
          <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#22c55e18', color: '#22c55e', fontSize: 12 }}>{resultMsg}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={handleClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}
          >
            {t('study_cancel')}
          </button>
          <button
            type="button"
            onClick={handleAppend}
            disabled={!canAppend || saving}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : canAppend ? 'pointer' : 'default', opacity: canAppend ? 1 : 0.5 }}
          >
            {saving ? t('study_importing') : t('study_append_confirm')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

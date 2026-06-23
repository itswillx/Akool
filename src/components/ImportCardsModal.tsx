import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Upload, X, AlertTriangle } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { parseBacklogMarkdown } from '../lib/backlogMarkdownParser'
import { importParsedCards } from '../lib/importProjectCards'
import { supabase } from '../lib/supabase'
import type { ProjectCardPriority } from '../types'

const PRIORITY_LABELS: Record<ProjectCardPriority, 'projects_priority_low' | 'projects_priority_medium' | 'projects_priority_high' | 'projects_priority_urgent'> = {
  low: 'projects_priority_low',
  medium: 'projects_priority_medium',
  high: 'projects_priority_high',
  urgent: 'projects_priority_urgent',
}

interface ImportCardsModalProps {
  open: boolean
  onClose: () => void
  boardId: string
  columnId: string
  columnName: string
  isMobile?: boolean
  onImported: () => void
}

function ModalShell({
  title, onClose, children, isMobile,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  isMobile?: boolean
}) {
  if (isMobile) {
    return (
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '16px 20px 24px', maxHeight: '95vh', overflowY: 'auto' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function ImportCardsModal({
  open, onClose, boardId, columnId, columnName, isMobile, onImported,
}: ImportCardsModalProps) {
  const { t } = useLanguage()
  const fileRef = useRef<HTMLInputElement>(null)
  const [markdown, setMarkdown] = useState('')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [importing, setImporting] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const parseResult = useMemo(() => {
    if (!markdown.trim()) return null
    return parseBacklogMarkdown(markdown)
  }, [markdown])

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setMarkdown(String(reader.result ?? ''))
      setResultMsg(null)
      setErrorMsg(null)
    }
    reader.readAsText(file)
  }, [])

  const handleImport = async () => {
    if (!parseResult || parseResult.cards.length === 0) return
    setImporting(true)
    setErrorMsg(null)
    setResultMsg(null)

    const result = await importParsedCards(supabase, boardId, columnId, parseResult.cards, { skipDuplicates })

    setImporting(false)

    if (result.errors.length > 0) {
      setErrorMsg(result.errors.join('; '))
      return
    }

    setResultMsg(
      t('projects_import_success')
        .replace('{created}', String(result.created))
        .replace('{skipped}', String(result.skipped)),
    )
    onImported()
    if (result.created > 0) {
      setTimeout(() => {
        onClose()
        setMarkdown('')
        setResultMsg(null)
      }, 1500)
    }
  }

  if (!open) return null

  return (
    <ModalShell title={t('projects_import_title')} onClose={onClose} isMobile={isMobile}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {t('projects_import_desc')}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          <Upload size={15} />
          {t('projects_import_upload')}
        </button>

        <textarea
          value={markdown}
          onChange={e => { setMarkdown(e.target.value); setResultMsg(null); setErrorMsg(null) }}
          placeholder={t('projects_import_paste_placeholder')}
          rows={6}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
        />

        {parseResult && parseResult.cards.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
              {t('projects_import_preview').replace('{count}', String(parseResult.cards.length))}
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t('projects_import_target_column').replace('{column}', columnName)}
            </p>

            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-surface)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>ID</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('projects_table_card')}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('projects_table_priority')}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('projects_checklist')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.cards.map(card => (
                    <tr key={card.externalId} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{card.externalId}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--color-text)' }}>{card.title}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)' }}>{t(PRIORITY_LABELS[card.priority])}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)' }}>{card.checklist.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {parseResult && parseResult.warnings.length > 0 && (
          <div style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: '#f59e0b18', border: '1px solid #f59e0b44', fontSize: 12, color: 'var(--color-text)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 6 }}>
              <AlertTriangle size={14} color="#f59e0b" />
              {t('projects_import_warnings')}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {parseResult.warnings.slice(0, 8).map(w => (
                <li key={w} style={{ marginBottom: 2 }}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
          {t('projects_import_skip_duplicates')}
        </label>

        {errorMsg && (
          <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef444418', color: '#ef4444', fontSize: 12 }}>
            {errorMsg}
          </div>
        )}
        {resultMsg && (
          <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#22c55e18', color: '#22c55e', fontSize: 12 }}>
            {resultMsg}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}
          >
            {t('projects_cancel')}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || !parseResult || parseResult.cards.length === 0}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', opacity: !parseResult || parseResult.cards.length === 0 ? 0.5 : 1 }}
          >
            {importing ? t('projects_importing') : t('projects_import_confirm')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

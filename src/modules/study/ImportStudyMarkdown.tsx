import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Upload } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { parseStudyMarkdown, type StudyParseResult } from '../../lib/studyMarkdownParser'

// Reusable paste/upload + live preview piece for the Claude-generated .md,
// used by the creation modal and the append-cards modal (ImportCardsModal
// pattern: hidden file input + textarea + useMemo parse + warnings box). The
// server-limit drops get their own box above the format warnings.

interface ImportStudyMarkdownProps {
  onResult: (result: StudyParseResult | null) => void
}

export default function ImportStudyMarkdown({ onResult }: ImportStudyMarkdownProps) {
  const { t } = useLanguage()
  const fileRef = useRef<HTMLInputElement>(null)
  const [markdown, setMarkdown] = useState('')

  const parseResult = useMemo(() => {
    if (!markdown.trim()) return null
    return parseStudyMarkdown(markdown)
  }, [markdown])

  useEffect(() => {
    onResult(parseResult)
  }, [parseResult, onResult])

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => setMarkdown((typeof reader.result === 'string' ? reader.result : ''))
    reader.readAsText(file)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
      >
        <Upload size={15} />
        {t('study_import_upload')}
      </button>

      <textarea
        value={markdown}
        onChange={e => setMarkdown(e.target.value)}
        placeholder={t('study_import_paste_placeholder')}
        rows={6}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
      />

      {parseResult && parseResult.cards.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
            {t('study_import_preview', { count: parseResult.cards.length })}
          </div>
          {(parseResult.topic.title || parseResult.topic.area || parseResult.topic.level) && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {[parseResult.topic.title, parseResult.topic.area, parseResult.topic.level].filter(Boolean).join(' • ')}
            </p>
          )}
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('study_import_table_card')}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t('study_import_table_points')}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t('study_import_table_resources')}</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t('study_import_table_quiz')}</th>
                </tr>
              </thead>
              <tbody>
                {parseResult.cards.map((card, i) => (
                  <tr key={`${card.title}-${i}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '7px 10px', color: 'var(--color-text)' }}>{card.title}</td>
                    <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)' }}>{card.checkpoints.length}</td>
                    <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)' }}>{card.resources.length}</td>
                    <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)' }}>{card.quiz.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* API-021: o que passa dos limites do servidor vem primeiro e inteiro;
          os avisos de formato vêm todos, numa caixa que rola. */}
      {parseResult && parseResult.dropped.length > 0 && (
        <div style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 33%, transparent)', fontSize: 12, color: 'var(--color-text)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 6 }}>
            <AlertTriangle size={14} color="var(--color-error)" />
            {t('study_import_dropped')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {parseResult.dropped.map((message, i) => (
              <li key={`${i}-${message}`} style={{ marginBottom: 2 }}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {parseResult && parseResult.warnings.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', padding: '10px 12px', borderRadius: 8, backgroundColor: '#f59e0b18', border: '1px solid #f59e0b44', fontSize: 12, color: 'var(--color-text)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 6 }}>
            <AlertTriangle size={14} color="#f59e0b" />
            {t('study_import_warnings')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {parseResult.warnings.map((warning, i) => (
              <li key={`${i}-${warning}`} style={{ marginBottom: 2 }}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

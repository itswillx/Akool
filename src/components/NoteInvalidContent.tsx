import { useMemo, type CSSProperties } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { BlockIssue } from '../../supabase/functions/_domain/blocknote/schema'
import { extractBlocks, type LineEntry } from '../lib/pdf/noteBlocks'
import { useLanguage } from '../i18n/LanguageContext'

// API-020: guarda do NoteEditor. O conteúdo (gravado, rascunho offline ou
// remoto) tem um bloco que derrubaria o editor (o BlockNote lança no
// useCreateBlockNote, e o ErrorBoundary da seção levaria a página inteira).
// A nota aparece só para leitura, como texto simples extraído com tolerância,
// com o caminho do bloco inválido; o editor não monta e o autosave não liga
// (como no REL-004: nada sobrescreve o dado salvo).

const LINE_STYLE: Record<LineEntry['style'], CSSProperties> = {
  h1: { fontSize: 22, fontWeight: 700, margin: '14px 0 6px' },
  h2: { fontSize: 18, fontWeight: 700, margin: '12px 0 4px' },
  h3: { fontSize: 15, fontWeight: 600, margin: '10px 0 4px' },
  p: { fontSize: 14, margin: '4px 0' },
  li: { fontSize: 14, margin: '2px 0 2px 12px' },
  code: { fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: '6px 0', padding: '8px 10px', borderRadius: 6, backgroundColor: 'var(--color-bg-secondary)' },
  blank: { height: 8, margin: 0 },
}

export default function NoteInvalidContent({ content, issue, fromDraft, onDiscardDraft }: {
  content: unknown
  issue: BlockIssue
  /** O conteúdo é um rascunho local ainda não enviado: dá para descartá-lo. */
  fromDraft: boolean
  onDiscardDraft: () => void
}) {
  const { t } = useLanguage()
  const lines = useMemo(() => (Array.isArray(content) ? extractBlocks(content, t) : []), [content, t])
  const hasText = lines.some(line => line.text.trim() !== '')

  return (
    <div className="flex-1 overflow-y-auto h-full" style={{ padding: '20px 28px' }}>
      <div role="alert" style={{ display: 'flex', gap: 10, padding: '12px 14px', marginBottom: 18, borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <AlertTriangle size={18} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--color-text)' }}>
          <strong style={{ fontSize: 14 }}>{t('note_invalid_title')}</strong>
          <span>{t('note_invalid_body')}</span>
          <code style={{ fontSize: 12, color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
            {`${t('note_invalid_where').replace('{path}', issue.path || '/')} (${issue.keyword})`}
          </code>
          {fromDraft && (
            <>
              <span>{t('note_invalid_draft')}</span>
              <button
                type="button"
                onClick={onDiscardDraft}
                style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {t('note_invalid_discard_draft')}
              </button>
            </>
          )}
        </div>
      </div>
      <section aria-label={t('note_invalid_text')} style={{ color: 'var(--color-text)', lineHeight: 1.5, wordBreak: 'break-word' }}>
        {hasText
          ? lines.map((line, i) => <p key={i} style={LINE_STYLE[line.style]}>{line.text}</p>)
          : <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{t('note_invalid_no_text')}</p>}
      </section>
    </div>
  )
}

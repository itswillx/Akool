import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { projectPriorityLabelKey } from '../../lib/priorities'
import { Upload, AlertTriangle } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { parseBacklogMarkdown } from '../../lib/backlogMarkdownParser'
import { ensureTopicColumns, importParsedCards, planTopicColumns } from '../../lib/importProjectCards'
import { supabase } from '../../lib/supabase'
import type { ProjectColumn } from '../../types'
import ModalShell from './ModalShell'


// Quantos IDs pulados listar antes do "e mais N".
const MAX_LISTED_IDS = 20

const isTextFile = (file: File) => file.type.startsWith('text/') || /\.(md|markdown|txt)$/i.test(file.name)
const hasFiles = (types: readonly string[]) => types.includes('Files')

interface ImportCardsModalProps {
  open: boolean
  onClose: () => void
  boardId: string
  columns: ProjectColumn[]
  isMobile?: boolean
  onImported: () => void
}

function TargetColumnSelect({ label, columns, value, onChange }: {
  label: string
  columns: ProjectColumn[]
  value: string
  onChange: (columnId: string) => void
}) {
  const id = useId()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label htmlFor={id} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-subtle)' }}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5 }}
      >
        {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )
}

export default function ImportCardsModal({
  open, onClose, boardId, columns, isMobile, onImported,
}: ImportCardsModalProps) {
  const { t } = useLanguage()
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [markdown, setMarkdown] = useState('')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [byTopic, setByTopic] = useState(false)
  const [targetColumnId, setTargetColumnId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const [skippedMsg, setSkippedMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const parseResult = useMemo(() => {
    if (!markdown.trim()) return null
    return parseBacklogMarkdown(markdown)
  }, [markdown])

  // Coluna escolhida no select (UX-009); sem escolha, a primeira do quadro.
  const fallbackColumn = columns.find(c => c.id === targetColumnId) ?? columns[0] ?? null
  const hasTopics = !!parseResult && parseResult.topics.length > 0
  const useTopics = byTopic && hasTopics

  const columnPlan = useMemo(() => {
    if (!useTopics || !parseResult) return null
    const counts = new Map<string, number>()
    parseResult.cards.forEach(c => { if (c.topic) counts.set(c.topic, (counts.get(c.topic) ?? 0) + 1) })
    return planTopicColumns(parseResult.topics, columns).map(p => ({ ...p, cardCount: counts.get(p.topic) ?? 0 }))
  }, [useTopics, parseResult, columns])

  const untopicedCount = useTopics && parseResult ? parseResult.cards.filter(c => !c.topic).length : 0
  // Sem coluna de destino para algum card: sem opção por categoria, ou cards sem tópico.
  const missingColumn = !fallbackColumn && (!useTopics || untopicedCount > 0)

  const clearMessages = () => {
    setResultMsg(null)
    setSkippedMsg(null)
    setErrorMsg(null)
  }

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setMarkdown((typeof reader.result === 'string' ? reader.result : ''))
      setResultMsg(null)
      setSkippedMsg(null)
      setErrorMsg(null)
    }
    reader.readAsText(file)
  }, [])

  // Arquivo solto fora da área do modal abriria o .md no lugar do app.
  useEffect(() => {
    if (!open) return
    const block = (e: DragEvent) => { if (e.dataTransfer && hasFiles(e.dataTransfer.types)) e.preventDefault() }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [open])

  const handleDrop = (e: React.DragEvent) => {
    if (!hasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (isTextFile(file)) handleFile(file)
    else setErrorMsg(t('projects_import_drop_invalid'))
  }

  const listIds = (ids: string[]) => ids.length <= MAX_LISTED_IDS
    ? ids.join(', ')
    : `${ids.slice(0, MAX_LISTED_IDS).join(', ')} ${t('projects_import_more_ids', { count: ids.length - MAX_LISTED_IDS })}`

  const handleImport = async () => {
    if (!parseResult || parseResult.cards.length === 0 || missingColumn) return
    setImporting(true)
    clearMessages()

    let columnByTopic: Record<string, string> | undefined
    let columnsCreated = 0
    if (columnPlan) {
      const ensured = await ensureTopicColumns(supabase, boardId, columnPlan)
      if (ensured.error) {
        setImporting(false)
        setErrorMsg(ensured.error)
        return
      }
      columnByTopic = ensured.columnByTopic
      columnsCreated = ensured.created
    }

    const result = await importParsedCards(supabase, boardId, fallbackColumn?.id ?? null, parseResult.cards, { skipDuplicates, columnByTopic })

    setImporting(false)

    // Colunas ou lotes já gravados precisam aparecer no quadro mesmo se um lote falhar depois.
    if (columnsCreated > 0 || result.created > 0) onImported()

    if (result.skippedIds.length > 0) setSkippedMsg(t('projects_import_skipped_ids', { ids: listIds(result.skippedIds) }))

    if (result.errors.length > 0) {
      // UX-009: o texto fica no modal para tentar de novo; com "pular
      // duplicados" ligado, a nova tentativa não repete os cards já gravados.
      const error = result.errors.join('; ')
      setErrorMsg(result.created > 0 ? t('projects_import_partial_error', { created: result.created, error }) : error)
      return
    }

    const success = t('projects_import_success')
      .replace('{created}', String(result.created))
      .replace('{skipped}', String(result.skipped))
    setResultMsg(columnsCreated > 0
      ? `${success} · ${t('projects_import_columns_created').replace('{count}', String(columnsCreated))}`
      : success)
    // Com IDs pulados, o modal fica aberto para a lista ser lida.
    if (result.created > 0 && result.skippedIds.length === 0) {
      setTimeout(() => {
        onClose()
        setMarkdown('')
        setResultMsg(null)
      }, 1500)
    }
  }

  if (!open) return null

  return (
    // UX-009: com texto colado, um clique fora não fecha (perdia o texto).
    <ModalShell title={t('projects_import_title')} onClose={onClose} isMobile={isMobile} dismissOnBackdrop={!markdown.trim()}>
      <div
        onDragEnter={e => {
          if (!hasFiles(e.dataTransfer.types)) return
          e.preventDefault()
          dragDepth.current += 1
          setDragActive(true)
        }}
        onDragOver={e => { if (hasFiles(e.dataTransfer.types)) e.preventDefault() }}
        onDragLeave={e => {
          if (!hasFiles(e.dataTransfer.types)) return
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragActive(false)
        }}
        onDrop={handleDrop}
        style={{
          display: 'flex', flexDirection: 'column', gap: 14, borderRadius: 8,
          ...(dragActive ? { outline: '2px dashed var(--color-primary)', outlineOffset: 6 } : {}),
        }}
      >
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
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, border: `1px dashed ${dragActive ? 'var(--color-primary)' : 'var(--color-border)'}`, background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
        >
          <Upload size={15} />
          {dragActive ? t('projects_import_drop_hint') : t('projects_import_upload')}
        </button>

        <textarea
          aria-label={t('projects_import_paste_label')}
          value={markdown}
          onChange={e => { setMarkdown(e.target.value); clearMessages() }}
          placeholder={t('projects_import_paste_placeholder')}
          rows={6}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
        />

        {parseResult && parseResult.cards.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
              {t('projects_import_preview').replace('{count}', String(parseResult.cards.length))}
            </div>
            {hasTopics && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={byTopic} onChange={e => setByTopic(e.target.checked)} style={{ marginTop: 2 }} />
                <span>
                  {t('projects_import_by_topic').replace('{count}', String(parseResult.topics.length))}
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {t('projects_import_by_topic_hint')}
                  </span>
                </span>
              </label>
            )}

            {columnPlan ? (
              <>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {t('projects_import_target_columns')
                    .replace('{count}', String(columnPlan.length))
                    .replace('{new}', String(columnPlan.filter(p => !p.columnId).length))}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {columnPlan.map(p => (
                    <span
                      key={p.topic}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 12, color: 'var(--color-text)' }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: p.columnId ? 'var(--color-text-muted)' : p.color }} />
                      {p.name} · {p.cardCount} · <span style={{ color: 'var(--color-text-muted)' }}>{t(p.columnId ? 'projects_import_column_existing' : 'projects_import_column_new')}</span>
                    </span>
                  ))}
                </div>
                {untopicedCount > 0 && fallbackColumn && (
                  <TargetColumnSelect
                    label={t('projects_import_no_topic', { count: untopicedCount })}
                    columns={columns}
                    value={fallbackColumn.id}
                    onChange={setTargetColumnId}
                  />
                )}
              </>
            ) : fallbackColumn && (
              <TargetColumnSelect
                label={t('projects_import_target_column')}
                columns={columns}
                value={fallbackColumn.id}
                onChange={setTargetColumnId}
              />
            )}
            {missingColumn && (
              <p style={{ margin: 0, fontSize: 12, color: '#ef4444' }}>
                {t('projects_import_no_column')}
              </p>
            )}

            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-surface)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('projects_import_col_id')}</th>
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
                      <td style={{ padding: '7px 10px', color: 'var(--color-text-muted)' }}>{t(projectPriorityLabelKey(card.priority))}</td>
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
              {/* UX-011: o parser devolve códigos; o texto sai no idioma da tela. */}
              {parseResult.issues.slice(0, 8).map((issue, i) => (
                <li key={`${issue.code}-${issue.cardId ?? i}`} style={{ marginBottom: 2 }}>
                  {t(`projects_import_issue_${issue.code}`, { id: issue.cardId ?? '', detail: issue.detail ?? '' })}
                </li>
              ))}
            </ul>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} />
          {t('projects_import_skip_duplicates')}
        </label>

        {errorMsg && (
          <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef444418', color: '#ef4444', fontSize: 12 }}>
            {errorMsg}
          </div>
        )}
        {resultMsg && (
          <div role="status" style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#22c55e18', color: '#22c55e', fontSize: 12 }}>
            {resultMsg}
          </div>
        )}
        {skippedMsg && (
          <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: 12, lineHeight: 1.5 }}>
            {skippedMsg}
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
            disabled={importing || !parseResult || parseResult.cards.length === 0 || missingColumn}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', opacity: !parseResult || parseResult.cards.length === 0 || missingColumn ? 0.5 : 1 }}
          >
            {importing ? t('projects_importing') : t('projects_import_confirm')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

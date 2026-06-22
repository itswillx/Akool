import { useState, useCallback, useMemo } from 'react'
import { X, FileDown, CheckSquare, Square } from 'lucide-react'
import type { Page } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'

interface ExportPdfModalProps {
  open: boolean
  onClose: () => void
}

function flattenPages(ps: Page[]): Page[] {
  return ps.flatMap(p => [p, ...flattenPages(p.children ?? [])])
}

function PageCheckItem({
  page,
  depth,
  selected,
  onToggle,
  disabled,
}: {
  page: Page
  depth: number
  selected: Set<string>
  onToggle: (id: string) => void
  disabled: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const isSelected = selected.has(page.id)
  const hasChildren = (page.children?.length ?? 0) > 0

  return (
    <div>
      <div
        onClick={() => !disabled && onToggle(page.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          paddingLeft: 8 + depth * 16,
          cursor: disabled ? 'not-allowed' : 'pointer',
          borderRadius: 6,
          backgroundColor: hovered && !disabled ? 'var(--color-hover)' : 'transparent',
          transition: 'background-color 0.1s',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {isSelected
          ? <CheckSquare size={14} color="var(--color-btn-primary)" style={{ flexShrink: 0 }} />
          : <Square size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />}
        <span style={{ fontSize: 15, flexShrink: 0 }}>{page.icon || '📄'}</span>
        <span style={{
          fontSize: 13,
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {page.title || 'Untitled'}
        </span>
      </div>
      {hasChildren && page.children!.map(child => (
        <PageCheckItem
          key={child.id}
          page={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

export default function ExportPdfModal({ open, onClose }: ExportPdfModalProps) {
  const { pages, sharedPages } = usePages()
  const { t } = useLanguage()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)

  const allFlat = useMemo(
    () => [...flattenPages(pages), ...flattenPages(sharedPages)],
    [pages, sharedPages]
  )

  const togglePage = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelected(new Set(allFlat.map(p => p.id)))
  }, [allFlat])

  const deselectAll = useCallback(() => setSelected(new Set()), [])

  const handleExport = useCallback(async () => {
    const toExport = allFlat.filter(p => selected.has(p.id))
    if (toExport.length === 0) return
    setGenerating(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      const { exportPagesToPdf } = await import('../hooks/usePdfExport')
      await exportPagesToPdf(toExport, `workspace-${date}.pdf`)
    } catch (err) {
      console.error('[ExportPdf] error:', err)
    } finally {
      setGenerating(false)
      onClose()
    }
  }, [allFlat, selected, onClose])

  if (!open) return null

  const hasPages = allFlat.length > 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget && !generating) onClose() }}
    >
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
        width: '100%',
        maxWidth: 480,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: '82vh',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 20px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileDown size={18} color="var(--color-text)" />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
              {t('export_pdf_title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              cursor: generating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Select all / none bar */}
        {hasPages && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 20px',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}>
            <button
              onClick={selectAll}
              disabled={generating}
              style={{ fontSize: 12, color: 'var(--color-text-muted)', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            >
              {t('export_pdf_select_all')}
            </button>
            <span style={{ color: 'var(--color-border)', fontSize: 12 }}>·</span>
            <button
              onClick={deselectAll}
              disabled={generating}
              style={{ fontSize: 12, color: 'var(--color-text-muted)', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            >
              {t('export_pdf_deselect_all')}
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>
              {selected.size} {t('export_pdf_selected')}
            </span>
          </div>
        )}

        {/* Page tree */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {!hasPages ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', padding: '16px 8px' }}>
              {t('export_pdf_empty')}
            </p>
          ) : (
            <>
              {pages.map(p => (
                <PageCheckItem
                  key={p.id}
                  page={p}
                  depth={0}
                  selected={selected}
                  onToggle={togglePage}
                  disabled={generating}
                />
              ))}
              {sharedPages.length > 0 && (
                <>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '10px 8px 4px',
                  }}>
                    {t('sidebar_shared_with_me')}
                  </div>
                  {sharedPages.map(p => (
                    <PageCheckItem
                      key={p.id}
                      page={p}
                      depth={0}
                      selected={selected}
                      onToggle={togglePage}
                      disabled={generating}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          gap: 8,
          padding: '14px 20px',
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0,
          alignItems: 'center',
        }}>
          {generating && (
            <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t('export_pdf_generating')}
            </span>
          )}
          {!generating && <div style={{ flex: 1 }} />}

          <button
            onClick={onClose}
            disabled={generating}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              cursor: generating ? 'not-allowed' : 'pointer',
              fontSize: 13,
              color: 'var(--color-text-muted)',
            }}
          >
            {t('export_pdf_cancel')}
          </button>

          <button
            onClick={handleExport}
            disabled={selected.size === 0 || generating}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: selected.size === 0 || generating ? 'not-allowed' : 'pointer',
              backgroundColor: selected.size > 0 && !generating
                ? 'var(--color-btn-primary)'
                : 'var(--color-btn-disabled)',
              color: selected.size > 0 && !generating
                ? 'var(--color-btn-primary-text)'
                : 'var(--color-btn-disabled-text)',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <FileDown size={13} />
            {generating ? t('export_pdf_generating') : t('export_pdf_export_btn')}
          </button>
        </div>
      </div>
    </div>
  )
}

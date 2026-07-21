import { lazy, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Files, FileText, ArrowLeft, StickyNote, GraduationCap } from 'lucide-react'
import type { PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'
import { PageItem, CreateNewDropdown, flattenPages } from './PageTree'
import PageEditor, { Lazy } from './PageEditor'
import QuickNotes from './QuickNotes'

const StudySection = lazy(() => import('../modules/study'))

const SELECTED_KEY = 'excalinotion_docs_selected_id'

// The panel can show a document page or one of the fixed sections (quick
// notes / studies). Persisted as JSON under the legacy key — plain strings
// stored by older builds are read back as a page id.
type DocsSelection =
  | { kind: 'page'; id: string }
  | { kind: 'quick-notes' }
  | { kind: 'studies' }

function readSelected(): DocsSelection | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
        const sel = parsed as { kind: unknown; id?: unknown }
        if (sel.kind === 'quick-notes') return { kind: 'quick-notes' }
        if (sel.kind === 'studies') return { kind: 'studies' }
        if (sel.kind === 'page' && typeof sel.id === 'string') return { kind: 'page', id: sel.id }
        return null
      }
    } catch { /* not JSON → legacy plain page id */ }
    return { kind: 'page', id: raw }
  } catch { return null }
}

function RailItem({ icon, label, active, onClick }: {
  icon: ReactNode; label: string; active: boolean; onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      type="button"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px',
        borderRadius: 6, border: 'none', cursor: 'pointer', textAlign: 'left',
        backgroundColor: active ? 'var(--color-active)' : hov ? 'var(--color-hover)' : 'transparent',
        color: 'var(--color-text)', fontSize: 13.5, fontWeight: 500,
      }}
    >
      <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

interface DocumentsPanelProps {
  isMobile?: boolean
}

// Dedicated "Documentos" workspace: a master-detail view with the document tree
// as a left menu and the selected document's editor on the right. Selection is
// LOCAL (not the global activePage) so the panel stays mounted while the user
// switches documents inside it.
export default function DocumentsPanel({ isMobile = false }: DocumentsPanelProps) {
  const { pages, loading, createPage } = usePages()
  const { t } = useLanguage()
  const [selection, setSelection] = useState<DocsSelection | null>(readSelected)

  const flat = useMemo(() => flattenPages(pages), [pages])
  const selectedPage = useMemo(
    () => (selection?.kind === 'page' ? flat.find(p => p.id === selection.id) ?? null : null),
    [flat, selection],
  )

  const select = (sel: DocsSelection | null) => {
    setSelection(sel)
    try {
      if (sel) localStorage.setItem(SELECTED_KEY, JSON.stringify(sel))
      else localStorage.removeItem(SELECTED_KEY)
    } catch { /* ignore */ }
  }

  // Drop a stale page selection (e.g. the selected document was deleted).
  useEffect(() => {
    if (!loading && selection?.kind === 'page' && !flat.some(p => p.id === selection.id)) {
      select(null)
    }
  }, [loading, selection, flat])

  const handleNewPage = async (type: PageType = 'note') => {
    const page = await createPage({ type })
    if (page) select({ kind: 'page', id: page.id })
  }

  const list = (
    <>
      <div style={{ padding: '12px 12px 8px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Files size={16} style={{ color: 'var(--color-text-muted)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{t('sidebar_section_documents')}</span>
      </div>
      <div style={{ padding: '0 8px 8px', flexShrink: 0 }}>
        <CreateNewDropdown onNewPage={handleNewPage} />
      </div>
      <div style={{ padding: '0 8px 8px', flexShrink: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 8 }}>
        <RailItem
          icon={<StickyNote size={14} />}
          label={t('docs_section_quick_notes')}
          active={selection?.kind === 'quick-notes'}
          onClick={() => select({ kind: 'quick-notes' })}
        />
        <RailItem
          icon={<GraduationCap size={14} />}
          label={t('docs_section_studies')}
          active={selection?.kind === 'studies'}
          onClick={() => select({ kind: 'studies' })}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
        {loading
          ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 8px' }}>{t('sidebar_loading')}</p>
          : pages.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 8px' }}>{t('sidebar_no_pages')}</p>
            : pages.map(page => (
                <PageItem
                  key={page.id}
                  page={page}
                  depth={0}
                  selectedId={selection?.kind === 'page' ? selection.id : null}
                  onSelect={p => select({ kind: 'page', id: p.id })}
                />
              ))
        }
      </div>
    </>
  )

  const emptyState = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
      <FileText size={40} strokeWidth={1.25} />
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{t('documents_empty_title')}</p>
      <p style={{ margin: 0, fontSize: 13 }}>{t('documents_empty_hint')}</p>
    </div>
  )

  const detail = selection?.kind === 'quick-notes'
    ? (
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', padding: isMobile ? 16 : 24 }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <QuickNotes isMobile={isMobile} />
        </div>
      </div>
    )
    : selection?.kind === 'studies'
      ? (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
          <Lazy><StudySection isMobile={isMobile} /></Lazy>
        </div>
      )
      : selectedPage
        ? <PageEditor page={selectedPage} isMobile={isMobile} />
        : emptyState

  // Mobile: single column. Show the detail (with a back button) when a section
  // or document is selected, otherwise the list.
  if (isMobile) {
    const hasDetail = !!selection && (selection.kind !== 'page' || !!selectedPage)
    if (hasDetail) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg)' }}>
          <button
            onClick={() => select(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}
          >
            <ArrowLeft size={15} /><span>{t('documents_back')}</span>
          </button>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {detail}
          </div>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg-secondary)' }}>
        {list}
      </div>
    )
  }

  // Desktop: list on the left as a persistent menu, detail on the right.
  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      <aside style={{ width: 300, minWidth: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        {list}
      </aside>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {detail}
      </div>
    </div>
  )
}

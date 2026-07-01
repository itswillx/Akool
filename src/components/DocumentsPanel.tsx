import { useEffect, useMemo, useState } from 'react'
import { Files, FileText, ArrowLeft } from 'lucide-react'
import type { PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'
import { PageItem, CreateNewDropdown, flattenPages } from './PageTree'
import PageEditor from './PageEditor'

const SELECTED_KEY = 'excalinotion_docs_selected_id'

function readSelected(): string | null {
  try { return localStorage.getItem(SELECTED_KEY) } catch { return null }
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
  const [selectedId, setSelectedId] = useState<string | null>(readSelected)

  const flat = useMemo(() => flattenPages(pages), [pages])
  const selectedPage = useMemo(() => flat.find(p => p.id === selectedId) ?? null, [flat, selectedId])

  const selectId = (id: string | null) => {
    setSelectedId(id)
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id)
      else localStorage.removeItem(SELECTED_KEY)
    } catch { /* ignore */ }
  }

  // Drop a stale selection (e.g. the selected document was deleted).
  useEffect(() => {
    if (!loading && selectedId && !flat.some(p => p.id === selectedId)) {
      selectId(null)
    }
  }, [loading, selectedId, flat])

  const handleNewPage = async (type: PageType = 'note') => {
    const page = await createPage({ type })
    if (page) selectId(page.id)
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
        {loading
          ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 8px' }}>{t('sidebar_loading')}</p>
          : pages.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 8px' }}>{t('sidebar_no_pages')}</p>
            : pages.map(page => (
                <PageItem key={page.id} page={page} depth={0} selectedId={selectedId} onSelect={p => selectId(p.id)} />
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

  // Mobile: single column. Show the editor (with a back button) when a document
  // is selected, otherwise the list.
  if (isMobile) {
    if (selectedPage) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg)' }}>
          <button
            onClick={() => selectId(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}
          >
            <ArrowLeft size={15} /><span>{t('documents_back')}</span>
          </button>
          <div style={{ flex: 1, minHeight: 0 }}>
            <PageEditor page={selectedPage} isMobile={isMobile} />
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

  // Desktop: list on the left as a persistent menu, editor on the right.
  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      <aside style={{ width: 300, minWidth: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        {list}
      </aside>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedPage ? <PageEditor page={selectedPage} isMobile={isMobile} /> : emptyState}
      </div>
    </div>
  )
}

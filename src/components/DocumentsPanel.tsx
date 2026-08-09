import { lazy, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Files, FileText, ArrowLeft, StickyNote, GraduationCap, FolderKanban, Waypoints, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Page, PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'
import { setDocsSelection, type DocsSelection } from '../lib/docsNavigation'
import { useDocsSelection } from '../hooks/useDocsSelection'
import { PageItem, CreateNewDropdown, flattenPages } from './PageTree'
import PageEditor, { Lazy } from './PageEditor'
import QuickNotes from './QuickNotes'

const StudySection = lazy(() => import('../modules/study'))
const ProjectsSection = lazy(() => import('../modules/projects'))
const NetworkSection = lazy(() => import('../modules/docsnetwork'))

// A seleção (página ou seção fixa: projetos / notas rápidas / estudos) mora no
// store de lib/docsNavigation, observável de fora — deep links (Dashboard,
// QuickNotes, bloco de card) trocam a seção mesmo com o painel já montado.

const COLLAPSED_KEY = 'excalinotion_docs_rail_collapsed'

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
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
  const { pages, loading, createPage, setActivePage } = usePages()
  const { t } = useLanguage()
  const selection = useDocsSelection()
  const [railCollapsed, setRailCollapsed] = useState(readCollapsed)

  const flat = useMemo(() => flattenPages(pages), [pages])
  const selectedPage = useMemo(
    () => (selection?.kind === 'page' ? flat.find(p => p.id === selection.id) ?? null : null),
    [flat, selection],
  )

  const select = (sel: DocsSelection | null) => setDocsSelection(sel)

  const toggleRail = () => {
    setRailCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // Navegação card → página vinculada, vinda do ProjectsPanel. Páginas
  // compartilhadas não estão na árvore de Documentos (flat só cobre `pages`);
  // para essas o único destino possível continua sendo a navegação global —
  // um select() nelas deixaria selectedPage nulo e o cleanup abaixo zeraria
  // a seleção, jogando o usuário no empty state.
  const handleOpenPageFromCard = (page: Page) => {
    if (flat.some(p => p.id === page.id)) select({ kind: 'page', id: page.id })
    else setActivePage(page)
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
        {!isMobile && (
          <button
            onClick={toggleRail}
            title={t('docs_rail_collapse')}
            aria-label={t('docs_rail_collapse')}
            style={{ marginLeft: 'auto', display: 'flex', padding: 4, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>
      <div style={{ padding: '0 8px 8px', flexShrink: 0 }}>
        <CreateNewDropdown onNewPage={handleNewPage} />
      </div>
      <div style={{ padding: '0 8px 8px', flexShrink: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 8 }}>
        <RailItem
          icon={<FolderKanban size={14} />}
          label={t('docs_section_projects')}
          active={selection?.kind === 'projects'}
          onClick={() => select({ kind: 'projects' })}
        />
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
        <RailItem
          icon={<Waypoints size={14} />}
          label={t('docs_section_network')}
          active={selection?.kind === 'network'}
          onClick={() => select({ kind: 'network' })}
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

  // Uma função com switch em vez da cadeia ternária que isto era: com cinco
  // seções o encadeamento deixava de caber na cabeça, e a próxima adição só
  // piora. Cada ramo carrega o wrapper que a sua seção precisa.
  const renderDetail = () => {
    switch (selection?.kind) {
      case 'projects':
        return (
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
            <Lazy><ProjectsSection isMobile={isMobile} onOpenPage={handleOpenPageFromCard} /></Lazy>
          </div>
        )
      case 'quick-notes':
        return (
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', padding: isMobile ? 16 : 24 }}>
            <div style={{ maxWidth: 980, margin: '0 auto' }}>
              <QuickNotes isMobile={isMobile} />
            </div>
          </div>
        )
      case 'studies':
        return (
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
            <Lazy><StudySection isMobile={isMobile} /></Lazy>
          </div>
        )
      case 'network':
        // Sem overflow no desktop: o grafo se estica até a altura do painel e
        // a coluna de detalhe rola sozinha. No mobile a seção é empilhada e
        // precisa rolar como um todo.
        return (
          <div style={{
            flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column',
            overflowY: isMobile ? 'auto' : 'hidden', padding: isMobile ? 14 : 22,
          }}>
            <Lazy><NetworkSection isMobile={isMobile} pages={flat} onOpenPage={handleOpenPageFromCard} /></Lazy>
          </div>
        )
      default:
        return selectedPage ? <PageEditor page={selectedPage} isMobile={isMobile} /> : emptyState
    }
  }

  const detail = renderDetail()

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

  // Desktop: list on the left as a persistent menu, detail on the right. The
  // aside collapses to a 44px icon strip (persisted) — recupera largura para
  // seções largas como o kanban de Projetos sem sumir com a navegação.
  const collapsedIconBtn = (icon: ReactNode, title: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
        borderRadius: 6, border: 'none', cursor: 'pointer',
        backgroundColor: active ? 'var(--color-active)' : 'transparent',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
      }}
    >
      {icon}
    </button>
  )

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      {railCollapsed ? (
        <aside style={{ width: 44, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', padding: '12px 0', borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)', boxSizing: 'border-box' }}>
          {collapsedIconBtn(<PanelLeftOpen size={15} />, t('docs_rail_expand'), false, toggleRail)}
          <div style={{ width: 22, borderBottom: '1px solid var(--color-border)', margin: '4px 0' }} />
          {collapsedIconBtn(<FolderKanban size={15} />, t('docs_section_projects'), selection?.kind === 'projects', () => select({ kind: 'projects' }))}
          {collapsedIconBtn(<StickyNote size={15} />, t('docs_section_quick_notes'), selection?.kind === 'quick-notes', () => select({ kind: 'quick-notes' }))}
          {collapsedIconBtn(<GraduationCap size={15} />, t('docs_section_studies'), selection?.kind === 'studies', () => select({ kind: 'studies' }))}
          {collapsedIconBtn(<Waypoints size={15} />, t('docs_section_network'), selection?.kind === 'network', () => select({ kind: 'network' }))}
        </aside>
      ) : (
        <aside style={{ width: 300, minWidth: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {list}
        </aside>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {detail}
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown, ChevronRight, Search,
  X, LayoutDashboard, FileDown,
  Wallet, HelpCircle, FolderKanban, MoreHorizontal, Files,
} from 'lucide-react'
import type { PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import type { WorkspaceMode } from '../contexts/WorkspaceModeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { useLanguage } from '../i18n/LanguageContext'
import ExportPdfModal from './ExportPdfModal'
import { PageItem, CreateNewDropdown, flattenPages } from './PageTree'

function SidebarBtn({ onClick, title, children }: { onClick: () => void; title?: string; children: ReactNode }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', cursor: 'pointer', backgroundColor: hov ? 'var(--color-hover)' : 'transparent', color: 'var(--color-text-muted)', flexShrink: 0, padding: 0 }}
    >
      {children}
    </button>
  )
}

function SidebarAction({ onClick, children, active }: { onClick: () => void; children: ReactNode; active?: boolean }) {
  const [hov, setHov] = useState(false)
  const bg = active ? 'var(--color-active)' : hov ? 'var(--color-hover)' : 'transparent'
  const color = active ? 'var(--color-text)' : 'var(--color-text-muted)'
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', backgroundColor: bg, color, fontSize: 13, textAlign: 'left', transition: 'background-color 0.1s', fontWeight: active ? 600 : 400 }}
    >
      {children}
    </button>
  )
}

const FOOTER_EXPANDED_KEY = 'excalinotion_sidebar_footer_expanded'

function getFooterExpanded(): boolean {
  try { return localStorage.getItem(FOOTER_EXPANDED_KEY) === 'true' } catch { return false }
}

function setFooterExpanded(val: boolean): void {
  localStorage.setItem(FOOTER_EXPANDED_KEY, String(val))
}

// Sign out is NOT here anymore: it moved into UserSettingsModal, next to the
// rest of the account info (opened by clicking the user in the topbar).
function SidebarFooterMenu({
  activePanel,
  setActivePanel,
  setShowExport,
  onNavigate,
  mode,
  setMode,
}: {
  activePanel: string | null
  setActivePanel: (panel: 'users' | 'finance' | 'projects' | 'help' | 'backup' | 'documents' | null) => void
  setShowExport: (v: boolean) => void
  onNavigate?: () => void
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(getFooterExpanded)
  const [hov, setHov] = useState(false)

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    setFooterExpanded(next)
  }

  // These panels live in the projects-world shell. If the user is in finance
  // mode, switch back to "all" so the chosen panel is actually visible.
  const navPanel = (panel: 'help') => {
    if (mode === 'finance') setMode('all')
    setActivePanel(panel)
    onNavigate?.()
  }

  return (
    <div style={sidebarStyles.footer}>
      <div
        style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, cursor: 'pointer', backgroundColor: hov ? 'var(--color-hover)' : 'transparent', transition: 'background-color 0.1s' }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onClick={toggle}
      >
        <span style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', marginRight: 4 }}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <MoreHorizontal size={13} style={{ color: 'var(--color-text-muted)', marginRight: 6 }} />
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>{t('sidebar_more')}</span>
      </div>
      {expanded && (
        <div style={{ paddingTop: 2 }}>
          <SidebarAction onClick={() => setShowExport(true)}>
            <FileDown size={13} /><span>{t('sidebar_export_pdf')}</span>
          </SidebarAction>
          <SidebarAction onClick={() => navPanel('help')} active={mode !== 'finance' && activePanel === 'help'}>
            <HelpCircle size={13} /><span>{t('sidebar_help')}</span>
          </SidebarAction>
        </div>
      )}
    </div>
  )
}


const SECTION_STATE_KEY = 'excalinotion_sidebar_sections'

function getSectionState(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(SECTION_STATE_KEY) ?? '{}') } catch { return {} }
}

function setSectionState(key: string, val: boolean) {
  const map = getSectionState()
  map[key] = val
  localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(map))
}

function CollapsibleSection({ label, storageKey, defaultExpanded = true, children, rightAction }: { label: string; storageKey: string; defaultExpanded?: boolean; children: ReactNode; rightAction?: ReactNode }) {
  const [expanded, setExpanded] = useState(() => {
    const map = getSectionState()
    return storageKey in map ? map[storageKey] : defaultExpanded
  })
  const [hov, setHov] = useState(false)

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    setSectionState(storageKey, next)
  }

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', padding: '4px 8px 2px', cursor: 'pointer' }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        onClick={toggle}
      >
        <span style={{ color: hov ? 'var(--color-text)' : 'var(--color-text-muted)', transition: 'color 0.1s', display: 'flex', alignItems: 'center', marginRight: 4 }}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: hov ? 'var(--color-text)' : 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1, transition: 'color 0.1s' }}>
          {label}
        </span>
        {rightAction && <span onClick={e => e.stopPropagation()}>{rightAction}</span>}
      </div>
      {expanded && <div>{children}</div>}
    </div>
  )
}

const sidebarStyles = {
  aside: { width: 260, minWidth: 240, display: 'flex', flexDirection: 'column' as const, height: '100%', backgroundColor: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)', userSelect: 'none' as const, flexShrink: 0 },
  header: { display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--color-border)', gap: 10, flexShrink: 0 },
  logo: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontSize: 14, fontWeight: 700, flexShrink: 0 },
  workspaceName: { fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  workspaceEmail: { fontSize: 12, color: 'var(--color-text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  searchBox: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6 },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: 13, backgroundColor: 'transparent', color: 'var(--color-text)' },
  searchDropdown: { margin: '0 8px 8px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 10 },
  searchResult: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', fontSize: 14, color: 'var(--color-text)', textAlign: 'left' as const },
  pagesScroll: { flex: 1, overflowY: 'auto' as const, paddingTop: 4 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '0 0 2px', padding: '4px 12px' },
  emptyText: { fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 12px', margin: 0 },
  footer: { padding: '6px 8px', borderTop: '1px solid var(--color-border)', flexShrink: 0 },
}

interface SidebarProps {
  onNavigate?: () => void
}

export default function Sidebar({ onNavigate }: SidebarProps = {}) {
  const { pages, sharedPages, createPage, setActivePage, activePage, activePanel, setActivePanel } = usePages()
  const { user, profile } = useAuth()
  const { mode, setMode } = useWorkspaceMode()
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const favorites = useMemo(() => pages.filter(p => p.is_favorite), [pages])
  const allSearchable = useMemo(
    () => [...flattenPages(pages), ...flattenPages(sharedPages)],
    [pages, sharedPages]
  )
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? allSearchable.filter(p => p.title.toLowerCase().includes(q)) : []
  }, [allSearchable, search])

  const handleNewPage = async (type: PageType = 'note') => {
    const page = await createPage({ type })
    if (page) { setActivePage(page); onNavigate?.() }
  }

  const S = sidebarStyles
  const asideStyle = isMobile ? { ...S.aside, width: 'min(85vw, 320px)', minWidth: 0 } : S.aside

  return (
    <aside style={asideStyle}>
      {/* Workspace header */}
      <div style={S.header}>
        <div style={S.logo}>A</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={S.workspaceName}>Akool</p>
          <p style={S.workspaceEmail}>{profile?.display_name || user?.email}</p>
        </div>
        {onNavigate && (
          <SidebarBtn onClick={onNavigate} title="Close"><X size={14} /></SidebarBtn>
        )}
      </div>

      {mode !== 'finance' ? (<>
      {/* Create New + Search row */}
      <div style={{ padding: '8px 8px 4px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <CreateNewDropdown onNewPage={handleNewPage} />
        {showSearch ? (
          <div style={S.searchBox}>
            <Search size={13} color="#9b9a97" style={{ flexShrink: 0 }} />
            <input
              autoFocus={!isMobile}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onBlur={() => { if (!search) setShowSearch(false) }}
              placeholder={t('sidebar_search_placeholder')}
              style={S.searchInput}
            />
            {search && <button onClick={() => { setSearch(''); setShowSearch(false) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9b9a97', padding: 0, display: 'flex' }}><X size={12} /></button>}
          </div>
        ) : (
          <SidebarAction onClick={() => setShowSearch(true)}>
            <Search size={13} /><span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('sidebar_search')}</span>
          </SidebarAction>
        )}
      </div>

      {/* Search results dropdown */}
      {search && searchResults.length > 0 && (
        <div style={S.searchDropdown}>
          {searchResults.slice(0, 8).map(p => (
            <button key={p.id} onClick={() => { setActivePage(p); setSearch(''); setShowSearch(false); onNavigate?.() }} style={S.searchResult}>
              <span>{p.icon}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Scrollable content */}
      <div style={S.pagesScroll}>

        {/* Primary navigation */}
        <div style={{ padding: '2px 8px 6px' }}>
          <SidebarAction
            onClick={() => { setActivePage(null); setActivePanel(null); onNavigate?.() }}
            active={!activePage && activePanel === null}
          >
            <LayoutDashboard size={13} /><span>{t('sidebar_dashboard')}</span>
          </SidebarAction>
          {mode === 'all' && (
            <SidebarAction
              onClick={() => { setActivePage(null); setActivePanel('finance'); onNavigate?.() }}
              active={activePanel === 'finance'}
            >
              <Wallet size={13} /><span>{t('sidebar_section_finance')}</span>
            </SidebarAction>
          )}
          <SidebarAction
            onClick={() => { setActivePage(null); setActivePanel('projects'); onNavigate?.() }}
            active={activePanel === 'projects'}
          >
            <FolderKanban size={13} /><span>{t('sidebar_section_projects')}</span>
          </SidebarAction>
          <SidebarAction
            onClick={() => { setActivePage(null); setActivePanel('documents'); onNavigate?.() }}
            active={activePanel === 'documents'}
          >
            <Files size={13} /><span>{t('sidebar_section_documents')}</span>
          </SidebarAction>
        </div>

        {/* Shared with me */}
        {sharedPages.length > 0 && (
          <CollapsibleSection
            label={t('sidebar_shared_with_me')}
            storageKey="shared"
            defaultExpanded={true}
          >
            <div style={{ padding: '0 8px 4px' }}>
              {sharedPages.map(p => (
                <PageItem key={p.id} page={p} depth={0} onNavigate={onNavigate} readOnly={p.share_role === 'viewer'} />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Favorites section */}
        {favorites.length > 0 && (
          <CollapsibleSection label={t('sidebar_favorites')} storageKey="favs" defaultExpanded={true}>
            <div style={{ padding: '0 8px 4px' }}>
              {favorites.map(p => <PageItem key={p.id} page={p} depth={0} onNavigate={onNavigate} />)}
            </div>
          </CollapsibleSection>
        )}

      </div>
      </>) : (
        <div style={{ ...S.pagesScroll, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', color: 'var(--color-text-muted)' }}>
            <Wallet size={14} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t('sidebar_section_finance')}</span>
          </div>
          <p style={{ ...S.emptyText, padding: 4, marginTop: 2 }}>{t('mode_finance_sidebar_hint')}</p>
        </div>
      )}

      <SidebarFooterMenu
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        setShowExport={setShowExport}
        onNavigate={onNavigate}
        mode={mode}
        setMode={setMode}
      />

      <ExportPdfModal open={showExport} onClose={() => setShowExport(false)} />
    </aside>
  )
}

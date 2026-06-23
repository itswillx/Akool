import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown, ChevronRight, Plus, FileText, Pencil, Layers, Trash2, Star, Search,
  LogOut, X, LayoutDashboard, CheckSquare, Users, Settings, Share2, FileDown,
  Wallet, HelpCircle, FolderKanban, MoreHorizontal, Database,
} from 'lucide-react'
import type { Page, PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { useLanguage } from '../i18n/LanguageContext'
import UserSettingsModal from './UserSettingsModal'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import ExportPdfModal from './ExportPdfModal'

const EXPANDED_KEY = 'excalinotion_expanded_pages'

function flattenPages(ps: Page[]): Page[] {
  return ps.flatMap(p => [p, ...flattenPages(p.children ?? [])])
}

function getExpandedMap(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') } catch { return {} }
}

function setPageExpanded(id: string, val: boolean): void {
  const map = getExpandedMap()
  map[id] = val
  localStorage.setItem(EXPANDED_KEY, JSON.stringify(map))
}

interface PageItemProps {
  page: Page
  depth: number
  onNavigate?: () => void
  readOnly?: boolean
}

const PageItem = memo(function PageItem({ page, depth, onNavigate, readOnly = false }: PageItemProps) {
  const { activePage, setActivePage, createPage, deletePage, updatePage } = usePages()
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(() => getExpandedMap()[page.id] ?? false)
  const [hovered, setHovered] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(page.title)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isActive = activePage?.id === page.id
  const hasChildren = (page.children?.length ?? 0) > 0

  const typeIcon = page.type === 'drawing' ? '🎨' : page.type === 'both' ? '⚡' : page.type === 'todo' ? '✅' : '📄'

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newPage = await createPage({ parent_id: page.id, type: 'note' })
    if (newPage) {
      setExpanded(true)
      setPageExpanded(page.id, true)
      setActivePage(newPage)
      onNavigate?.()
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmingDelete(true)
  }

  const handleConfirmDelete = async () => {
    setConfirmingDelete(false)
    await deletePage(page.id)
  }

  const handleTitleBlur = () => {
    setEditingTitle(false)
    if (titleValue.trim() && titleValue !== page.title) {
      updatePage(page.id, { title: titleValue.trim() })
    }
  }

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await updatePage(page.id, { is_favorite: !page.is_favorite })
  }

  const rowBg = isActive ? 'var(--color-active)' : hovered ? 'var(--color-hover)' : 'transparent'

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', borderRadius: 6, cursor: 'pointer', paddingLeft: 8 + depth * 16, paddingRight: 6, paddingTop: 3, paddingBottom: 3, backgroundColor: rowBg, transition: 'background-color 0.1s' }}
        onClick={() => { setActivePage(page); onNavigate?.() }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          onClick={e => { e.stopPropagation(); const next = !expanded; setExpanded(next); setPageExpanded(page.id, next) }}
          style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: '#9b9a97', flexShrink: 0, borderRadius: 4, marginRight: 2, padding: 0 }}
        >
          {hasChildren
            ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
            : <span style={{ width: 13, display: 'inline-block' }} />}
        </button>

        <span style={{ fontSize: 15, marginRight: 6, flexShrink: 0 }}>{page.icon || typeIcon}</span>

        {editingTitle && !readOnly ? (
          <input
            autoFocus
            value={titleValue}
            onChange={e => setTitleValue(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={e => { if (e.key === 'Enter') handleTitleBlur() }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
        ) : (
          <span
            style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onDoubleClick={readOnly ? undefined : e => { e.stopPropagation(); setEditingTitle(true) }}
          >
            {page.title || t('page_header_untitled')}
          </span>
        )}

        {page.share_role === 'co_owner' && (
          <span title={t('page_header_role_co_owner')} style={{ flexShrink: 0, marginLeft: 4, display: 'flex', alignItems: 'center' }}>
            <Share2 size={11} color="#9b9a97" />
          </span>
        )}

        {(hovered || isActive) && !editingTitle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 4 }}>
            {!readOnly && (
              <button onClick={handleFavorite} title={t('sidebar_favorite')} style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: page.is_favorite ? '#f59e0b' : '#9b9a97', borderRadius: 4, padding: 0 }}>
                <Star size={12} />
              </button>
            )}
            {!readOnly && (
              <button onClick={handleAddChild} title={t('sidebar_add_page')} style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: '#9b9a97', borderRadius: 4, padding: 0 }}>
                <Plus size={12} />
              </button>
            )}
            {!readOnly && (
              <button onClick={handleDelete} title={t('sidebar_delete')} style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: '#9b9a97', borderRadius: 4, padding: 0 }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {page.children!.map(child => (
            <PageItem key={child.id} page={child} depth={depth + 1} onNavigate={onNavigate} readOnly={readOnly} />
          ))}
        </div>
      )}

      <ConfirmDeleteModal
        open={confirmingDelete}
        pageTitle={page.title}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
})

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

function SidebarFooterMenu({
  isAdmin,
  activePanel,
  setActivePanel,
  setShowSettings,
  setShowExport,
  signOut,
  onNavigate,
}: {
  isAdmin: boolean
  activePanel: string | null
  setActivePanel: (panel: 'users' | 'finance' | 'projects' | 'help' | 'backup' | null) => void
  setShowSettings: (v: boolean) => void
  setShowExport: (v: boolean) => void
  signOut: () => void
  onNavigate?: () => void
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(getFooterExpanded)
  const [hov, setHov] = useState(false)

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    setFooterExpanded(next)
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
          {isAdmin && (
            <SidebarAction
              onClick={() => { setActivePanel('users'); onNavigate?.() }}
              active={activePanel === 'users'}
            >
              <Users size={13} /><span>{t('sidebar_users')}</span>
            </SidebarAction>
          )}
          <SidebarAction onClick={() => setShowSettings(true)}>
            <Settings size={13} /><span>{t('sidebar_settings_title')}</span>
          </SidebarAction>
          <SidebarAction onClick={() => setShowExport(true)}>
            <FileDown size={13} /><span>{t('sidebar_export_pdf')}</span>
          </SidebarAction>
          <SidebarAction onClick={() => { setActivePanel('help'); onNavigate?.() }} active={activePanel === 'help'}>
            <HelpCircle size={13} /><span>{t('sidebar_help')}</span>
          </SidebarAction>
          {isAdmin && (
            <SidebarAction onClick={() => { setActivePanel('backup'); onNavigate?.() }} active={activePanel === 'backup'}>
              <Database size={13} /><span>{t('sidebar_backup')}</span>
            </SidebarAction>
          )}
          <SidebarAction onClick={signOut}>
            <LogOut size={13} /><span>{t('sidebar_signout')}</span>
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

function CreateNewDropdown({ onNewPage }: { onNewPage: (type: PageType) => void }) {
  const [open, setOpen] = useState(false)
  const [hov, setHov] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const items: { type: PageType; icon: ReactNode; label: string }[] = [
    { type: 'note', icon: <FileText size={13} />, label: t('sidebar_new_note') },
    { type: 'drawing', icon: <Pencil size={13} />, label: t('sidebar_new_drawing') },
    { type: 'both', icon: <Layers size={13} />, label: t('sidebar_new_both') },
    { type: 'todo', icon: <CheckSquare size={13} />, label: t('sidebar_new_todo') },
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '7px 10px', borderRadius: 8,
          border: '1px solid var(--color-border)',
          backgroundColor: hov ? 'var(--color-hover)' : 'var(--color-bg)',
          color: 'var(--color-text)', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', transition: 'background-color 0.1s',
        }}
      >
        <Plus size={14} style={{ color: 'var(--color-primary)' }} />
        <span style={{ flex: 1 }}>{t('sidebar_create_new')}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', padding: 4, overflow: 'hidden',
        }}>
          {items.map(item => (
            <DropdownItem key={item.type} icon={item.icon} label={item.label} onClick={() => { onNewPage(item.type); setOpen(false) }} />
          ))}
        </div>
      )}
    </div>
  )
}

function DropdownItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', backgroundColor: hov ? 'var(--color-hover)' : 'transparent', color: 'var(--color-text)', fontSize: 13, textAlign: 'left' }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
      {label}
    </button>
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
  const { pages, sharedPages, loading, createPage, setActivePage, activePage, activePanel, setActivePanel } = usePages()
  const { user, profile, isAdmin, signOut } = useAuth()
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
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

      {/* Create New + Search row */}
      <div style={{ padding: '8px 8px 4px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <CreateNewDropdown onNewPage={handleNewPage} />
        {showSearch ? (
          <div style={S.searchBox}>
            <Search size={13} color="#9b9a97" style={{ flexShrink: 0 }} />
            <input
              autoFocus
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
          <SidebarAction
            onClick={() => { setActivePage(null); setActivePanel('finance'); onNavigate?.() }}
            active={activePanel === 'finance'}
          >
            <Wallet size={13} /><span>{t('sidebar_section_finance')}</span>
          </SidebarAction>
          <SidebarAction
            onClick={() => { setActivePage(null); setActivePanel('projects'); onNavigate?.() }}
            active={activePanel === 'projects'}
          >
            <FolderKanban size={13} /><span>{t('sidebar_section_projects')}</span>
          </SidebarAction>
        </div>

        <hr style={{ margin: '0 12px 4px', border: 'none', borderTop: '1px solid var(--color-border)' }} />

        {/* Documents section */}
        <CollapsibleSection
          label={t('sidebar_documents_group')}
          storageKey="docs"
          defaultExpanded={true}
          rightAction={
            <button
              onClick={() => handleNewPage('note')}
              title={t('sidebar_new_page')}
              style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--color-text-muted)', borderRadius: 4, padding: 0 }}
            >
              <Plus size={11} />
            </button>
          }
        >
          <div style={{ padding: '0 8px 4px' }}>
            {loading
              ? <p style={S.emptyText}>{t('sidebar_loading')}</p>
              : pages.length === 0
                ? <p style={S.emptyText}>{t('sidebar_no_pages')}</p>
                : pages.map(page => <PageItem key={page.id} page={page} depth={0} onNavigate={onNavigate} />)
            }
          </div>
        </CollapsibleSection>

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

      <SidebarFooterMenu
        isAdmin={isAdmin}
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        setShowSettings={setShowSettings}
        setShowExport={setShowExport}
        signOut={signOut}
        onNavigate={onNavigate}
      />

      <UserSettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <ExportPdfModal open={showExport} onClose={() => setShowExport(false)} />
    </aside>
  )
}

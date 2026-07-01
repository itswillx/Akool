import { memo, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown, ChevronRight, Plus, FileText, Pencil, Layers, Trash2, Star,
  CheckSquare, Share2,
} from 'lucide-react'
import type { Page, PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { useLanguage } from '../i18n/LanguageContext'
import ConfirmDeleteModal from './ConfirmDeleteModal'

const EXPANDED_KEY = 'excalinotion_expanded_pages'

export function flattenPages(ps: Page[]): Page[] {
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
  // When provided, the item selects into a local selection (the Documentos
  // module) instead of the global activePage. Lets the same tree drive either
  // the sidebar (global) or the master-detail panel (local).
  selectedId?: string | null
  onSelect?: (page: Page) => void
}

export const PageItem = memo(function PageItem({ page, depth, onNavigate, readOnly = false, selectedId, onSelect }: PageItemProps) {
  const { activePage, setActivePage, createPage, deletePage, updatePage } = usePages()
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [expanded, setExpanded] = useState(() => getExpandedMap()[page.id] ?? false)
  const [hovered, setHovered] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(page.title)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isActive = onSelect ? selectedId === page.id : activePage?.id === page.id
  const hasChildren = (page.children?.length ?? 0) > 0

  const typeIcon = page.type === 'drawing' ? '🎨' : page.type === 'both' ? '⚡' : page.type === 'todo' ? '✅' : '📄'

  const selectPage = (p: Page) => {
    if (onSelect) onSelect(p)
    else setActivePage(p)
    onNavigate?.()
  }

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newPage = await createPage({ parent_id: page.id, type: 'note' })
    if (newPage) {
      setExpanded(true)
      setPageExpanded(page.id, true)
      selectPage(newPage)
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
        onClick={() => selectPage(page)}
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
            autoFocus={!isMobile}
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
            <PageItem key={child.id} page={child} depth={depth + 1} onNavigate={onNavigate} readOnly={readOnly} selectedId={selectedId} onSelect={onSelect} />
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

export function CreateNewDropdown({ onNewPage }: { onNewPage: (type: PageType) => void }) {
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

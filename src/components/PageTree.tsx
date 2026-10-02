import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import {
  ChevronDown, ChevronRight, Plus, FileText, Pencil, Layers, Trash2, Star,
  CheckSquare, Share2,
} from 'lucide-react'
import type { Page, PageType } from '../types'
import { usePageActions, usePageNavigation } from '../contexts/pagesState'
import { useIsMobile } from '../hooks/useIsMobile'
import { useLanguage } from '../i18n/LanguageContext'
import ConfirmDeleteModal from './ConfirmDeleteModal'

const EXPANDED_KEY = 'excalinotion_expanded_pages'


function getExpandedMap(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') } catch { return {} }
}

function setPageExpanded(id: string, val: boolean): void {
  const map = getExpandedMap()
  map[id] = val
  localStorage.setItem(EXPANDED_KEY, JSON.stringify(map))
}

// ─── Árvore acessível (UX-002) ────────────────────────────────────────────────
// Padrão ARIA tree: cada árvore é UMA parada de Tab (roving tabindex). Na raiz,
// ↑ ↓ Home End andam pelos itens visíveis; no item, → ← expandem/recolhem ou
// entram no filho/voltam ao pai, Enter abre, F2 renomeia e Delete exclui.

interface PageTreeState {
  /** Item que recebe o Tab; null = o 1º da raiz. */
  tabStopId: string | null
  firstId: string | null
  setTabStopId: Dispatch<SetStateAction<string | null>>
}

const PageTreeContext = createContext<PageTreeState | null>(null)

const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

function focusElement(el: Element | null | undefined) {
  if (el instanceof HTMLElement) el.focus()
}

export function PageTreeRoot({ label, pages, children }: { label: string; pages: Page[]; children: ReactNode }) {
  const [tabStopId, setTabStopId] = useState<string | null>(null)
  const firstId = pages[0]?.id ?? null
  const state = useMemo(() => ({ tabStopId, firstId, setTabStopId }), [tabStopId, firstId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!NAV_KEYS.has(e.key) || target.getAttribute('role') !== 'treeitem') return
    // Itens recolhidos não são renderizados: a ordem do DOM é a ordem visível.
    const items = Array.from(e.currentTarget.querySelectorAll('[role="treeitem"]'))
    const i = items.indexOf(target)
    e.preventDefault()
    if (e.key === 'ArrowDown') focusElement(items[i + 1])
    else if (e.key === 'ArrowUp') focusElement(items[i - 1])
    else if (e.key === 'Home') focusElement(items[0])
    else focusElement(items[items.length - 1])
  }

  return (
    <PageTreeContext.Provider value={state}>
      <div role="tree" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>{children}</div>
    </PageTreeContext.Provider>
  )
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
  // PERF-007: só navegação e ações; uma carga ou evento da árvore não
  // re-renderiza o item, a menos que o próprio `page` mude.
  const { activePage, setActivePage } = usePageNavigation()
  const { createPage, deletePage, updatePage } = usePageActions()
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const tree = useContext(PageTreeContext)
  const itemRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  // Enter/Esc no input já tratam o título; o blur que vem em seguida (foco
  // voltando ao item) não pode salvar de novo nem desfazer o cancelamento.
  const skipBlurRef = useRef(false)
  const [expanded, setExpanded] = useState(() => getExpandedMap()[page.id] ?? false)
  const [hovered, setHovered] = useState(false)
  const [focusInRow, setFocusInRow] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(page.title)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isActive = onSelect ? selectedId === page.id : activePage?.id === page.id
  const hasChildren = (page.children?.length ?? 0) > 0
  // Fora de um PageTreeRoot o item continua tabulável como antes.
  const isTabStop = tree ? (tree.tabStopId ?? tree.firstId) === page.id : true

  // A parada de Tab acompanha a página aberta (inclusive por clique); se o item
  // some (pai recolhido, página excluída), ela volta para o 1º da raiz.
  const setTabStopId = tree?.setTabStopId
  useEffect(() => {
    if (isActive) setTabStopId?.(page.id)
  }, [isActive, page.id, setTabStopId])
  useEffect(() => () => setTabStopId?.(cur => (cur === page.id ? null : cur)), [page.id, setTabStopId])

  const typeIcon = page.type === 'drawing' ? '🎨' : page.type === 'both' ? '⚡' : page.type === 'todo' ? '✅' : '📄'

  const selectPage = (p: Page) => {
    if (onSelect) onSelect(p)
    else setActivePage(p)
    onNavigate?.()
  }

  const setExpandedPersist = (next: boolean) => {
    setExpanded(next)
    setPageExpanded(page.id, next)
  }

  const handleAddChild = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newPage = await createPage({ parent_id: page.id, type: 'note' })
    if (newPage) {
      setExpandedPersist(true)
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

  const startEditing = () => {
    skipBlurRef.current = false
    setTitleValue(page.title)
    setEditingTitle(true)
  }

  const commitTitle = () => {
    setEditingTitle(false)
    if (titleValue.trim() && titleValue !== page.title) {
      updatePage(page.id, { title: titleValue.trim() })
    }
  }

  const handleTitleBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    commitTitle()
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      skipBlurRef.current = true
      commitTitle()
      itemRef.current?.focus()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      skipBlurRef.current = true
      setEditingTitle(false)
      setTitleValue(page.title)
      itemRef.current?.focus()
    }
  }

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await updatePage(page.id, { is_favorite: !page.is_favorite })
  }

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Teclas de filhos (subitens, input do título, botões de ação) sobem até
    // aqui; só o próprio item reage.
    if (e.target !== e.currentTarget) return
    switch (e.key) {
      case 'Enter':
        selectPage(page)
        break
      case 'ArrowRight':
        if (!hasChildren) return
        if (!expanded) setExpandedPersist(true)
        else {
          const group = Array.from(e.currentTarget.children).find(c => c.getAttribute('role') === 'group')
          focusElement(group?.querySelector('[role="treeitem"]'))
        }
        break
      case 'ArrowLeft':
        if (hasChildren && expanded) setExpandedPersist(false)
        else focusElement(e.currentTarget.parentElement?.closest('[role="treeitem"]'))
        break
      case 'F2':
        if (readOnly) return
        startEditing()
        break
      case 'Delete':
        if (readOnly) return
        setConfirmingDelete(true)
        break
      default:
        return
    }
    e.preventDefault()
  }

  // Foco no próprio item ou num botão da linha dele (não num subitem).
  const ownsFocus = (el: EventTarget | null) =>
    el instanceof Node && (el === itemRef.current || !!rowRef.current?.contains(el))

  const rowBg = isActive ? 'var(--color-active)' : hovered ? 'var(--color-hover)' : 'transparent'
  const actionTabIndex = isTabStop ? 0 : -1

  return (
    <>
      <div
        ref={itemRef}
        role="treeitem"
        className="page-tree-item"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={isActive}
        aria-label={page.title || t('page_header_untitled')}
        tabIndex={isTabStop ? 0 : -1}
        onKeyDown={handleItemKeyDown}
        onFocus={e => {
          setFocusInRow(ownsFocus(e.target))
          if (e.target === e.currentTarget) setTabStopId?.(page.id)
        }}
        onBlur={e => { if (!ownsFocus(e.relatedTarget)) setFocusInRow(false) }}
      >
        <div
          ref={rowRef}
          className="page-tree-row"
          data-kbd="inner"
          style={{ display: 'flex', alignItems: 'center', borderRadius: 6, cursor: 'pointer', paddingLeft: 8 + depth * 16, paddingRight: 6, paddingTop: 3, paddingBottom: 3, backgroundColor: rowBg, transition: 'background-color 0.1s' }}
          onClick={() => selectPage(page)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Só para o mouse: no teclado, → e ← expandem e recolhem. */}
          {hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              onClick={e => { e.stopPropagation(); setExpandedPersist(!expanded) }}
              style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--color-icon)', flexShrink: 0, borderRadius: 4, marginRight: 2, padding: 0 }}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span style={{ width: 20, height: 20, flexShrink: 0, marginRight: 2 }} />
          )}

          <span aria-hidden="true" style={{ fontSize: 15, marginRight: 6, flexShrink: 0 }}>{page.icon || typeIcon}</span>

          {editingTitle && !readOnly ? (
            <input
              autoFocus={!isMobile}
              value={titleValue}
              aria-label={t('sidebar_rename_page')}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, border: 'none', fontSize: 14, backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          ) : (
            <span
              style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onDoubleClick={readOnly ? undefined : e => { e.stopPropagation(); startEditing() }}
            >
              {page.title || t('page_header_untitled')}
            </span>
          )}

          {page.share_role === 'co_owner' && (
            <span title={t('page_header_role_co_owner')} style={{ flexShrink: 0, marginLeft: 4, display: 'flex', alignItems: 'center' }}>
              <Share2 size={11} color="var(--color-icon)" />
            </span>
          )}

          {(hovered || isActive || focusInRow) && !editingTitle && !readOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 4 }}>
              <button type="button" tabIndex={actionTabIndex} onClick={handleFavorite} title={t('sidebar_favorite')} style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: page.is_favorite ? '#f59e0b' : 'var(--color-icon)', borderRadius: 4, padding: 0 }}>
                <Star size={12} />
              </button>
              <button type="button" tabIndex={actionTabIndex} onClick={handleAddChild} title={t('sidebar_add_page')} style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--color-icon)', borderRadius: 4, padding: 0 }}>
                <Plus size={12} />
              </button>
              <button type="button" tabIndex={actionTabIndex} onClick={handleDelete} title={t('sidebar_delete')} style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--color-icon)', borderRadius: 4, padding: 0 }}>
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        {expanded && hasChildren && (
          <div role="group">
            {page.children!.map(child => (
              <PageItem key={child.id} page={child} depth={depth + 1} onNavigate={onNavigate} readOnly={readOnly} selectedId={selectedId} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>

      <ConfirmDeleteModal
        open={confirmingDelete}
        pageTitle={page.title}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
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

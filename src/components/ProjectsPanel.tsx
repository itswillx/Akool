import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Plus, X, Trash2, Pencil, Share2, FolderKanban, LayoutGrid, List as ListIcon,
  BarChart3, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Link2, ExternalLink, Search,
  Calendar, CheckSquare, Image, Download, Smartphone, Upload, GanttChartSquare,
  GripVertical, Check,
} from 'lucide-react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable,
  pointerWithin, rectIntersection,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ProjectBoard, ProjectColumn, ProjectCard, ProjectCardChecklistItem, ProjectCardAttachment, ProjectCardLink, ProjectShare, ProjectCardPriority, ProjectShareRole, Page } from '../types'
import { supabase } from '../lib/supabase'
import { UserAvatar } from './UserAvatar'
import { sanitizeIlikeTerm } from '../lib/profileSearch'
import { resolveSignedUrl } from '../lib/storageUrl'
import { SignedImage } from './SignedImage'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { usePages } from '../contexts/PagesContext'
import { useIsMobile } from '../hooks/useIsMobile'
import ConfirmDeleteModal from './ConfirmDeleteModal'
import ImportCardsModal from './ImportCardsModal'
import CardFilterBar from './CardFilterBar'
import GanttView from './GanttView'
import { MarkdownText } from './MarkdownText'
import { RichTextEditor } from './RichTextEditor'
import { normalizeLinkUrl, linkDisplay } from '../lib/cardLinks'
import { Donut, Legend, SegmentedBar, AreaTrend, type ChartDatum } from './Charts'
import { overviewSummary, countByColumnId, countByPriority, countByAssignee, dueBuckets, createdPerWeek, PRIORITY_ORDER } from '../lib/projectStats'
import {
  type ProjectCardFilters,
  filterProjectCards,
  loadCardFilters,
  saveCardFilters,
  collectBoardLabels,
  hasActiveFilters,
  defaultCardFilters,
} from '../lib/projectCardFilters'

// ─── Constants & helpers ──────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<ProjectCardPriority, string> = {
  low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
}
const BOARD_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']
const BOARD_ICONS = ['📋', '🚀', '🎯', '💡', '🛠️', '📦', '🎨', '🧩', '📈', '🏗️', '🔥', '⭐']
const ACTIVE_BOARD_KEY = 'projects_active_board'
const VIEW_KEY = 'projects_view'
const COMPACT_COLUMN_KEY = 'projects_compact_column:'
const CARD_DRAFT_PREFIX = 'projects_card_draft:'
const CARD_MODAL_STATE_KEY = 'projects_card_modal_state'
// Set by the dashboard (quick-note chips / due-soon list) to deep-open a card.
const OPEN_CARD_KEY = 'projects_open_card'
const AUTOSAVE_DEBOUNCE_MS = 800

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const byOrder = (a: ProjectCard, b: ProjectCard) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

function flattenPages(ps: Page[]): Page[] {
  return ps.flatMap(p => [p, ...flattenPages(p.children ?? [])])
}

// ─── Shared styles ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6,
  fontSize: 14, backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, display: 'block',
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

const CARD_IMAGES_BUCKET = 'project-card-images'

function Modal({
  title, onClose, children, width = 460, maxHeight = '90vh', closeOnBackdrop = true, isMobile = false,
}: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number; maxHeight?: string;
  closeOnBackdrop?: boolean; isMobile?: boolean;
}) {
  const handleBackdropClick = closeOnBackdrop ? onClose : undefined
  const mobileMaxHeight = maxHeight === '90vh' ? '95vh' : maxHeight

  if (isMobile) {
    return (
      <div
        className="finance-sheet-overlay"
        onClick={handleBackdropClick}
        style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <div
          className="finance-sheet-panel finance-safe-bottom"
          onClick={e => e.stopPropagation()}
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '8px 20px 24px', maxHeight: mobileMaxHeight, overflowY: 'auto', boxShadow: '0 -8px 32px rgba(0,0,0,0.3)', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 12px' }}>
            <div style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: 'var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'var(--color-bg)', paddingBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, width: 36, height: 36, flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className="finance-sheet-overlay"
      onClick={handleBackdropClick}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 }}
    >
      <div
        className="finance-modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width, maxWidth: '95vw', maxHeight, overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', borderRadius: 6, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PrimaryBtn({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  )
}

function GhostBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

interface Member {
  id: string
  email: string
  display_name: string | null
  avatar_emoji?: string | null
  avatar_color?: string | null
  avatar_url?: string | null
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority, label }: { priority: ProjectCardPriority; label: string }) {
  const c = PRIORITY_COLORS[priority]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: c, backgroundColor: `${c}1f`, padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {label}
    </span>
  )
}

// ─── Card presentational ────────────────────────────────────────────────────

function CardView({ card, priorityLabel, dragging, onClick }: { card: ProjectCard; priorityLabel: string; dragging?: boolean; onClick?: () => void }) {
  const { t } = useLanguage()
  const due = card.due_date ? new Date(card.due_date + 'T00:00:00') : null
  const overdue = due && !card.completed && due.getTime() < new Date(todayStr() + 'T00:00:00').getTime()
  const isToday = due && card.due_date === todayStr()
  const dueColor = overdue ? '#ef4444' : isToday ? '#f59e0b' : 'var(--color-text-muted)'
  const checklist = card.checklist ?? []
  const checklistDone = checklist.filter(i => i.completed).length
  const checklistTotal = checklist.length
  const attachmentCount = card.attachments?.length ?? 0
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10,
        padding: '10px 12px', cursor: 'pointer', boxShadow: dragging ? '0 8px 24px rgba(0,0,0,0.25)' : '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column', gap: 8, opacity: card.completed ? 0.65 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.35, textDecoration: card.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>{card.title || t('projects_new_card')}</span>
      </div>
      {(card.labels?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {card.labels.map((l, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)', padding: '1px 6px', borderRadius: 4 }}>{l}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <PriorityBadge priority={card.priority} label={priorityLabel} />
        {due && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: dueColor }}>
            <Calendar size={11} />
            {overdue ? t('projects_due_overdue') : isToday ? t('projects_due_today') : due.toLocaleDateString()}
          </span>
        )}
        {checklistTotal > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: checklistDone === checklistTotal ? '#22c55e' : 'var(--color-text-muted)' }}>
            <CheckSquare size={11} />
            {t('projects_checklist_progress').replace('{done}', String(checklistDone)).replace('{total}', String(checklistTotal))}
          </span>
        )}
        {attachmentCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            <Image size={11} />
            {attachmentCount}
          </span>
        )}
        {card.linked_page_id && <Link2 size={12} style={{ color: '#6366f1' }} />}
        {card.assignee_profile && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <UserAvatar
              name={card.assignee_profile.display_name || card.assignee_profile.email}
              seed={card.assignee_profile.email}
              emoji={card.assignee_profile.avatar_emoji}
              color={card.assignee_profile.avatar_color}
              url={card.assignee_profile.avatar_url}
              size={20}
              title={card.assignee_profile.display_name || card.assignee_profile.email}
            />
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Sortable card ────────────────────────────────────────────────────────────

function SortableCard({
  card, priorityLabel, canEdit, onClick, variant = 'board', showMovePrev, showMoveNext, onMovePrev, onMoveNext,
}: {
  card: ProjectCard; priorityLabel: string; canEdit: boolean; onClick: () => void;
  variant?: 'board' | 'compact'; showMovePrev?: boolean; showMoveNext?: boolean;
  onMovePrev?: () => void; onMoveNext?: () => void;
}) {
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canEdit })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1,
  }
  const moveBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
    borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)',
    cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, flexShrink: 0,
  }
  return (
    <div ref={setNodeRef} style={{ ...style, touchAction: 'manipulation' }} {...attributes} {...(canEdit ? listeners : {})}>
      {variant === 'compact' && canEdit && (showMovePrev || showMoveNext) && (
        <div
          style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {showMovePrev ? (
            <button type="button" title={t('projects_compact_move_prev')} onClick={onMovePrev} style={moveBtnStyle}>
              <ChevronLeft size={14} />
            </button>
          ) : <span style={{ width: 28 }} />}
          {showMoveNext ? (
            <button type="button" title={t('projects_compact_move_next')} onClick={onMoveNext} style={moveBtnStyle}>
              <ChevronRight size={14} />
            </button>
          ) : <span style={{ width: 28 }} />}
        </div>
      )}
      <CardView card={card} priorityLabel={priorityLabel} onClick={onClick} />
    </div>
  )
}

// ─── Column ───────────────────────────────────────────────────────────────────

function Column({
  column, cards, canEdit, priorityLabel, onAddCard, onCardClick, onRename, onDelete,
  variant = 'board', columnIndex = 0, columnsCount = 1, onMovePrev, onMoveNext,
  dragHandleRef, dragHandleListeners, dragHandleAttributes,
}: {
  column: ProjectColumn; cards: ProjectCard[]; canEdit: boolean; priorityLabel: (p: ProjectCardPriority) => string;
  onAddCard: () => void; onCardClick: (c: ProjectCard) => void; onRename: () => void; onDelete: () => void;
  variant?: 'board' | 'compact'; columnIndex?: number; columnsCount?: number;
  onMovePrev?: (cardId: string) => void; onMoveNext?: (cardId: string) => void;
  dragHandleRef?: (node: HTMLElement | null) => void;
  dragHandleListeners?: Record<string, unknown>;
  dragHandleAttributes?: Record<string, unknown>;
}) {
  const { t } = useLanguage()
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const overLimit = column.wip_limit != null && cards.length > column.wip_limit
  const isCompact = variant === 'compact'
  const showMovePrev = isCompact && columnIndex > 0
  const showMoveNext = isCompact && columnIndex < columnsCount - 1
  const sortableItems = useMemo(() => cards.map(c => c.id), [cards])
  const showDragHandle = !isCompact && canEdit && !!dragHandleRef
  return (
    <div
      ref={setNodeRef}
      style={{
        width: isCompact ? '100%' : 290,
        minWidth: isCompact ? 0 : 290,
        flex: isCompact ? 1 : undefined,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: isCompact ? undefined : '100%',
        borderRadius: 10,
        transition: 'background-color 0.12s',
        backgroundColor: isOver ? 'var(--color-hover)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 6 }}>
        {showDragHandle && (
          <button
            ref={dragHandleRef}
            {...(dragHandleAttributes ?? {})}
            {...(dragHandleListeners ?? {})}
            title={t('projects_reorder_column')}
            style={{ border: 'none', background: 'none', cursor: 'grab', color: 'var(--color-text-muted)', display: 'flex', padding: 0, flexShrink: 0, touchAction: 'none' }}
          >
            <GripVertical size={14} />
          </button>
        )}
        <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: column.color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: overLimit ? '#ef4444' : 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)', borderRadius: 999, padding: '1px 7px' }}>
          {cards.length}{column.wip_limit != null ? `/${column.wip_limit}` : ''}
        </span>
        {canEdit && (
          <>
            <button onClick={onAddCard} title={t('projects_add_card')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><Plus size={13} /></button>
            <button onClick={onRename} title={t('projects_rename_column')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><Pencil size={12} /></button>
            <button onClick={onDelete} title={t('projects_delete_column')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><Trash2 size={12} /></button>
          </>
        )}
      </div>
      <div style={{
        flex: isCompact ? undefined : 1,
        overflowY: isCompact ? undefined : 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        borderRadius: 10,
        backgroundColor: 'var(--color-bg-secondary)',
        minHeight: isCompact ? undefined : 60,
      }}>
        <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
          {cards.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px 0' }}>{t('projects_empty_column')}</div>
            : cards.map(c => (
              <SortableCard
                key={c.id}
                card={c}
                priorityLabel={priorityLabel(c.priority)}
                canEdit={canEdit}
                variant={variant}
                showMovePrev={showMovePrev}
                showMoveNext={showMoveNext}
                onMovePrev={showMovePrev && onMovePrev ? () => onMovePrev(c.id) : undefined}
                onMoveNext={showMoveNext && onMoveNext ? () => onMoveNext(c.id) : undefined}
                onClick={() => onCardClick(c)}
              />
            ))
          }
        </SortableContext>
        {canEdit && (
          <button onClick={onAddCard} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12.5, cursor: 'pointer' }}>
            <Plus size={13} />{t('projects_add_card')}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Sortable column (board reorder) ──────────────────────────────────────────

function SortableColumn({ column, canEdit, ...rest }: {
  column: ProjectColumn; cards: ProjectCard[]; canEdit: boolean; priorityLabel: (p: ProjectCardPriority) => string;
  onAddCard: () => void; onCardClick: (c: ProjectCard) => void; onRename: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id, data: { type: 'column' }, disabled: !canEdit,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    height: '100%',
  }
  return (
    <div ref={setNodeRef} style={style}>
      <Column
        column={column}
        canEdit={canEdit}
        dragHandleRef={setActivatorNodeRef}
        dragHandleListeners={listeners as unknown as Record<string, unknown>}
        dragHandleAttributes={attributes as unknown as Record<string, unknown>}
        {...rest}
      />
    </div>
  )
}

// ─── Page picker ──────────────────────────────────────────────────────────────

function PagePicker({ value, onChange }: { value: string | null; onChange: (id: string | null, page?: Page) => void }) {
  const { pages, sharedPages } = usePages()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const all = useMemo(() => [...flattenPages(pages), ...flattenPages(sharedPages)], [pages, sharedPages])
  const selected = all.find(p => p.id === value)
  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (term ? all.filter(p => p.title.toLowerCase().includes(term)) : all).slice(0, 8)
  }, [all, q])
  return (
    <div>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
          <span>{selected.icon}</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.title}</span>
          <button onClick={() => onChange(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><X size={14} /></button>
        </div>
      ) : open ? (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
            <Search size={13} style={{ color: 'var(--color-text-muted)' }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('projects_search_page')} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)' }} />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {results.map(p => (
              <button key={p.id} onClick={() => { onChange(p.id, p); setOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--color-text)', textAlign: 'left' }}>
                <span>{p.icon}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
              </button>
            ))}
            {results.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>—</div>}
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px dashed var(--color-border)', borderRadius: 8, background: 'transparent', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer', width: '100%' }}>
          <Link2 size={13} />{t('projects_link_page')}
        </button>
      )}
    </div>
  )
}

// ─── Card modal ───────────────────────────────────────────────────────────────

interface CardForm {
  title: string; description: string; priority: ProjectCardPriority; start_date: string; due_date: string;
  assignee_user_id: string | null; labels: string[]; linked_page_id: string | null;
  parent_card_id: string | null; depends_on: string[];
  completed: boolean; checklist: ProjectCardChecklistItem[]; attachments: ProjectCardAttachment[]; links: ProjectCardLink[];
}

interface PendingFile { id: string; file: File; preview: string }

interface CardSaveExtras { pendingFiles: PendingFile[]; removedAttachmentIds: string[] }

interface AutoSaveResult {
  attachments: ProjectCardAttachment[]
  uploadedPendingIds: string[]
}

interface UploadCardImagesResult {
  uploaded: ProjectCardAttachment[]
  uploadedPendingIds: string[]
  failedCount: number
}

interface CardDraftStored {
  form: CardForm
  savedAt: string
  removedAttachmentIds: string[]
}

interface CardModalStored {
  open: boolean
  boardId: string
  cardId: string | null
  columnId?: string
}

function getDraftKey(boardId: string, cardId: string | null, columnId?: string) {
  return `${CARD_DRAFT_PREFIX}${boardId}:${cardId ?? 'new'}:${columnId ?? ''}`
}

function saveCardDraft(key: string, draft: CardDraftStored) {
  try { sessionStorage.setItem(key, JSON.stringify(draft)) } catch { /* quota */ }
}

function loadCardDraft(key: string): CardDraftStored | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as CardDraftStored : null
  } catch { return null }
}

function clearCardDraft(key: string) {
  try { sessionStorage.removeItem(key) } catch { /* ignore */ }
}

function saveCardModalState(state: CardModalStored) {
  try { sessionStorage.setItem(CARD_MODAL_STATE_KEY, JSON.stringify(state)) } catch { /* quota */ }
}

function loadCardModalState(): CardModalStored | null {
  try {
    const raw = sessionStorage.getItem(CARD_MODAL_STATE_KEY)
    return raw ? JSON.parse(raw) as CardModalStored : null
  } catch { return null }
}

function clearCardModalState() {
  try { sessionStorage.removeItem(CARD_MODAL_STATE_KEY) } catch { /* ignore */ }
}

function reindexAllCards(list: ProjectCard[]): ProjectCard[] {
  const byCol = new Map<string, ProjectCard[]>()
  for (const c of list) {
    const col = byCol.get(c.column_id) ?? []
    col.push(c)
    byCol.set(c.column_id, col)
  }
  const result: ProjectCard[] = []
  for (const col of byCol.values()) {
    col.forEach((c, i) => result.push({ ...c, sort_order: i }))
  }
  return result
}

function resolveColumnId(overId: string, list: ProjectCard[]): string | null {
  if (overId.startsWith('col:')) return overId.slice(4)
  return list.find(c => c.id === overId)?.column_id ?? null
}

function applyCardMove(prev: ProjectCard[], activeId: string, overId: string): ProjectCard[] | null {
  if (activeId === overId) return null

  const activeCard = prev.find(c => c.id === activeId)
  if (!activeCard) return null

  const activeCol = activeCard.column_id
  const overCol = resolveColumnId(overId, prev)
  if (!overCol) return null

  if (activeCol === overCol && !overId.startsWith('col:')) {
    const colCards = prev.filter(c => c.column_id === activeCol).sort(byOrder)
    const oldIndex = colCards.findIndex(c => c.id === activeId)
    const newIndex = colCards.findIndex(c => c.id === overId)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null
    const reordered = arrayMove(colCards, oldIndex, newIndex)
    const others = prev.filter(c => c.column_id !== activeCol)
    return reindexAllCards([...others, ...reordered])
  }

  if (activeCol === overCol && overId.startsWith('col:')) {
    const colCards = prev.filter(c => c.column_id === activeCol).sort(byOrder)
    const oldIndex = colCards.findIndex(c => c.id === activeId)
    if (oldIndex === -1 || oldIndex === colCards.length - 1) return null
    const reordered = arrayMove(colCards, oldIndex, colCards.length - 1)
    const others = prev.filter(c => c.column_id !== activeCol)
    return reindexAllCards([...others, ...reordered])
  }

  const withoutActive = prev.filter(c => c.id !== activeId)
  const moved = { ...activeCard, column_id: overCol }

  if (overId.startsWith('col:')) {
    const others = withoutActive.filter(c => c.column_id !== overCol)
    const targetCol = withoutActive.filter(c => c.column_id === overCol)
    return reindexAllCards([...others, ...targetCol, moved])
  }

  const overIndex = withoutActive.findIndex(c => c.id === overId)
  if (overIndex === -1) return null
  const next = [...withoutActive]
  next.splice(overIndex, 0, moved)
  return reindexAllCards(next)
}

function moveCardToColumn(prev: ProjectCard[], cardId: string, targetColumnId: string): ProjectCard[] | null {
  const activeCard = prev.find(c => c.id === cardId)
  if (!activeCard || activeCard.column_id === targetColumnId) return null
  const withoutActive = prev.filter(c => c.id !== cardId)
  const moved = { ...activeCard, column_id: targetColumnId }
  const targetCol = withoutActive.filter(c => c.column_id === targetColumnId)
  const others = withoutActive.filter(c => c.column_id !== targetColumnId)
  return reindexAllCards([...others, ...targetCol, moved])
}

const collisionDetection: CollisionDetection = (args) => {
  // When dragging a column, only collide with other columns so the drop always
  // resolves to a column (never a card under the pointer) and the horizontal
  // sortable preview animates. Card drags keep the full set of droppables.
  const isColumnDrag = args.active?.data?.current?.type === 'column'
  const scoped = isColumnDrag
    ? { ...args, droppableContainers: args.droppableContainers.filter(c => c.data.current?.type === 'column') }
    : args
  const pointerCollisions = pointerWithin(scoped)
  if (pointerCollisions.length > 0) return pointerCollisions
  return rectIntersection(scoped)
}

async function uploadCardImages(
  userId: string, boardId: string, cardId: string, pending: PendingFile[],
): Promise<UploadCardImagesResult> {
  const uploaded: ProjectCardAttachment[] = []
  const uploadedPendingIds: string[] = []
  let failedCount = 0
  for (const p of pending) {
    const ext = p.file.name.split('.').pop() ?? (p.file.type.split('/')[1] || 'jpg')
    const path = `${userId}/${boardId}/${cardId}/${Date.now()}-${p.id}.${ext}`
    const { error } = await supabase.storage
      .from(CARD_IMAGES_BUCKET)
      .upload(path, p.file, { contentType: p.file.type, upsert: false })
    if (error) {
      failedCount++
      continue
    }
    // Bucket privado: persiste o path; a URL assinada e' gerada no render.
    uploaded.push({ id: crypto.randomUUID(), url: path, name: p.file.name || `image.${ext}` })
    uploadedPendingIds.push(p.id)
  }
  return { uploaded, uploadedPendingIds, failedCount }
}

async function persistCardAttachments(
  userId: string, boardId: string, cardId: string,
  form: CardForm, extras: CardSaveExtras,
): Promise<AutoSaveResult> {
  let attachments = (form.attachments ?? []).filter(a => !extras.removedAttachmentIds.includes(a.id))
  let uploadedPendingIds: string[] = []
  if (extras.pendingFiles.length > 0) {
    const { uploaded, uploadedPendingIds: ids, failedCount } = await uploadCardImages(userId, boardId, cardId, extras.pendingFiles)
    if (failedCount > 0 && uploaded.length === 0) throw new Error('upload_failed')
    attachments = [...attachments, ...uploaded]
    uploadedPendingIds = ids
  }
  return { attachments, uploadedPendingIds }
}

function CardImageLightbox({ preview, onClose }: { preview: { url: string; name: string } | null; onClose: () => void }) {
  const { t } = useLanguage()
  const [resolvedUrl, setResolvedUrl] = useState('')

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, onClose])

  useEffect(() => {
    let active = true
    if (preview) resolveSignedUrl(CARD_IMAGES_BUCKET, preview.url).then(u => { if (active) setResolvedUrl(u) })
    else setResolvedUrl('')
    return () => { active = false }
  }, [preview])

  const handleDownload = async () => {
    if (!preview || !resolvedUrl) return
    try {
      const res = await fetch(resolvedUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = preview.name.split('.').pop() ?? blob.type.split('/')[1] ?? 'jpg'
      a.download = preview.name.includes('.') ? preview.name : `image_${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(resolvedUrl, '_blank')
    }
  }

  if (!preview) return null

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', padding: 16 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '95vw', maxHeight: '95vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-end' }}>
          <button
            type="button"
            onClick={handleDownload}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <Download size={15} />{t('projects_attachments_download')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={18} />
          </button>
        </div>
        <img
          src={resolvedUrl}
          alt={preview.name}
          style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8, display: 'block' }}
        />
      </div>
    </div>
  )
}

function CardAttachmentsSection({
  attachments, pendingFiles, removedIds, canEdit, onAddPending, onRemoveExisting, onRemovePending,
}: {
  attachments: ProjectCardAttachment[]; pendingFiles: PendingFile[]; removedIds: string[];
  canEdit: boolean;
  onAddPending: (file: File) => void;
  onRemoveExisting: (id: string) => void;
  onRemovePending: (id: string) => void;
}) {
  const { t } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const [open, setOpen] = useState(false)
  const visibleAttachments = attachments.filter(a => !removedIds.includes(a.id))
  const total = visibleAttachments.length + pendingFiles.length

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) onAddPending(file)
    e.target.value = ''
  }

  return (
    <div>
      <CardImageLightbox preview={preview} onClose={() => setPreview(null)} />
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', marginBottom: open ? 4 : 0, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {open ? <ChevronDown size={14} color="var(--color-text-muted)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
          <span style={{ ...labelStyle, marginBottom: 0 }}>{t('projects_attachments')}</span>
        </span>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {t('projects_attachments_count').replace('{count}', String(total))}
          </span>
        )}
      </button>
      {open && (
      <>
      {(visibleAttachments.length > 0 || pendingFiles.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {visibleAttachments.map(a => (
            <div key={a.id} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)', flexShrink: 0 }}>
              <button
                type="button"
                title={t('projects_attachments_view')}
                onClick={() => setPreview({ url: a.url, name: a.name })}
                style={{ width: '100%', height: '100%', padding: 0, border: 'none', cursor: 'pointer', background: 'var(--color-hover)' }}
              >
                <SignedImage bucket={CARD_IMAGES_BUCKET} stored={a.url} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemoveExisting(a.id) }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {pendingFiles.map(p => (
            <div key={p.id} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px dashed #6366f1', flexShrink: 0 }}>
              <button
                type="button"
                title={t('projects_attachments_view')}
                onClick={() => setPreview({ url: p.preview, name: p.file.name || 'image' })}
                style={{ width: '100%', height: '100%', padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
              >
                <img src={p.preview} alt={p.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemovePending(p.id) }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12.5, cursor: 'pointer', marginBottom: 6 }}
          >
            <Image size={14} />{t('projects_attachments_add')}
          </button>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{t('projects_attachments_paste_hint')}</p>
        </>
      )}
      </>
      )}
    </div>
  )
}

function CardChecklistSection({
  items, canEdit, onUpdate,
}: {
  items: ProjectCardChecklistItem[]; canEdit: boolean;
  onUpdate: (items: ProjectCardChecklistItem[], immediate: boolean) => void;
}) {
  const { t } = useLanguage()
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const done = items.filter(i => i.completed).length
  const total = items.length
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0

  const addItem = () => {
    const text = input.trim()
    if (!text) return
    onUpdate([...items, { id: crypto.randomUUID(), text, completed: false }], true)
    setInput('')
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', marginBottom: open ? 4 : 0, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {open ? <ChevronDown size={14} color="var(--color-text-muted)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
          <span style={{ ...labelStyle, marginBottom: 0 }}>{t('projects_checklist')}</span>
        </span>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {t('projects_checklist_progress').replace('{done}', String(done)).replace('{total}', String(total))}
          </span>
        )}
      </button>
      {open && (
        <>
          {total > 0 && (
            <div style={{ height: 4, borderRadius: 999, backgroundColor: 'var(--color-hover)', marginBottom: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 999, backgroundColor: done === total ? '#22c55e' : '#6366f1', transition: 'width 0.2s' }} />
            </div>
          )}
          {items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map(item => (
                <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={!canEdit}
                    onChange={() => onUpdate(items.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i), true)}
                    style={{ flexShrink: 0, cursor: canEdit ? 'pointer' : 'default' }}
                  />
                  <input
                    disabled={!canEdit}
                    value={item.text}
                    onChange={e => onUpdate(items.map(i => i.id === item.id ? { ...i, text: e.target.value } : i), false)}
                    style={{
                      flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                      fontSize: 13, color: item.completed ? 'var(--color-text-muted)' : 'var(--color-text)',
                      textDecoration: item.completed ? 'line-through' : 'none', padding: '4px 0',
                    }}
                  />
                  {canEdit && (
                    <button
                      onClick={() => onUpdate(items.filter(i => i.id !== item.id), true)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder={t('projects_checklist_placeholder')}
              style={inputStyle}
            />
          )}
        </>
      )}
    </div>
  )
}

// Trello-style links: attach a web URL (+ optional display text), shown as a
// clickable list that opens each link directly in a new tab.
function CardLinksSection({ links, canEdit, onUpdate }: {
  links: ProjectCardLink[]; canEdit: boolean;
  onUpdate: (links: ProjectCardLink[], immediate: boolean) => void;
}) {
  const { t } = useLanguage()
  const [urlInput, setUrlInput] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const canAdd = !!normalizeLinkUrl(urlInput)

  const addLink = () => {
    const url = normalizeLinkUrl(urlInput)
    if (!url) return
    onUpdate([...links, { id: crypto.randomUUID(), url, title: titleInput.trim() }], true)
    setUrlInput('')
    setTitleInput('')
  }

  return (
    <div>
      <label style={labelStyle}>{t('projects_links')}</label>
      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: canEdit ? 8 : 0 }}>
          {links.map(link => (
            <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--color-hover)', borderRadius: 6, padding: '6px 8px' }}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}
                style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)', fontSize: 13, fontWeight: 500, textDecoration: 'none', overflow: 'hidden' }}>
                <Link2 size={13} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkDisplay(link)}</span>
              </a>
              {canEdit && (
                <button onClick={() => onUpdate(links.filter(l => l.id !== link.id), true)} title={t('projects_delete')}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
            placeholder={t('projects_links_url_placeholder')} style={inputStyle} />
          <input value={titleInput} onChange={e => setTitleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
            placeholder={t('projects_links_title_placeholder')} style={inputStyle} />
          <button type="button" onClick={addLink} disabled={!canAdd}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'transparent', color: canAdd ? 'var(--color-primary)' : 'var(--color-text-muted)', fontSize: 12.5, fontWeight: 600, cursor: canAdd ? 'pointer' : 'default' }}>
            <Link2 size={14} />{t('projects_links_add')}
          </button>
        </div>
      )}
    </div>
  )
}

// Collapsible group used to categorize the card's meta fields (button + chevron,
// mirroring the CardFilterBar collapse pattern).
function CollapsibleSection({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text)', fontSize: 13, fontWeight: 600 }}>
        <span>{title}</span>
        {open ? <ChevronUp size={15} color="var(--color-text-muted)" /> : <ChevronDown size={15} color="var(--color-text-muted)" />}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 12px 12px' }}>{children}</div>}
    </div>
  )
}

function CardModal({ card, boardId: _boardId, columnId: _columnId, members, allCards, canEdit, isMobile, initialDraft, saveStatus, saveErrorKind, onClose, onSave, onDelete, onOpenPage, onAutoSave, onDraftChange }: {
  card: ProjectCard | null; boardId: string; columnId?: string; members: Member[]; allCards: ProjectCard[]; canEdit: boolean; isMobile?: boolean;
  initialDraft?: CardDraftStored | null; saveStatus?: 'idle' | 'saving' | 'saved' | 'error'; saveErrorKind?: 'upload' | 'general';
  onClose: () => void; onSave: (f: CardForm, extras: CardSaveExtras) => void; onDelete?: () => void; onOpenPage: (id: string) => void;
  onAutoSave?: (form: CardForm, extras: CardSaveExtras) => Promise<AutoSaveResult | null> | AutoSaveResult | null;
  onDraftChange?: (form: CardForm, removedAttachmentIds: string[]) => void;
}) {
  const { t } = useLanguage()

  const resolveInitialForm = (): CardForm => {
    if (initialDraft?.form) {
      const cardUpdated = card?.updated_at ? new Date(card.updated_at).getTime() : 0
      const draftSaved = new Date(initialDraft.savedAt).getTime()
      if (!card || draftSaved >= cardUpdated) return initialDraft.form
    }
    return {
      title: card?.title ?? '', description: card?.description ?? '', priority: card?.priority ?? 'medium',
      start_date: card?.start_date ?? '', due_date: card?.due_date ?? '', assignee_user_id: card?.assignee_user_id ?? null,
      labels: card?.labels ?? [], linked_page_id: card?.linked_page_id ?? null,
      parent_card_id: card?.parent_card_id ?? null, depends_on: card?.depends_on ?? [], completed: card?.completed ?? false,
      checklist: card?.checklist ?? [], attachments: card?.attachments ?? [], links: card?.links ?? [],
    }
  }

  const [form, setForm] = useState<CardForm>(resolveInitialForm)
  const [labelInput, setLabelInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>(initialDraft?.removedAttachmentIds ?? [])
  const [editingDesc, setEditingDesc] = useState(false)
  const autoSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef(form)
  const removedIdsRef = useRef(removedAttachmentIds)
  const pendingFilesRef = useRef<PendingFile[]>([])
  formRef.current = form
  removedIdsRef.current = removedAttachmentIds
  pendingFilesRef.current = pendingFiles

  const priorities: ProjectCardPriority[] = ['low', 'medium', 'high', 'urgent']
  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}` as 'projects_priority_low')

  const getExtras = useCallback((): CardSaveExtras => ({
    pendingFiles: pendingFilesRef.current,
    removedAttachmentIds: removedIdsRef.current,
  }), [])

  const applyAutoSaveResult = useCallback((result: AutoSaveResult) => {
    setForm(f => {
      const next = { ...f, attachments: result.attachments }
      formRef.current = next
      return next
    })
    setRemovedAttachmentIds([])
    removedIdsRef.current = []
    if (result.uploadedPendingIds.length > 0) {
      setPendingFiles(prev => {
        const next = prev.filter(p => {
          if (result.uploadedPendingIds.includes(p.id)) URL.revokeObjectURL(p.preview)
          return !result.uploadedPendingIds.includes(p.id)
        })
        pendingFilesRef.current = next
        return next
      })
    }
  }, [])

  const runAutoSave = useCallback(async (nextForm: CardForm, immediate: boolean) => {
    if (!onAutoSave || !canEdit) return
    if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current)
    const execute = async () => {
      const result = await onAutoSave(nextForm, getExtras())
      if (result) applyAutoSaveResult(result)
    }
    if (immediate) await execute()
    else autoSaveDebounceRef.current = setTimeout(() => { void execute() }, AUTOSAVE_DEBOUNCE_MS)
  }, [onAutoSave, canEdit, getExtras, applyAutoSaveResult])

  const scheduleAutoSave = useCallback((nextForm: CardForm, immediate: boolean) => {
    void runAutoSave(nextForm, immediate)
  }, [runAutoSave])

  const patchForm = useCallback((updater: (f: CardForm) => CardForm, immediate = false) => {
    let nextForm: CardForm | null = null
    setForm(prev => {
      nextForm = updater(prev)
      formRef.current = nextForm
      return nextForm
    })
    if (nextForm) {
      onDraftChange?.(nextForm, removedIdsRef.current)
      scheduleAutoSave(nextForm, immediate)
    }
  }, [onDraftChange, scheduleAutoSave])

  const addPendingFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const id = crypto.randomUUID()
    const pending: PendingFile = { id, file, preview: URL.createObjectURL(file) }
    setPendingFiles(prev => {
      const next = [...prev, pending]
      pendingFilesRef.current = next
      return next
    })
    void runAutoSave(formRef.current, true)
  }

  const removePendingFile = (id: string) => {
    setPendingFiles(prev => {
      const item = prev.find(p => p.id === id)
      if (item) URL.revokeObjectURL(item.preview)
      const next = prev.filter(p => p.id !== id)
      pendingFilesRef.current = next
      return next
    })
  }

  const removeExistingAttachment = (id: string) => {
    const next = [...removedIdsRef.current, id]
    removedIdsRef.current = next
    setRemovedAttachmentIds(next)
    onDraftChange?.(formRef.current, next)
    void runAutoSave(formRef.current, true)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canEdit) return
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addPendingFile(file)
      }
    }
  }

  const handleSave = () => {
    onSave(form, { pendingFiles, removedAttachmentIds })
  }

  useEffect(() => () => { if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current) }, [])

  useEffect(() => {
    const flushDraft = () => {
      if (onDraftChange) onDraftChange(formRef.current, removedIdsRef.current)
    }
    document.addEventListener('visibilitychange', flushDraft)
    window.addEventListener('pagehide', flushDraft)
    return () => {
      document.removeEventListener('visibilitychange', flushDraft)
      window.removeEventListener('pagehide', flushDraft)
    }
  }, [onDraftChange])

  const updateChecklist = (checklist: ProjectCardChecklistItem[], immediate: boolean) => {
    patchForm(f => ({ ...f, checklist }), immediate)
  }

  const addLabel = () => {
    const v = labelInput.trim()
    if (v && !form.labels.includes(v)) patchForm(f => ({ ...f, labels: [...f.labels, v] }), true)
    setLabelInput('')
  }

  const saveStatusLabel = saveStatus === 'saving'
    ? t('projects_saving')
    : saveStatus === 'saved'
      ? t('projects_saved')
      : saveStatus === 'error'
        ? (saveErrorKind === 'upload' ? t('projects_attachments_upload_error') : t('projects_autosave_error'))
        : null

  const priorityButtons = (
    <div>
      <label style={labelStyle}>{t('projects_priority')}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {priorities.map(p => (
          <button key={p} disabled={!canEdit} onClick={() => patchForm(f => ({ ...f, priority: p }), true)}
            style={{ flex: 1, padding: isMobile ? '10px 0' : '7px 0', minHeight: isMobile ? 40 : undefined, borderRadius: 8, border: '1.5px solid', borderColor: form.priority === p ? PRIORITY_COLORS[p] : 'var(--color-border)', backgroundColor: form.priority === p ? `${PRIORITY_COLORS[p]}1f` : 'var(--color-bg)', color: form.priority === p ? PRIORITY_COLORS[p] : 'var(--color-text-muted)', fontSize: 12, fontWeight: form.priority === p ? 700 : 500, cursor: canEdit ? 'pointer' : 'default' }}>
            {pLabel(p)}
          </button>
        ))}
      </div>
    </div>
  )

  const dueAssigneeFields = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('projects_start_date')}</label>
          <input disabled={!canEdit} type="date" max={form.due_date || undefined} value={form.start_date} onChange={e => patchForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('projects_due_date')}</label>
          <input disabled={!canEdit} type="date" min={form.start_date || undefined} value={form.due_date} onChange={e => patchForm(f => ({ ...f, due_date: e.target.value }))} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>{t('projects_assignee')}</label>
        <select disabled={!canEdit} value={form.assignee_user_id ?? ''} onChange={e => patchForm(f => ({ ...f, assignee_user_id: e.target.value || null }), true)} style={inputStyle}>
          <option value="">{t('projects_unassigned')}</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
        </select>
      </div>
    </div>
  )

  // Cards selectable as parent / dependency: exclude self and (for parent) own descendants to avoid cycles.
  const descendantIds = useMemo(() => {
    if (!card) return new Set<string>()
    const childrenOf = new Map<string, string[]>()
    allCards.forEach(c => {
      if (c.parent_card_id) {
        const arr = childrenOf.get(c.parent_card_id) ?? []
        arr.push(c.id)
        childrenOf.set(c.parent_card_id, arr)
      }
    })
    const out = new Set<string>()
    const stack = [card.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const childId of childrenOf.get(id) ?? []) {
        if (!out.has(childId)) { out.add(childId); stack.push(childId) }
      }
    }
    return out
  }, [card, allCards])

  const parentOptions = useMemo(
    () => allCards.filter(c => c.id !== card?.id && !descendantIds.has(c.id)),
    [allCards, card, descendantIds],
  )
  const dependencyOptions = useMemo(
    () => allCards.filter(c => c.id !== card?.id && !form.depends_on.includes(c.id)),
    [allCards, card, form.depends_on],
  )
  const cardTitleById = useCallback(
    (id: string) => allCards.find(c => c.id === id)?.title || t('projects_new_card'),
    [allCards, t],
  )

  const parentField = (
    <div>
      <label style={labelStyle}>{t('projects_parent_task')}</label>
      <select disabled={!canEdit} value={form.parent_card_id ?? ''} onChange={e => patchForm(f => ({ ...f, parent_card_id: e.target.value || null }), true)} style={inputStyle}>
        <option value="">{t('projects_no_parent')}</option>
        {parentOptions.map(c => <option key={c.id} value={c.id}>{c.title || t('projects_new_card')}</option>)}
      </select>
    </div>
  )

  const dependenciesField = (
    <div>
      <label style={labelStyle}>{t('projects_dependencies')}</label>
      {form.depends_on.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {form.depends_on.map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text)', backgroundColor: 'var(--color-hover)', padding: '3px 8px', borderRadius: 6 }}>
              {cardTitleById(id)}
              {canEdit && <button onClick={() => patchForm(f => ({ ...f, depends_on: f.depends_on.filter(d => d !== id) }), true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0 }}><X size={11} /></button>}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <select value="" disabled={dependencyOptions.length === 0} onChange={e => { const id = e.target.value; if (id) patchForm(f => ({ ...f, depends_on: [...f.depends_on, id] }), true) }} style={inputStyle}>
          <option value="">{t('projects_dependencies_add')}</option>
          {dependencyOptions.map(c => <option key={c.id} value={c.id}>{c.title || t('projects_new_card')}</option>)}
        </select>
      )}
    </div>
  )

  const labelsField = (
    <div>
      <label style={labelStyle}>{t('projects_labels')}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {form.labels.map((l, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text)', backgroundColor: 'var(--color-hover)', padding: '3px 8px', borderRadius: 6 }}>
            {l}{canEdit && <button onClick={() => patchForm(f => ({ ...f, labels: f.labels.filter((_, j) => j !== i) }), true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0 }}><X size={11} /></button>}
          </span>
        ))}
      </div>
      {canEdit && <input value={labelInput} onChange={e => setLabelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }} placeholder={t('projects_labels_placeholder')} style={inputStyle} />}
    </div>
  )

  const linkedPageField = (
    <div>
      <label style={labelStyle}>{t('projects_linked_page')}</label>
      <PagePicker value={form.linked_page_id} onChange={(id) => patchForm(f => ({ ...f, linked_page_id: id }), true)} />
      {form.linked_page_id && (
        <button onClick={() => onOpenPage(form.linked_page_id!)} style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#6366f1', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          <ExternalLink size={13} />{t('projects_open_page')}
        </button>
      )}
    </div>
  )

  const linksField = (
    <CardLinksSection
      links={form.links}
      canEdit={canEdit}
      onUpdate={(links, immediate) => patchForm(f => ({ ...f, links }), immediate)}
    />
  )

  const completedField = canEdit ? (
    <button type="button" onClick={() => patchForm(f => ({ ...f, completed: !f.completed }), true)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid', borderColor: form.completed ? '#22c55e' : 'var(--color-border)', backgroundColor: form.completed ? '#22c55e1f' : 'var(--color-bg)', color: form.completed ? '#22c55e' : 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid', borderColor: form.completed ? '#22c55e' : 'var(--color-border)', backgroundColor: form.completed ? '#22c55e' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {form.completed && <Check size={12} color="#fff" />}
      </span>
      {t('projects_overview_completed')}
    </button>
  ) : null

  const planningSection = (
    <CollapsibleSection title={t('projects_section_planning')} defaultOpen>
      {priorityButtons}
      {dueAssigneeFields}
    </CollapsibleSection>
  )
  const organizationSection = (
    <CollapsibleSection title={t('projects_section_organization')}>
      {parentField}
      {dependenciesField}
      {labelsField}
      {completedField}
    </CollapsibleSection>
  )
  const linksSection = (
    <CollapsibleSection title={t('projects_section_links')}>
      {linksField}
      {linkedPageField}
    </CollapsibleSection>
  )

  const footer = (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4,
      ...(isMobile ? { position: 'sticky', bottom: 0, backgroundColor: 'var(--color-bg)', paddingTop: 12, borderTop: '1px solid var(--color-border)', marginTop: 16 } : {}),
    }}>
      {canEdit && onDelete ? (
        <button onClick={onDelete} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Trash2 size={14} />{t('projects_delete')}
        </button>
      ) : <span />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {saveStatusLabel && (
          <span style={{ fontSize: 12, fontWeight: 600, color: saveStatus === 'error' ? '#ef4444' : 'var(--color-text-muted)' }}>
            {saveStatusLabel}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
          {canEdit && <PrimaryBtn onClick={handleSave} disabled={!form.title.trim()}>{t('projects_save')}</PrimaryBtn>}
        </div>
      </div>
    </div>
  )

  const attachmentsField = (
    <CardAttachmentsSection
      attachments={form.attachments}
      pendingFiles={pendingFiles}
      removedIds={removedAttachmentIds}
      canEdit={canEdit}
      onAddPending={addPendingFile}
      onRemoveExisting={removeExistingAttachment}
      onRemovePending={removePendingFile}
    />
  )

  const titleField = (
    <div>
      <label style={labelStyle}>{t('projects_card_title')}</label>
      <input disabled={!canEdit} value={form.title} onChange={e => patchForm(f => ({ ...f, title: e.target.value }))} placeholder={t('projects_card_title_placeholder')} style={{ ...inputStyle, fontSize: isMobile ? 14 : 16, fontWeight: 600 }} autoFocus={!isMobile} />
    </div>
  )

  // Trello-style description: rendered preview by default, click to edit (visual editor).
  const descriptionField = (
    <div>
      <label style={labelStyle}>{t('projects_card_description')}</label>
      {canEdit && editingDesc ? (
        <div>
          <RichTextEditor
            markdown={form.description}
            onChange={md => patchForm(f => ({ ...f, description: md }))}
            onBlur={() => setEditingDesc(false)}
            autoFocus
            minHeight={isMobile ? 200 : 440}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setEditingDesc(false)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <CheckSquare size={14} />{t('projects_desc_done')}
            </button>
          </div>
        </div>
      ) : (
        <div onClick={() => { if (canEdit) setEditingDesc(true) }}
          style={{ ...inputStyle, minHeight: 64, height: 'auto', padding: '10px 12px', cursor: canEdit ? 'text' : 'default' }}>
          {form.description.trim()
            ? <MarkdownText text={form.description} style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5 }} />
            : <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{canEdit ? t('projects_card_description_placeholder') : ''}</span>}
        </div>
      )}
    </div>
  )

  const mainColumn = (
    <>
      {descriptionField}
      {attachmentsField}
      <CardChecklistSection items={form.checklist} canEdit={canEdit} onUpdate={updateChecklist} />
    </>
  )

  const leftColumn = (
    <>
      {titleField}
      {mainColumn}
    </>
  )

  return (
    <Modal
      title={card ? t('projects_edit_card') : t('projects_new_card')}
      onClose={onClose}
      closeOnBackdrop={false}
      isMobile={isMobile}
      width={1040}
      maxHeight="92vh"
    >
      {isMobile ? (
        <div onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {leftColumn}
          {planningSection}
          {organizationSection}
          {linksSection}
          {footer}
        </div>
      ) : (
        <div onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {titleField}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(240px, 1fr)', gap: 20, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {mainColumn}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, backgroundColor: 'var(--color-bg-secondary)', borderRadius: 10 }}>
              {planningSection}
              {organizationSection}
              {linksSection}
            </div>
          </div>
          {footer}
        </div>
      )}
    </Modal>
  )
}

// ─── Board modal ────────────────────────────────────────────────────────────

function BoardModal({ board, onClose, onSave }: { board: ProjectBoard | null; onClose: () => void; onSave: (data: { name: string; icon: string; color: string; description: string }) => void }) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [name, setName] = useState(board?.name ?? '')
  const [icon, setIcon] = useState(board?.icon ?? '📋')
  const [color, setColor] = useState(board?.color ?? '#6366f1')
  const [description, setDescription] = useState(board?.description ?? '')
  return (
    <Modal title={board ? t('projects_edit_board') : t('projects_create_board')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_board_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('projects_board_name_placeholder')} style={inputStyle} autoFocus={!isMobile} />
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_icon')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {BOARD_ICONS.map(ic => (
              <button key={ic} onClick={() => setIcon(ic)} style={{ width: 34, height: 34, borderRadius: 8, border: '1.5px solid', borderColor: icon === ic ? '#6366f1' : 'var(--color-border)', background: icon === ic ? '#6366f11f' : 'var(--color-bg)', fontSize: 17, cursor: 'pointer' }}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_color')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {BOARD_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', border: color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_description')}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
          <PrimaryBtn onClick={() => onSave({ name, icon, color, description })} disabled={!name.trim()}>{board ? t('projects_save') : t('projects_create')}</PrimaryBtn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Column modal ─────────────────────────────────────────────────────────────

function ColumnModal({ column, onClose, onSave }: { column: ProjectColumn | null; onClose: () => void; onSave: (data: { name: string; color: string; wip_limit: number | null }) => void }) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [name, setName] = useState(column?.name ?? '')
  const [color, setColor] = useState(column?.color ?? '#94a3b8')
  const [wip, setWip] = useState<string>(column?.wip_limit != null ? String(column.wip_limit) : '')
  return (
    <Modal title={column ? t('projects_rename_column') : t('projects_add_column')} onClose={onClose} width={380}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_column_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus={!isMobile} />
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_color')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {BOARD_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', border: color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_wip_limit')}</label>
          <input type="number" min={0} value={wip} onChange={e => setWip(e.target.value)} style={inputStyle} placeholder="—" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
          <PrimaryBtn onClick={() => onSave({ name: name.trim() || t('projects_column_name'), color, wip_limit: wip === '' ? null : Math.max(0, parseInt(wip, 10) || 0) })} disabled={!name.trim()}>{t('projects_save')}</PrimaryBtn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Share modal ──────────────────────────────────────────────────────────────

function ShareModal({ board, onClose }: { board: ProjectBoard; onClose: () => void }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [shares, setShares] = useState<ProjectShare[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Member[]>([])
  const [role, setRole] = useState<ProjectShareRole>('editor')
  const [err, setErr] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('project_shares')
      .select('*, profiles!project_shares_shared_with_user_id_fkey(email, display_name, avatar_emoji, avatar_color, avatar_url)')
      .eq('board_id', board.id)
      .order('created_at', { ascending: true })
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setShares(data.map((r: any) => ({ ...r, profile: Array.isArray(r.profiles) ? r.profiles[0] : r.profiles })))
    }
  }, [board.id])

  useEffect(() => { load() }, [load])

  const search = (val: string) => {
    setQ(val)
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim()) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      const term = sanitizeIlikeTerm(val)
      if (term.length < 3) { setResults([]); return }
      const exclude = new Set([user?.id, board.user_id, ...shares.map(s => s.shared_with_user_id)])
      const { data } = await supabase.rpc('search_users_for_share', { p_term: term })
      if (data) setResults((data as Member[]).filter(m => !exclude.has(m.id)))
    }, 300)
  }

  const add = async (m: Member) => {
    setErr(null)
    const { error } = await supabase.from('project_shares').insert({ board_id: board.id, owner_id: user!.id, shared_with_user_id: m.id, role })
    if (error) { setErr(t('projects_share_not_found')); return }
    setQ(''); setResults([]); await load()
  }
  const remove = async (id: string) => { await supabase.from('project_shares').delete().eq('id', id); await load() }

  return (
    <Modal title={t('projects_share_title')} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg)' }}>
          <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
          <input value={q} onChange={e => search(e.target.value)} placeholder={t('projects_share_email')} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)' }} />
        </div>
        <select value={role} onChange={e => setRole(e.target.value as ProjectShareRole)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="editor">{t('projects_share_role_editor')}</option>
          <option value="viewer">{t('projects_share_role_viewer')}</option>
        </select>
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 10px' }}>{err}</p>}
      {results.length > 0 && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
          {results.map(m => (
            <button key={m.id} onClick={() => add(m)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
              <UserAvatar name={m.display_name || m.email} seed={m.email} emoji={m.avatar_emoji} color={m.avatar_color} url={m.avatar_url} size={26} />
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{m.display_name || m.email}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shares.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>{t('projects_share_none')}</p>}
        {shares.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
            <UserAvatar name={s.profile?.display_name || s.profile?.email || '?'} seed={s.profile?.email} emoji={s.profile?.avatar_emoji} color={s.profile?.avatar_color} url={s.profile?.avatar_url} size={30} />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{s.profile?.display_name || s.profile?.email}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{s.role === 'editor' ? t('projects_share_role_editor') : t('projects_share_role_viewer')}</span>
            <button onClick={() => remove(s.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', padding: 4 }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ columns, cards, members }: { columns: ProjectColumn[]; cards: ProjectCard[]; members: Member[] }) {
  const { t } = useLanguage()
  const today = todayStr()
  const s = overviewSummary(cards, today)

  const colCounts = countByColumnId(cards)
  const statusData: ChartDatum[] = columns.map(col => ({ label: col.name, value: colCounts[col.id] ?? 0, color: col.color }))
  const priCounts = countByPriority(cards)
  const priData: ChartDatum[] = PRIORITY_ORDER.map(p => ({ label: t(`projects_priority_${p}` as 'projects_priority_low'), value: priCounts[p], color: PRIORITY_COLORS[p] }))

  const assignees = countByAssignee(cards).slice(0, 6)
  const maxAssignee = Math.max(1, ...assignees.map(a => a.count))

  const due = dueBuckets(cards, today)
  const dueSegs: ChartDatum[] = [
    { label: t('projects_overview_due_overdue'), value: due.overdue, color: '#ef4444' },
    { label: t('projects_overview_due_today'), value: due.today, color: '#f59e0b' },
    { label: t('projects_overview_due_week'), value: due.week, color: '#3b82f6' },
    { label: t('projects_overview_due_later'), value: due.later, color: '#6366f1' },
    { label: t('projects_overview_due_none'), value: due.none, color: 'var(--color-text-muted)' },
  ]

  const weekLabel = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
  const trend = createdPerWeek(cards, 8, today).map(b => ({ label: weekLabel(b.weekStart), value: b.count }))

  const stat = (label: string, value: number | string, color: string, sub?: string) => (
    <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color }}>{value}</span>
        {sub && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)' }}>{sub}</span>}
      </div>
    </div>
  )
  const cardBox = (title: string, children: React.ReactNode, full?: boolean): React.ReactNode => (
    <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px', ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  )

  if (cards.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', fontSize: 14, color: 'var(--color-text-muted)' }}>{t('projects_overview_empty')}</div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {stat(t('projects_overview_total_cards'), s.total, 'var(--color-text)')}
        {stat(t('projects_overview_open'), s.open, 'var(--color-text)')}
        {stat(t('projects_overview_completed'), s.completed, '#22c55e', `${s.completionPct}%`)}
        {stat(t('projects_overview_overdue'), s.overdue, '#ef4444')}
        {stat(t('projects_overview_due_week'), s.dueThisWeekOpen, '#f59e0b')}
        {stat(t('projects_overview_unassigned'), s.unassigned, '#6366f1')}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {cardBox(t('projects_overview_by_column'), (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut data={statusData} centerValue={s.total} centerLabel={t('projects_overview_total_cards')} />
            <Legend items={statusData} />
          </div>
        ))}
        {cardBox(t('projects_overview_by_priority'), (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Donut data={priData} centerValue={s.total} centerLabel={t('projects_overview_total_cards')} />
            <Legend items={priData} />
          </div>
        ))}
        {cardBox(t('projects_overview_by_assignee'), (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {assignees.map(a => {
              const m = a.id ? members.find(mm => mm.id === a.id) : null
              const name = m ? (m.display_name || m.email) : t('projects_overview_unassigned')
              const w = (a.count / maxAssignee) * 100
              return (
                <div key={a.id ?? 'none'} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m
                    ? <UserAvatar name={name} seed={m.email} emoji={m.avatar_emoji} color={m.avatar_color} url={m.avatar_url} size={22} />
                    : <span style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>–</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', flexShrink: 0 }}>{a.count}</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 999, backgroundColor: 'var(--color-hover)' }}><div style={{ width: `${w}%`, height: '100%', backgroundColor: '#6366f1', borderRadius: 999 }} /></div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {cardBox(t('projects_overview_by_due'), (
          <>
            <SegmentedBar segments={dueSegs} />
            <div style={{ marginTop: 14 }}><Legend items={dueSegs} /></div>
          </>
        ))}
        {cardBox(t('projects_overview_created_trend'), (
          <AreaTrend points={trend} color="#6366f1" />
        ), true)}
      </div>
    </div>
  )
}

// ─── Compact kanban (mobile focus) ────────────────────────────────────────────

function CompactKanbanView({
  boardId,
  columns,
  cardsByColumn,
  canEdit,
  priorityLabel,
  sensors,
  persistError,
  onDragStart,
  onDragOver,
  onDragEnd,
  activeDragCard,
  pLabel,
  onAddCard,
  onCardClick,
  onRename,
  onDelete,
  onMoveCardToColumn,
  onReorderColumn,
}: {
  boardId: string
  columns: ProjectColumn[]
  cardsByColumn: Record<string, ProjectCard[]>
  canEdit: boolean
  priorityLabel: (p: ProjectCardPriority) => string
  sensors: ReturnType<typeof useSensors>
  persistError: string | null
  onDragStart: (e: DragStartEvent) => void
  onDragOver: (e: DragOverEvent) => void
  onDragEnd: (e: DragEndEvent) => void
  activeDragCard: ProjectCard | null | undefined
  pLabel: (p: ProjectCardPriority) => string
  onAddCard: (columnId: string) => void
  onCardClick: (c: ProjectCard) => void
  onRename: (col: ProjectColumn) => void
  onDelete: (col: ProjectColumn) => void
  onMoveCardToColumn: (cardId: string, targetColumnId: string) => void
  onReorderColumn?: (colId: string, dir: -1 | 1) => void
}) {
  const { t } = useLanguage()
  const storageKey = `${COMPACT_COLUMN_KEY}${boardId}`

  const [activeColumnId, setActiveColumnId] = useState(() => {
    try {
      const stored = sessionStorage.getItem(storageKey)
      if (stored && columns.some(c => c.id === stored)) return stored
    } catch { /* ignore */ }
    return columns[0]?.id ?? ''
  })

  useEffect(() => {
    if (activeColumnId && !columns.some(c => c.id === activeColumnId)) {
      setActiveColumnId(columns[0]?.id ?? '')
    }
  }, [columns, activeColumnId])

  useEffect(() => {
    if (activeColumnId) {
      try { sessionStorage.setItem(storageKey, activeColumnId) } catch { /* ignore */ }
    }
  }, [activeColumnId, storageKey])

  const activeCol = columns.find(c => c.id === activeColumnId) ?? columns[0]
  if (!activeCol) return null

  const activeColIdx = columns.findIndex(c => c.id === activeCol.id)
  const prevCol = activeColIdx > 0 ? columns[activeColIdx - 1] : null
  const nextCol = activeColIdx < columns.length - 1 ? columns[activeColIdx + 1] : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {persistError && (
        <div style={{ margin: '0 12px', padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 12.5, fontWeight: 600 }}>
          {persistError}
        </div>
      )}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: '12px 12px 0', flexShrink: 0,
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
      }}>
        {columns.map(col => {
          const count = cardsByColumn[col.id]?.length ?? 0
          const active = col.id === activeCol.id
          return (
            <button
              key={col.id}
              type="button"
              onClick={() => setActiveColumnId(col.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
                padding: '7px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap',
                backgroundColor: active ? '#6366f1' : 'var(--color-bg-secondary)',
                color: active ? '#fff' : 'var(--color-text-muted)',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: col.color, flexShrink: 0 }} />
              {col.name} · {count}
            </button>
          )
        })}
      </div>
      {onReorderColumn && columns.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 0', flexShrink: 0 }}>
          <button
            type="button"
            disabled={!prevCol}
            onClick={() => prevCol && onReorderColumn(activeCol.id, -1)}
            title={t('projects_column_move_left')}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: prevCol ? 'pointer' : 'default', color: 'var(--color-text-muted)', opacity: prevCol ? 1 : 0.4, padding: 0 }}
          >
            <ChevronLeft size={15} />
          </button>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('projects_reorder_column')}</span>
          <button
            type="button"
            disabled={!nextCol}
            onClick={() => nextCol && onReorderColumn(activeCol.id, 1)}
            title={t('projects_column_move_right')}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: nextCol ? 'pointer' : 'default', color: 'var(--color-text-muted)', opacity: nextCol ? 1 : 0.4, padding: 0 }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          <Column
            variant="compact"
            column={activeCol}
            cards={cardsByColumn[activeCol.id] ?? []}
            canEdit={canEdit}
            priorityLabel={priorityLabel}
            columnIndex={activeColIdx}
            columnsCount={columns.length}
            onMovePrev={prevCol ? (cardId) => onMoveCardToColumn(cardId, prevCol.id) : undefined}
            onMoveNext={nextCol ? (cardId) => onMoveCardToColumn(cardId, nextCol.id) : undefined}
            onAddCard={() => onAddCard(activeCol.id)}
            onCardClick={onCardClick}
            onRename={() => onRename(activeCol)}
            onDelete={() => onDelete(activeCol)}
          />
        </div>
        <DragOverlay>
          {activeDragCard ? (
            <div style={{ width: 'calc(100vw - 48px)', maxWidth: 480 }}>
              <CardView card={activeDragCard} priorityLabel={pLabel(activeDragCard.priority)} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

function ListView({ columns, cards, totalCount, onCardClick }: { columns: ProjectColumn[]; cards: ProjectCard[]; totalCount: number; onCardClick: (c: ProjectCard) => void }) {
  const { t } = useLanguage()
  const colName = (id: string) => columns.find(c => c.id === id)?.name ?? '—'
  const sorted = [...cards].sort(byOrder)
  if (totalCount === 0) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('projects_no_cards')}</p>
  if (sorted.length === 0) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('projects_empty_filter')}</p>
  const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 12px' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: 'var(--color-text)', borderTop: '1px solid var(--color-border)' }
  return (
    <div>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <th style={th}>{t('projects_table_card')}</th>
            <th style={th}>{t('projects_table_column')}</th>
            <th style={th}>{t('projects_table_priority')}</th>
            <th style={th}>{t('projects_table_assignee')}</th>
            <th style={th}>{t('projects_table_due')}</th>
          </tr></thead>
          <tbody>
            {sorted.map(c => (
              <tr key={c.id} onClick={() => onCardClick(c)} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, textDecoration: c.completed ? 'line-through' : 'none', opacity: c.completed ? 0.6 : 1 }}>{c.title}</td>
                <td style={td}>{colName(c.column_id)}</td>
                <td style={td}><PriorityBadge priority={c.priority} label={t(`projects_priority_${c.priority}` as 'projects_priority_low')} /></td>
                <td style={td}>{c.assignee_profile ? (c.assignee_profile.display_name || c.assignee_profile.email) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                <td style={{ ...td, color: c.due_date && !c.completed && c.due_date < todayStr() ? '#ef4444' : 'var(--color-text)' }}>{c.due_date || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type ViewMode = 'kanban' | 'compact' | 'list' | 'overview' | 'timeline'

const VALID_VIEWS: ViewMode[] = ['kanban', 'compact', 'list', 'overview', 'timeline']

export default function ProjectsPanel({ isMobile = false }: { isMobile?: boolean }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const { pages, sharedPages, setActivePage } = usePages()

  const [boards, setBoards] = useState<ProjectBoard[]>([])
  const [activeBoardId, setActiveBoardId] = useState<string | null>(() => localStorage.getItem(ACTIVE_BOARD_KEY))
  const [columns, setColumns] = useState<ProjectColumn[]>([])
  const [cards, setCards] = useState<ProjectCard[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [view, setView] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(VIEW_KEY)
    if (stored && VALID_VIEWS.includes(stored as ViewMode)) return stored as ViewMode
    return 'kanban'
  })
  const [loading, setLoading] = useState(true)
  const [boardLoading, setBoardLoading] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [cardSaveStatus, setCardSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [cardSaveErrorKind, setCardSaveErrorKind] = useState<'upload' | 'general'>('general')
  const [persistError, setPersistError] = useState<string | null>(null)
  const [cardFilters, setCardFilters] = useState<ProjectCardFilters>(defaultCardFilters)

  const boardsRef = useRef(boards)
  boardsRef.current = boards
  const cardModalOpenRef = useRef(false)
  const modalRestoredRef = useRef(false)
  const cardSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragSourceColumnRef = useRef<string | null>(null)
  const userId = user?.id

  // Modals
  const [boardModal, setBoardModal] = useState<{ open: boolean; board?: ProjectBoard | null }>({ open: false })
  const [boardSelectorOpen, setBoardSelectorOpen] = useState(false)
  const [cardModal, setCardModal] = useState<{ open: boolean; card?: ProjectCard | null; columnId?: string }>({ open: false })
  const [columnModal, setColumnModal] = useState<{ open: boolean; column?: ProjectColumn | null }>({ open: false })
  const [shareOpen, setShareOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const activeBoard = boards.find(b => b.id === activeBoardId) ?? null
  const canEdit = !!activeBoard && (activeBoard.user_id === user?.id || activeBoard.share_role === 'editor' || activeBoard.share_role === 'owner')
  const isOwner = !!activeBoard && activeBoard.user_id === user?.id

  // MouseSensor ignora eventos de toque — no touch, só o long-press do TouchSensor
  // inicia o drag; deslizar o dedo continua sendo scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}` as 'projects_priority_low')

  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])

  const loadBoards = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: own }, { data: shared }] = await Promise.all([
      supabase.from('project_boards').select('*').eq('user_id', user.id).order('sort_order', { ascending: true }),
      supabase.from('project_shares').select('role, project_boards(*)').eq('shared_with_user_id', user.id),
    ])
    const ownBoards: ProjectBoard[] = (own as ProjectBoard[] ?? []).map(b => ({ ...b, share_role: 'owner' as const }))
    const sharedBoards: ProjectBoard[] = []
    if (shared) {
      for (const row of shared) {
        const raw = (row as unknown as { project_boards: ProjectBoard | ProjectBoard[] }).project_boards
        const b = Array.isArray(raw) ? raw[0] : raw
        if (b) sharedBoards.push({ ...b, share_role: (row as { role: ProjectShareRole }).role, is_shared: true })
      }
    }
    const all = [...ownBoards, ...sharedBoards]
    setBoards(all)
    setActiveBoardId(prev => {
      if (prev && all.some(b => b.id === prev)) return prev
      return all[0]?.id ?? null
    })
    setLoading(false)
  }, [user])

  useEffect(() => { loadBoards() }, [loadBoards])
  useEffect(() => { if (activeBoardId) localStorage.setItem(ACTIVE_BOARD_KEY, activeBoardId) }, [activeBoardId])

  useEffect(() => {
    if (activeBoardId) setCardFilters(loadCardFilters(activeBoardId))
    else setCardFilters(defaultCardFilters())
  }, [activeBoardId])

  useEffect(() => {
    if (activeBoardId) saveCardFilters(activeBoardId, cardFilters)
  }, [activeBoardId, cardFilters])

  useEffect(() => { cardModalOpenRef.current = cardModal.open }, [cardModal.open])

  const loadBoardData = useCallback(async (boardId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? cardModalOpenRef.current
    if (!silent) setBoardLoading(true)
    try {
      const [{ data: cols }, { data: cds }] = await Promise.all([
        supabase.from('project_columns').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }),
        supabase.from('project_cards').select('*, assignee:profiles!project_cards_assignee_user_id_fkey(email, display_name, avatar_emoji, avatar_color, avatar_url)').eq('board_id', boardId).order('sort_order', { ascending: true }),
      ])
      setColumns((cols as ProjectColumn[]) ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCards(((cds as any[]) ?? []).map((r: any) => ({
        ...r,
        labels: r.labels ?? [],
        checklist: r.checklist ?? [],
        links: r.links ?? [],
        attachments: r.attachments ?? [],
        assignee_profile: Array.isArray(r.assignee) ? r.assignee[0] : r.assignee,
      })))

      const board = boardsRef.current.find(b => b.id === boardId)
      const memberIds = new Set<string>([userId ?? ''])
      if (board) memberIds.add(board.user_id)
      const { data: sh } = await supabase.from('project_shares').select('shared_with_user_id').eq('board_id', boardId)
      if (sh) sh.forEach((s: { shared_with_user_id: string }) => memberIds.add(s.shared_with_user_id))
      const { data: profs } = await supabase.from('profiles').select('id, email, display_name, avatar_emoji, avatar_color, avatar_url').in('id', [...memberIds])
      setMembers((profs as Member[]) ?? [])
    } finally {
      if (!silent) setBoardLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (activeBoardId && boards.length) loadBoardData(activeBoardId)
    else { setColumns([]); setCards([]) }
  }, [activeBoardId, boards.length, loadBoardData])

  useEffect(() => {
    if (modalRestoredRef.current || boardLoading || !activeBoardId || cardModal.open) return
    const openCardId = localStorage.getItem(OPEN_CARD_KEY)
    if (openCardId) {
      // Consume unconditionally: if the card was deleted or access was revoked
      // (RLS filters it out of `cards`), the key must not linger.
      localStorage.removeItem(OPEN_CARD_KEY)
      const requested = cards.find(c => c.id === openCardId)
      if (requested) {
        modalRestoredRef.current = true
        setCardModal({ open: true, card: requested })
        return
      }
    }
    const saved = loadCardModalState()
    if (!saved?.open || saved.boardId !== activeBoardId) return
    modalRestoredRef.current = true
    const card = saved.cardId ? cards.find(c => c.id === saved.cardId) ?? null : null
    if (saved.cardId && !card) return
    setCardModal({ open: true, card, columnId: saved.columnId })
  }, [activeBoardId, boardLoading, cards])

  useEffect(() => {
    if (cardModal.open && activeBoardId) {
      saveCardModalState({
        open: true,
        boardId: activeBoardId,
        cardId: cardModal.card?.id ?? null,
        columnId: cardModal.columnId,
      })
    } else if (!cardModal.open) {
      clearCardModalState()
    }
  }, [cardModal.open, cardModal.card?.id, cardModal.columnId, activeBoardId])

  const filteredCards = useMemo(() => filterProjectCards(cards, cardFilters), [cards, cardFilters])
  const availableLabels = useMemo(() => collectBoardLabels(cards), [cards])
  const filtersActive = hasActiveFilters(cardFilters)

  const cardsByColumn = useMemo(() => {
    const map: Record<string, ProjectCard[]> = {}
    columns.forEach(c => { map[c.id] = [] })
    filteredCards.forEach(c => { (map[c.column_id] ??= []).push(c) })
    Object.values(map).forEach(list => list.sort(byOrder))
    return map
  }, [columns, filteredCards])

  // ── CRUD ──
  const createBoard = async (data: { name: string; icon: string; color: string; description: string }) => {
    const { data: id } = await supabase.rpc('create_project_board', { p_name: data.name, p_icon: data.icon, p_color: data.color, p_description: data.description })
    setBoardModal({ open: false })
    await loadBoards()
    if (typeof id === 'string') setActiveBoardId(id)
  }
  const updateBoard = async (data: { name: string; icon: string; color: string; description: string }) => {
    if (!boardModal.board) return
    await supabase.from('project_boards').update({ ...data, updated_at: new Date().toISOString() }).eq('id', boardModal.board.id)
    setBoardModal({ open: false })
    await loadBoards()
  }
  const deleteBoard = async () => {
    if (!activeBoard || !isOwner) return
    setDeleteConfirm({
      message: t('projects_delete_board_confirm'),
      onConfirm: async () => {
        await supabase.from('project_boards').delete().eq('id', activeBoard.id)
        setActiveBoardId(null)
        await loadBoards()
        setDeleteConfirm(null)
      },
    })
  }

  const saveColumn = async (data: { name: string; color: string; wip_limit: number | null }) => {
    if (!activeBoardId) return
    if (columnModal.column) {
      await supabase.from('project_columns').update(data).eq('id', columnModal.column.id)
    } else {
      const order = columns.length ? Math.max(...columns.map(c => c.sort_order)) + 1 : 0
      await supabase.from('project_columns').insert({ board_id: activeBoardId, ...data, sort_order: order })
    }
    setColumnModal({ open: false })
    await loadBoardData(activeBoardId)
  }
  const deleteColumn = async (col: ProjectColumn) => {
    setDeleteConfirm({
      message: t('projects_delete_column_confirm'),
      onConfirm: async () => {
        await supabase.from('project_columns').delete().eq('id', col.id)
        if (activeBoardId) await loadBoardData(activeBoardId)
        setDeleteConfirm(null)
      },
    })
  }

  const closeCardModal = useCallback(() => {
    if (activeBoardId) {
      clearCardDraft(getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId))
    }
    clearCardModalState()
    setCardModal({ open: false })
    setCardSaveStatus('idle')
    setCardSaveErrorKind('general')
  }, [activeBoardId, cardModal.card?.id, cardModal.columnId])

  const handleDraftChange = useCallback((form: CardForm, removedAttachmentIds: string[]) => {
    if (!activeBoardId) return
    saveCardDraft(getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId), {
      form,
      savedAt: new Date().toISOString(),
      removedAttachmentIds,
    })
  }, [activeBoardId, cardModal.card?.id, cardModal.columnId])

  const cardDraftKey = activeBoardId
    ? getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId)
    : null

  const autoSaveCard = async (formSnapshot: CardForm, extras: CardSaveExtras = { pendingFiles: [], removedAttachmentIds: [] }): Promise<AutoSaveResult | null> => {
    if (!activeBoardId || !userId || !canEdit) return null

    const hasPending = extras.pendingFiles.length > 0
    const hasRemovals = extras.removedAttachmentIds.length > 0
    if (!cardModal.card && !formSnapshot.title.trim() && !hasPending && !hasRemovals) {
      setCardSaveStatus('idle')
      return null
    }
    if (!cardModal.card && !formSnapshot.title.trim()) {
      setCardSaveStatus('idle')
      return null
    }

    setCardSaveStatus('saving')
    setCardSaveErrorKind('general')
    const updatedAt = new Date().toISOString()

    let cardId = cardModal.card?.id
    let attachments = (formSnapshot.attachments ?? []).filter(a => !extras.removedAttachmentIds.includes(a.id))
    let uploadedPendingIds: string[] = []

    if (!cardId) {
      const colId = cardModal.columnId ?? columns[0]?.id
      if (!colId) {
        setCardSaveStatus('error')
        return null
      }
      const order = (cardsByColumn[colId]?.length ?? 0)
      const insertPayload = {
        board_id: activeBoardId,
        column_id: colId,
        sort_order: order,
        title: formSnapshot.title.trim(),
        description: formSnapshot.description,
        priority: formSnapshot.priority,
        start_date: formSnapshot.start_date || null,
        due_date: formSnapshot.due_date || null,
        assignee_user_id: formSnapshot.assignee_user_id,
        labels: formSnapshot.labels,
        linked_page_id: formSnapshot.linked_page_id,
        parent_card_id: formSnapshot.parent_card_id,
        depends_on: formSnapshot.depends_on,
        completed: formSnapshot.completed,
        checklist: formSnapshot.checklist,
        links: formSnapshot.links,
        attachments,
        updated_at: updatedAt,
      }
      const { data: inserted, error } = await supabase
        .from('project_cards')
        .insert(insertPayload)
        .select('*')
        .single()
      if (error || !inserted) {
        setCardSaveStatus('error')
        return null
      }
      cardId = inserted.id
      const newCard: ProjectCard = {
        ...(inserted as ProjectCard),
        labels: (inserted as ProjectCard).labels ?? [],
        checklist: (inserted as ProjectCard).checklist ?? formSnapshot.checklist,
        attachments: (inserted as ProjectCard).attachments ?? attachments,
      }
      setCards(prev => [...prev, newCard])
      setCardModal(prev => ({ ...prev, card: newCard }))
      if (cardDraftKey) {
        clearCardDraft(cardDraftKey)
        saveCardDraft(getDraftKey(activeBoardId, newCard.id, colId), {
          form: { ...formSnapshot, attachments },
          savedAt: updatedAt,
          removedAttachmentIds: [],
        })
      }
    }

    if (!cardId) {
      setCardSaveStatus('error')
      return null
    }

    try {
      const attachmentResult = await persistCardAttachments(userId, activeBoardId, cardId, formSnapshot, extras)
      attachments = attachmentResult.attachments
      uploadedPendingIds = attachmentResult.uploadedPendingIds
    } catch {
      setCardSaveErrorKind('upload')
      setCardSaveStatus('error')
      return null
    }

    const payload = {
      title: formSnapshot.title.trim(),
      description: formSnapshot.description,
      priority: formSnapshot.priority,
      start_date: formSnapshot.start_date || null,
      due_date: formSnapshot.due_date || null,
      assignee_user_id: formSnapshot.assignee_user_id,
      labels: formSnapshot.labels,
      linked_page_id: formSnapshot.linked_page_id,
      parent_card_id: formSnapshot.parent_card_id,
      depends_on: formSnapshot.depends_on,
      completed: formSnapshot.completed,
      checklist: formSnapshot.checklist,
      links: formSnapshot.links,
      attachments,
      updated_at: updatedAt,
    }

    const { error } = await supabase.from('project_cards').update(payload).eq('id', cardId)
    if (error) {
      setCardSaveStatus('error')
      return null
    }

    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...payload } : c))
    setCardSaveStatus('saved')
    if (cardSaveStatusTimerRef.current) clearTimeout(cardSaveStatusTimerRef.current)
    cardSaveStatusTimerRef.current = setTimeout(() => setCardSaveStatus('idle'), 2000)
    return { attachments, uploadedPendingIds }
  }

  const saveCard = async (f: CardForm, extras: CardSaveExtras = { pendingFiles: [], removedAttachmentIds: [] }) => {
    if (!activeBoardId || !userId) return

    setCardSaveStatus('saving')
    setCardSaveErrorKind('general')
    const updatedAt = new Date().toISOString()
    const basePayload = {
      title: f.title.trim(), description: f.description, priority: f.priority,
      start_date: f.start_date || null, due_date: f.due_date || null, assignee_user_id: f.assignee_user_id, labels: f.labels,
      linked_page_id: f.linked_page_id, parent_card_id: f.parent_card_id, depends_on: f.depends_on,
      completed: f.completed, checklist: f.checklist, links: f.links,
    }

    let cardId = cardModal.card?.id

    if (!cardId) {
      const colId = cardModal.columnId ?? columns[0]?.id
      if (!colId) return
      const order = (cardsByColumn[colId]?.length ?? 0)
      const { data: inserted, error } = await supabase
        .from('project_cards')
        .insert({ board_id: activeBoardId, column_id: colId, sort_order: order, attachments: [], ...basePayload, updated_at: updatedAt })
        .select('id')
        .single()
      if (error || !inserted) {
        setCardSaveStatus('error')
        return
      }
      cardId = inserted.id
    }

    if (!cardId) {
      setCardSaveStatus('error')
      return
    }

    let attachments: ProjectCardAttachment[]
    try {
      ({ attachments } = await persistCardAttachments(userId, activeBoardId, cardId, f, extras))
    } catch {
      setCardSaveErrorKind('upload')
      setCardSaveStatus('error')
      return
    }

    const { error } = await supabase.from('project_cards').update({ ...basePayload, attachments, updated_at: updatedAt }).eq('id', cardId)
    if (error) {
      setCardSaveStatus('error')
      return
    }

    if (cardDraftKey) clearCardDraft(cardDraftKey)
    clearCardModalState()
    setCardModal({ open: false })
    setCardSaveStatus('idle')
    await loadBoardData(activeBoardId, { silent: true })
  }
  const deleteCard = async () => {
    if (!cardModal.card || !activeBoardId) return
    const cardId = cardModal.card.id
    setDeleteConfirm({
      message: t('projects_delete_card_confirm'),
      onConfirm: async () => {
        await supabase.from('project_cards').delete().eq('id', cardId)
        if (cardDraftKey) clearCardDraft(cardDraftKey)
        clearCardModalState()
        setCardModal({ open: false })
        await loadBoardData(activeBoardId)
        setDeleteConfirm(null)
      },
    })
  }

  const openLinkedPage = (pageId: string) => {
    const all = [...flattenPages(pages), ...flattenPages(sharedPages)]
    const page = all.find(p => p.id === pageId)
    if (page) setActivePage(page)
  }

  const handleRescheduleCard = async (
    cardId: string,
    dates: { start_date: string | null; due_date: string | null },
  ) => {
    if (!activeBoardId) return
    const updated_at = new Date().toISOString()
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, ...dates, updated_at } : c)))
    const { error } = await supabase.from('project_cards').update({ ...dates, updated_at }).eq('id', cardId)
    if (error) {
      setPersistError(t('projects_persist_error'))
      await loadBoardData(activeBoardId, { silent: true })
    }
  }

  // ── Drag & drop ──
  const persist = async (list: ProjectCard[]) => {
    const results = await Promise.all(
      list.map(c => supabase.from('project_cards').update({ column_id: c.column_id, sort_order: c.sort_order }).eq('id', c.id)),
    )
    if (results.some(r => r.error)) {
      setPersistError(t('projects_persist_error'))
      if (activeBoardId) await loadBoardData(activeBoardId, { silent: true })
      return false
    }
    setPersistError(null)
    return true
  }

  const persistColumns = async (list: ProjectColumn[]) => {
    const results = await Promise.all(
      list.map(c => supabase.from('project_columns').update({ sort_order: c.sort_order }).eq('id', c.id)),
    )
    if (results.some(r => r.error)) {
      setPersistError(t('projects_persist_error'))
      if (activeBoardId) await loadBoardData(activeBoardId, { silent: true })
      return false
    }
    setPersistError(null)
    return true
  }

  // Reorder a column by one slot (used by the compact/mobile view, which has no drag).
  const moveColumnByOffset = async (colId: string, dir: -1 | 1) => {
    const idx = columns.findIndex(c => c.id === colId)
    const target = idx + dir
    if (idx === -1 || target < 0 || target >= columns.length) return
    const reordered = arrayMove(columns, idx, target).map((c, i) => ({ ...c, sort_order: i }))
    setColumns(reordered)
    await persistColumns(reordered)
  }

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setActiveDragId(id)
    dragSourceColumnRef.current = cards.find(c => c.id === id)?.column_id ?? null
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (active.data.current?.type === 'column') return
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    // Só refletir movimentos ENTRE colunas durante o drag-over.
    // Reordenação na mesma coluna é feita visualmente pela sortable
    // strategy e commitada em onDragEnd — mutar o estado aqui causa
    // um loop de medição/re-render ("Maximum update depth exceeded").
    setCards(prev => {
      const activeCard = prev.find(c => c.id === activeId)
      if (!activeCard) return prev
      const overCol = resolveColumnId(overId, prev)
      if (!overCol || overCol === activeCard.column_id) return prev
      return applyCardMove(prev, activeId, overId) ?? prev
    })
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const activeId = String(active.id)

    if (active.data.current?.type === 'column') {
      setActiveDragId(null)
      if (!over) return
      const overRaw = String(over.id)
      const overColId = overRaw.startsWith('col:') ? overRaw.slice(4) : overRaw
      const oldIndex = columns.findIndex(c => c.id === activeId)
      const newIndex = columns.findIndex(c => c.id === overColId)
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
      const reordered = arrayMove(columns, oldIndex, newIndex).map((c, i) => ({ ...c, sort_order: i }))
      setColumns(reordered)
      await persistColumns(reordered)
      return
    }

    const sourceCol = dragSourceColumnRef.current

    setActiveDragId(null)

    let next = cards
    setCards(prev => {
      if (over) {
        next = applyCardMove(prev, activeId, String(over.id)) ?? prev
      } else {
        next = prev
      }
      return next
    })

    try {
      if (!sourceCol) return

      const destCol = next.find(c => c.id === activeId)?.column_id
      const overCol = over ? resolveColumnId(String(over.id), next) : null
      const affectedCols = new Set(
        [sourceCol, destCol, overCol].filter((c): c is string => !!c),
      )
      const toPersist = next.filter(c => affectedCols.has(c.column_id))
      if (toPersist.length > 0) await persist(toPersist)
    } finally {
      dragSourceColumnRef.current = null
    }
  }

  const handleMoveCardToColumn = async (cardId: string, targetColumnId: string) => {
    const sourceCol = cards.find(c => c.id === cardId)?.column_id
    const next = moveCardToColumn(cards, cardId, targetColumnId)
    if (!next) return
    setCards(next)
    const affectedCols = new Set([sourceCol, targetColumnId].filter((c): c is string => !!c))
    const toPersist = next.filter(c => affectedCols.has(c.column_id))
    if (toPersist.length > 0) await persist(toPersist)
  }

  // ── Render ──
  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('projects_loading')}</div>
  }

  const activeDragCard = activeDragId ? cards.find(c => c.id === activeDragId) : null
  const activeDragColumn = activeDragId ? columns.find(c => c.id === activeDragId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '12px 14px' : '14px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Board selector */}
          {boards.length > 0 ? (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setBoardSelectorOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--color-text)', maxWidth: 260 }}>
                <span>{activeBoard?.icon}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeBoard?.name ?? t('projects_select_board')}</span>
                {activeBoard?.is_shared && <span style={{ fontSize: 9, fontWeight: 700, color: '#6366f1', backgroundColor: '#6366f11f', padding: '1px 5px', borderRadius: 4 }}>{t('projects_shared_badge')}</span>}
                <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
              </button>
              {boardSelectorOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, minWidth: 240, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', padding: 4, maxHeight: 320, overflowY: 'auto' }}>
                  {boards.map(b => (
                    <button key={b.id} onClick={() => { setActiveBoardId(b.id); setBoardSelectorOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', backgroundColor: b.id === activeBoardId ? 'var(--color-active)' : 'transparent', color: 'var(--color-text)', fontSize: 13, textAlign: 'left' }}>
                      <span>{b.icon}</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                      {b.is_shared && <Share2 size={11} style={{ color: 'var(--color-text-muted)' }} />}
                    </button>
                  ))}
                  <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 4 }}>
                    <button onClick={() => { setBoardModal({ open: true, board: null }); setBoardSelectorOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'transparent', color: '#6366f1', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>
                      <Plus size={13} />{t('projects_new_board')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('projects_title')}</h2>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeBoard && (
              <div style={{ display: 'flex', borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {([['kanban', LayoutGrid], ['timeline', GanttChartSquare], ['list', ListIcon], ['overview', BarChart3], ['compact', Smartphone]] as const).map(([v, Icon]) => (
                  <button key={v} onClick={() => setView(v)} title={t(`projects_view_${v}` as 'projects_view_kanban')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? '6px 8px' : '6px 11px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: view === v ? 600 : 400, backgroundColor: view === v ? '#6366f1' : 'var(--color-bg)', color: view === v ? '#fff' : 'var(--color-text-muted)' }}>
                    <Icon size={13} />{!isMobile && t(`projects_view_${v}` as 'projects_view_kanban')}
                  </button>
                ))}
              </div>
            )}
            {activeBoard && isOwner && (
              <>
                <button onClick={() => setImportOpen(true)} title={t('projects_import')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? 8 : '6px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <Upload size={13} />{!isMobile && t('projects_import')}
                </button>
                <button onClick={() => setShareOpen(true)} title={t('projects_share')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? 8 : '6px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <Share2 size={13} />{!isMobile && t('projects_share')}
                </button>
                <button onClick={() => setBoardModal({ open: true, board: activeBoard })} title={t('projects_edit')} style={{ display: 'flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                  <Pencil size={13} />
                </button>
                <button onClick={deleteBoard} title={t('projects_delete')} style={{ display: 'flex', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>
        {!canEdit && activeBoard && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {t('projects_readonly')}
          </div>
        )}
      </div>

      {activeBoard && boards.length > 0 && !boardLoading && (
        <CardFilterBar
          filters={cardFilters}
          onChange={setCardFilters}
          columns={columns}
          members={members}
          availableLabels={availableLabels}
          isMobile={isMobile}
        />
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {boards.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FolderKanban size={28} color="#6366f1" /></div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{t('projects_no_boards_title')}</h3>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-muted)', maxWidth: 360 }}>{t('projects_no_boards_desc')}</p>
            <PrimaryBtn onClick={() => setBoardModal({ open: true, board: null })}>{t('projects_create_board')}</PrimaryBtn>
          </div>
        ) : boardLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('projects_loading')}</div>
        ) : filtersActive && filteredCards.length === 0 && cards.length > 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>{t('projects_empty_filter')}</p>
          </div>
        ) : view === 'kanban' ? (
          <>
            {persistError && (
              <div style={{ margin: '0 16px', padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 12.5, fontWeight: 600 }}>
                {persistError}
              </div>
            )}
          <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <div style={{ flex: 1, display: 'flex', gap: 12, padding: 16, overflowX: 'auto', overflowY: 'hidden', alignItems: 'stretch' }}>
              <SortableContext items={columns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                {columns.map(col => (
                  <SortableColumn
                    key={col.id} column={col} cards={cardsByColumn[col.id] ?? []} canEdit={canEdit} priorityLabel={pLabel}
                    onAddCard={() => setCardModal({ open: true, card: null, columnId: col.id })}
                    onCardClick={(c) => setCardModal({ open: true, card: c })}
                    onRename={() => setColumnModal({ open: true, column: col })}
                    onDelete={() => deleteColumn(col)}
                  />
                ))}
              </SortableContext>
              {canEdit && (
                <button onClick={() => setColumnModal({ open: true, column: null })} style={{ width: 200, minWidth: 200, height: 'fit-content', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}>
                  <Plus size={14} />{t('projects_add_column')}
                </button>
              )}
            </div>
            <DragOverlay>
              {activeDragColumn ? (
                <div style={{ width: 290, opacity: 0.9, cursor: 'grabbing' }}>
                  <Column
                    column={activeDragColumn} cards={cardsByColumn[activeDragColumn.id] ?? []} canEdit={false} priorityLabel={pLabel}
                    onAddCard={() => {}} onCardClick={() => {}} onRename={() => {}} onDelete={() => {}}
                  />
                </div>
              ) : activeDragCard ? <div style={{ width: 274 }}><CardView card={activeDragCard} priorityLabel={pLabel(activeDragCard.priority)} dragging /></div> : null}
            </DragOverlay>
          </DndContext>
          </>
        ) : view === 'compact' ? (
          <CompactKanbanView
            boardId={activeBoardId!}
            columns={columns}
            cardsByColumn={cardsByColumn}
            canEdit={canEdit}
            priorityLabel={pLabel}
            sensors={sensors}
            persistError={persistError}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            activeDragCard={activeDragCard}
            pLabel={pLabel}
            onAddCard={(columnId) => setCardModal({ open: true, card: null, columnId })}
            onCardClick={(c) => setCardModal({ open: true, card: c })}
            onRename={(col) => setColumnModal({ open: true, column: col })}
            onDelete={deleteColumn}
            onMoveCardToColumn={handleMoveCardToColumn}
            onReorderColumn={canEdit ? moveColumnByOffset : undefined}
          />
        ) : view === 'timeline' ? (
          <GanttView
            columns={columns}
            cards={filteredCards}
            canEdit={canEdit}
            isMobile={isMobile}
            priorityLabel={pLabel}
            boardId={activeBoardId!}
            onCardClick={(c) => setCardModal({ open: true, card: c })}
            onAddCard={(columnId) => setCardModal({ open: true, card: null, columnId })}
            onCardReschedule={canEdit ? handleRescheduleCard : undefined}
          />
        ) : view === 'list' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <ListView columns={columns} cards={filteredCards} totalCount={cards.length} onCardClick={(c) => setCardModal({ open: true, card: c })} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <OverviewView columns={columns} cards={filteredCards} members={members} />
          </div>
        )}
      </div>

      {/* Modals */}
      {boardModal.open && (
        <BoardModal board={boardModal.board ?? null} onClose={() => setBoardModal({ open: false })} onSave={boardModal.board ? updateBoard : createBoard} />
      )}
      {columnModal.open && (
        <ColumnModal column={columnModal.column ?? null} onClose={() => setColumnModal({ open: false })} onSave={saveColumn} />
      )}
      {cardModal.open && activeBoardId && (
        <CardModal
          card={cardModal.card ?? null}
          boardId={activeBoardId}
          columnId={cardModal.columnId}
          members={members}
          allCards={cards}
          canEdit={canEdit}
          isMobile={isMobile}
          initialDraft={cardDraftKey ? loadCardDraft(cardDraftKey) : null}
          saveStatus={cardSaveStatus}
          saveErrorKind={cardSaveErrorKind}
          onClose={closeCardModal}
          onSave={saveCard}
          onAutoSave={autoSaveCard}
          onDraftChange={handleDraftChange}
          onDelete={cardModal.card ? deleteCard : undefined}
          onOpenPage={openLinkedPage}
        />
      )}
      {shareOpen && activeBoard && <ShareModal board={activeBoard} onClose={() => setShareOpen(false)} />}
      {importOpen && activeBoardId && columns[0] && (
        <ImportCardsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          boardId={activeBoardId}
          columnId={columns[0].id}
          columnName={columns[0].name}
          isMobile={isMobile}
          onImported={() => loadBoardData(activeBoardId, { silent: true })}
        />
      )}
      <ConfirmDeleteModal
        open={!!deleteConfirm}
        title={t('projects_delete')}
        message={deleteConfirm?.message}
        onConfirm={deleteConfirm?.onConfirm ?? (() => {})}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Plus, X, Trash2, Pencil, Share2, FolderKanban, LayoutGrid, List as ListIcon,
  BarChart3, ChevronDown, Link2, ExternalLink, Search, Calendar,
} from 'lucide-react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners, useDroppable,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ProjectBoard, ProjectColumn, ProjectCard, ProjectShare, ProjectCardPriority, ProjectShareRole, Page } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { usePages } from '../contexts/PagesContext'
import ConfirmDeleteModal from './ConfirmDeleteModal'

// ─── Constants & helpers ──────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<ProjectCardPriority, string> = {
  low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
}
const BOARD_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']
const BOARD_ICONS = ['📋', '🚀', '🎯', '💡', '🛠️', '📦', '🎨', '🧩', '📈', '🏗️', '🔥', '⭐']
const ACTIVE_BOARD_KEY = 'projects_active_board'
const VIEW_KEY = 'projects_view'

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

function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
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

function initials(name: string) { return (name || '?').trim()[0]?.toUpperCase() ?? '?' }
function avatarColor(seed: string) {
  const colors = ['#4f6ef7', '#e96c6c', '#43c59e', '#f0a500', '#9b59b6', '#06b6d4']
  const code = (seed.charCodeAt(0) || 0) + (seed.charCodeAt(seed.length - 1) || 0)
  return colors[code % colors.length]
}

interface Member { id: string; email: string; display_name: string | null }

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
        {card.linked_page_id && <Link2 size={12} style={{ color: '#6366f1' }} />}
        {card.assignee_profile && (
          <span title={card.assignee_profile.display_name || card.assignee_profile.email} style={{ marginLeft: 'auto', width: 20, height: 20, borderRadius: '50%', backgroundColor: avatarColor(card.assignee_profile.email), color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {initials(card.assignee_profile.display_name || card.assignee_profile.email)}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Sortable card ────────────────────────────────────────────────────────────

function SortableCard({ card, priorityLabel, canEdit, onClick }: { card: ProjectCard; priorityLabel: string; canEdit: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canEdit })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(canEdit ? listeners : {})}>
      <CardView card={card} priorityLabel={priorityLabel} onClick={onClick} />
    </div>
  )
}

// ─── Column ───────────────────────────────────────────────────────────────────

function Column({ column, cards, canEdit, priorityLabel, onAddCard, onCardClick, onRename, onDelete }: {
  column: ProjectColumn; cards: ProjectCard[]; canEdit: boolean; priorityLabel: (p: ProjectCardPriority) => string;
  onAddCard: () => void; onCardClick: (c: ProjectCard) => void; onRename: () => void; onDelete: () => void;
}) {
  const { t } = useLanguage()
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const overLimit = column.wip_limit != null && cards.length > column.wip_limit
  return (
    <div style={{ width: 290, minWidth: 290, display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: column.color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: overLimit ? '#ef4444' : 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)', borderRadius: 999, padding: '1px 7px' }}>
          {cards.length}{column.wip_limit != null ? `/${column.wip_limit}` : ''}
        </span>
        {canEdit && (
          <>
            <button onClick={onRename} title={t('projects_rename_column')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><Pencil size={12} /></button>
            <button onClick={onDelete} title={t('projects_delete_column')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><Trash2 size={12} /></button>
          </>
        )}
      </div>
      <div ref={setNodeRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: 10, backgroundColor: isOver ? 'var(--color-hover)' : 'var(--color-bg-secondary)', minHeight: 60, transition: 'background-color 0.12s' }}>
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px 0' }}>{t('projects_empty_column')}</div>
            : cards.map(c => <SortableCard key={c.id} card={c} priorityLabel={priorityLabel(c.priority)} canEdit={canEdit} onClick={() => onCardClick(c)} />)
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

interface CardForm { title: string; description: string; priority: ProjectCardPriority; due_date: string; assignee_user_id: string | null; labels: string[]; linked_page_id: string | null; completed: boolean }

function CardModal({ card, members, canEdit, onClose, onSave, onDelete, onOpenPage }: {
  card: ProjectCard | null; members: Member[]; canEdit: boolean;
  onClose: () => void; onSave: (f: CardForm) => void; onDelete?: () => void; onOpenPage: (id: string) => void;
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState<CardForm>({
    title: card?.title ?? '', description: card?.description ?? '', priority: card?.priority ?? 'medium',
    due_date: card?.due_date ?? '', assignee_user_id: card?.assignee_user_id ?? null,
    labels: card?.labels ?? [], linked_page_id: card?.linked_page_id ?? null, completed: card?.completed ?? false,
  })
  const [labelInput, setLabelInput] = useState('')
  const priorities: ProjectCardPriority[] = ['low', 'medium', 'high', 'urgent']
  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}` as 'projects_priority_low')

  const addLabel = () => {
    const v = labelInput.trim()
    if (v && !form.labels.includes(v)) setForm(f => ({ ...f, labels: [...f.labels, v] }))
    setLabelInput('')
  }

  return (
    <Modal title={card ? t('projects_edit_card') : t('projects_new_card')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_card_title')}</label>
          <input disabled={!canEdit} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={t('projects_card_title_placeholder')} style={inputStyle} autoFocus />
        </div>
        <div>
          <label style={labelStyle}>{t('projects_card_description')}</label>
          <textarea disabled={!canEdit} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div>
          <label style={labelStyle}>{t('projects_priority')}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {priorities.map(p => (
              <button key={p} disabled={!canEdit} onClick={() => setForm(f => ({ ...f, priority: p }))}
                style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: '1.5px solid', borderColor: form.priority === p ? PRIORITY_COLORS[p] : 'var(--color-border)', backgroundColor: form.priority === p ? `${PRIORITY_COLORS[p]}1f` : 'var(--color-bg)', color: form.priority === p ? PRIORITY_COLORS[p] : 'var(--color-text-muted)', fontSize: 12, fontWeight: form.priority === p ? 700 : 500, cursor: canEdit ? 'pointer' : 'default' }}>
                {pLabel(p)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('projects_due_date')}</label>
            <input disabled={!canEdit} type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('projects_assignee')}</label>
            <select disabled={!canEdit} value={form.assignee_user_id ?? ''} onChange={e => setForm(f => ({ ...f, assignee_user_id: e.target.value || null }))} style={inputStyle}>
              <option value="">{t('projects_unassigned')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_labels')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {form.labels.map((l, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text)', backgroundColor: 'var(--color-hover)', padding: '3px 8px', borderRadius: 6 }}>
                {l}{canEdit && <button onClick={() => setForm(f => ({ ...f, labels: f.labels.filter((_, j) => j !== i) }))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0 }}><X size={11} /></button>}
              </span>
            ))}
          </div>
          {canEdit && <input value={labelInput} onChange={e => setLabelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }} placeholder={t('projects_labels_placeholder')} style={inputStyle} />}
        </div>
        <div>
          <label style={labelStyle}>{t('projects_linked_page')}</label>
          <PagePicker value={form.linked_page_id} onChange={(id) => setForm(f => ({ ...f, linked_page_id: id }))} />
          {form.linked_page_id && (
            <button onClick={() => onOpenPage(form.linked_page_id!)} style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#6366f1', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              <ExternalLink size={13} />{t('projects_open_page')}
            </button>
          )}
        </div>
        {canEdit && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.completed} onChange={e => setForm(f => ({ ...f, completed: e.target.checked }))} />
            {t('projects_overview_completed')}
          </label>
        )}
        {canEdit && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            {onDelete ? <button onClick={onDelete} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}><Trash2 size={14} />{t('projects_delete')}</button> : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
              <PrimaryBtn onClick={() => onSave(form)} disabled={!form.title.trim()}>{t('projects_save')}</PrimaryBtn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Board modal ────────────────────────────────────────────────────────────

function BoardModal({ board, onClose, onSave }: { board: ProjectBoard | null; onClose: () => void; onSave: (data: { name: string; icon: string; color: string; description: string }) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(board?.name ?? '')
  const [icon, setIcon] = useState(board?.icon ?? '📋')
  const [color, setColor] = useState(board?.color ?? '#6366f1')
  const [description, setDescription] = useState(board?.description ?? '')
  return (
    <Modal title={board ? t('projects_edit_board') : t('projects_create_board')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_board_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('projects_board_name_placeholder')} style={inputStyle} autoFocus />
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
  const [name, setName] = useState(column?.name ?? '')
  const [color, setColor] = useState(column?.color ?? '#94a3b8')
  const [wip, setWip] = useState<string>(column?.wip_limit != null ? String(column.wip_limit) : '')
  return (
    <Modal title={column ? t('projects_rename_column') : t('projects_add_column')} onClose={onClose} width={380}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_column_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus />
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
      .select('*, profiles!project_shares_shared_with_user_id_fkey(email, display_name)')
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
      const exclude = new Set([user?.id, board.user_id, ...shares.map(s => s.shared_with_user_id)])
      const { data } = await supabase.from('profiles').select('id, email, display_name').or(`email.ilike.%${val}%,display_name.ilike.%${val}%`).limit(8)
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
              <span style={{ width: 26, height: 26, borderRadius: '50%', backgroundColor: avatarColor(m.email), color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(m.display_name || m.email)}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{m.display_name || m.email}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shares.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>{t('projects_share_none')}</p>}
        {shares.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: avatarColor(s.profile?.email ?? '?'), color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(s.profile?.display_name || s.profile?.email || '?')}</span>
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

function OverviewView({ columns, cards }: { columns: ProjectColumn[]; cards: ProjectCard[] }) {
  const { t } = useLanguage()
  const total = cards.length
  const completed = cards.filter(c => c.completed).length
  const overdue = cards.filter(c => c.due_date && !c.completed && c.due_date < todayStr()).length
  const pct = total ? Math.round((completed / total) * 100) : 0
  const priorities: ProjectCardPriority[] = ['urgent', 'high', 'medium', 'low']
  const stat = (label: string, value: number | string, color: string) => (
    <div style={{ flex: 1, minWidth: 130, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {stat(t('projects_overview_total_cards'), total, 'var(--color-text)')}
        {stat(t('projects_overview_completed'), completed, '#22c55e')}
        {stat(t('projects_overview_overdue'), overdue, '#ef4444')}
        {stat(t('projects_overview_progress'), `${pct}%`, '#6366f1')}
      </div>
      <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>{t('projects_overview_progress')}</div>
        <div style={{ height: 12, borderRadius: 999, backgroundColor: 'var(--color-hover)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#22c55e', transition: 'width 0.3s' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 14 }}>{t('projects_overview_by_column')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {columns.map(col => {
              const n = cards.filter(c => c.column_id === col.id).length
              const w = total ? (n / total) * 100 : 0
              return (
                <div key={col.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--color-text)' }}>{col.name}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)' }}>{n}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 999, backgroundColor: 'var(--color-hover)' }}><div style={{ width: `${w}%`, height: '100%', backgroundColor: col.color, borderRadius: 999 }} /></div>
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 14 }}>{t('projects_overview_by_priority')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {priorities.map(p => {
              const n = cards.filter(c => c.priority === p).length
              const w = total ? (n / total) * 100 : 0
              return (
                <div key={p}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--color-text)' }}>{t(`projects_priority_${p}` as 'projects_priority_low')}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)' }}>{n}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 999, backgroundColor: 'var(--color-hover)' }}><div style={{ width: `${w}%`, height: '100%', backgroundColor: PRIORITY_COLORS[p], borderRadius: 999 }} /></div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

function ListView({ columns, cards, onCardClick }: { columns: ProjectColumn[]; cards: ProjectCard[]; onCardClick: (c: ProjectCard) => void }) {
  const { t } = useLanguage()
  const [fCol, setFCol] = useState('')
  const [fPri, setFPri] = useState('')
  const colName = (id: string) => columns.find(c => c.id === id)?.name ?? '—'
  const filtered = cards
    .filter(c => (fCol ? c.column_id === fCol : true) && (fPri ? c.priority === fPri : true))
    .sort(byOrder)
  if (cards.length === 0) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('projects_no_cards')}</p>
  const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 12px' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: 'var(--color-text)', borderTop: '1px solid var(--color-border)' }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={fCol} onChange={e => setFCol(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">{t('projects_table_column')}: {t('projects_filter_all')}</option>
          {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={fPri} onChange={e => setFPri(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">{t('projects_priority')}: {t('projects_filter_all')}</option>
          {(['urgent', 'high', 'medium', 'low'] as ProjectCardPriority[]).map(p => <option key={p} value={p}>{t(`projects_priority_${p}` as 'projects_priority_low')}</option>)}
        </select>
      </div>
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
            {filtered.map(c => (
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

type ViewMode = 'kanban' | 'list' | 'overview'

export default function ProjectsPanel({ isMobile = false }: { isMobile?: boolean }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const { pages, sharedPages, setActivePage } = usePages()

  const [boards, setBoards] = useState<ProjectBoard[]>([])
  const [activeBoardId, setActiveBoardId] = useState<string | null>(() => localStorage.getItem(ACTIVE_BOARD_KEY))
  const [columns, setColumns] = useState<ProjectColumn[]>([])
  const [cards, setCards] = useState<ProjectCard[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'kanban')
  const [loading, setLoading] = useState(true)
  const [boardLoading, setBoardLoading] = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  // Modals
  const [boardModal, setBoardModal] = useState<{ open: boolean; board?: ProjectBoard | null }>({ open: false })
  const [boardSelectorOpen, setBoardSelectorOpen] = useState(false)
  const [cardModal, setCardModal] = useState<{ open: boolean; card?: ProjectCard | null; columnId?: string }>({ open: false })
  const [columnModal, setColumnModal] = useState<{ open: boolean; column?: ProjectColumn | null }>({ open: false })
  const [shareOpen, setShareOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const activeBoard = boards.find(b => b.id === activeBoardId) ?? null
  const canEdit = !!activeBoard && (activeBoard.user_id === user?.id || activeBoard.share_role === 'editor' || activeBoard.share_role === 'owner')
  const isOwner = !!activeBoard && activeBoard.user_id === user?.id

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
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

  const loadBoardData = useCallback(async (boardId: string) => {
    setBoardLoading(true)
    const [{ data: cols }, { data: cds }] = await Promise.all([
      supabase.from('project_columns').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }),
      supabase.from('project_cards').select('*, assignee:profiles!project_cards_assignee_user_id_fkey(email, display_name)').eq('board_id', boardId).order('sort_order', { ascending: true }),
    ])
    setColumns((cols as ProjectColumn[]) ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setCards(((cds as any[]) ?? []).map((r: any) => ({ ...r, labels: r.labels ?? [], assignee_profile: Array.isArray(r.assignee) ? r.assignee[0] : r.assignee })))

    const board = boards.find(b => b.id === boardId)
    const memberIds = new Set<string>([user?.id ?? ''])
    if (board) memberIds.add(board.user_id)
    const { data: sh } = await supabase.from('project_shares').select('shared_with_user_id').eq('board_id', boardId)
    if (sh) sh.forEach((s: { shared_with_user_id: string }) => memberIds.add(s.shared_with_user_id))
    const { data: profs } = await supabase.from('profiles').select('id, email, display_name').in('id', [...memberIds])
    setMembers((profs as Member[]) ?? [])
    setBoardLoading(false)
  }, [boards, user])

  useEffect(() => {
    if (activeBoardId && boards.length) loadBoardData(activeBoardId)
    else { setColumns([]); setCards([]) }
  }, [activeBoardId, boards.length, loadBoardData])

  const cardsByColumn = useMemo(() => {
    const map: Record<string, ProjectCard[]> = {}
    columns.forEach(c => { map[c.id] = [] })
    cards.forEach(c => { (map[c.column_id] ??= []).push(c) })
    Object.values(map).forEach(list => list.sort(byOrder))
    return map
  }, [columns, cards])

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

  const saveCard = async (f: CardForm) => {
    if (!activeBoardId) return
    const payload = {
      title: f.title.trim(), description: f.description, priority: f.priority,
      due_date: f.due_date || null, assignee_user_id: f.assignee_user_id, labels: f.labels,
      linked_page_id: f.linked_page_id, completed: f.completed, updated_at: new Date().toISOString(),
    }
    if (cardModal.card) {
      await supabase.from('project_cards').update(payload).eq('id', cardModal.card.id)
    } else {
      const colId = cardModal.columnId ?? columns[0]?.id
      if (!colId) return
      const order = (cardsByColumn[colId]?.length ?? 0)
      await supabase.from('project_cards').insert({ board_id: activeBoardId, column_id: colId, sort_order: order, ...payload })
    }
    setCardModal({ open: false })
    await loadBoardData(activeBoardId)
  }
  const deleteCard = async () => {
    if (!cardModal.card || !activeBoardId) return
    const cardId = cardModal.card.id
    setDeleteConfirm({
      message: t('projects_delete_card_confirm'),
      onConfirm: async () => {
        await supabase.from('project_cards').delete().eq('id', cardId)
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

  // ── Drag & drop ──
  const persist = async (list: ProjectCard[]) => {
    await Promise.all(list.map(c => supabase.from('project_cards').update({ column_id: c.column_id, sort_order: c.sort_order }).eq('id', c.id)))
  }

  const handleDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id))

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null)
    const { active, over } = e
    if (!over) return
    const activeCard = cards.find(c => c.id === active.id)
    if (!activeCard) return
    const sourceCol = activeCard.column_id
    let targetCol: string
    let overCardId: string | null = null
    const overId = String(over.id)
    if (overId.startsWith('col:')) targetCol = overId.slice(4)
    else {
      const oc = cards.find(c => c.id === overId)
      if (!oc) return
      targetCol = oc.column_id
      overCardId = oc.id
    }
    if (sourceCol === targetCol && overId === String(active.id)) return

    const source = cards.filter(c => c.column_id === sourceCol).sort(byOrder)
    const sameCol = sourceCol === targetCol
    const newSource = source.filter(c => c.id !== activeCard.id)
    const target = sameCol ? newSource : cards.filter(c => c.column_id === targetCol).sort(byOrder)
    let insertIdx = target.length
    if (overCardId) {
      const idx = target.findIndex(c => c.id === overCardId)
      if (idx !== -1) insertIdx = idx
    }
    const moved: ProjectCard = { ...activeCard, column_id: targetCol }
    target.splice(insertIdx, 0, moved)
    target.forEach((c, i) => { c.sort_order = i; c.column_id = targetCol })
    if (!sameCol) newSource.forEach((c, i) => { c.sort_order = i })

    const others = cards.filter(c => c.column_id !== sourceCol && c.column_id !== targetCol)
    const result = sameCol ? [...others, ...target] : [...others, ...newSource, ...target]
    setCards(result)
    void persist(sameCol ? target : [...newSource, ...target])
  }

  // ── Render ──
  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('projects_loading')}</div>
  }

  const activeDragCard = activeDragId ? cards.find(c => c.id === activeDragId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '12px 14px' : '14px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FolderKanban size={16} color="#6366f1" />
          </div>

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
                {([['kanban', LayoutGrid], ['list', ListIcon], ['overview', BarChart3]] as const).map(([v, Icon]) => (
                  <button key={v} onClick={() => setView(v)} title={t(`projects_view_${v}` as 'projects_view_kanban')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? '6px 8px' : '6px 11px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: view === v ? 600 : 400, backgroundColor: view === v ? '#6366f1' : 'var(--color-bg)', color: view === v ? '#fff' : 'var(--color-text-muted)' }}>
                    <Icon size={13} />{!isMobile && t(`projects_view_${v}` as 'projects_view_kanban')}
                  </button>
                ))}
              </div>
            )}
            {activeBoard && isOwner && (
              <>
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
            {boards.length > 0 && (
              <button onClick={() => setBoardModal({ open: true, board: null })} title={t('projects_new_board')} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? 8 : '6px 11px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <Plus size={14} />{!isMobile && t('projects_new_board')}
              </button>
            )}
          </div>
        </div>
        {!canEdit && activeBoard && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {t('projects_readonly')}
          </div>
        )}
      </div>

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
        ) : view === 'kanban' ? (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ flex: 1, display: 'flex', gap: 12, padding: 16, overflowX: 'auto', overflowY: 'hidden', alignItems: 'stretch' }}>
              {columns.map(col => (
                <Column
                  key={col.id} column={col} cards={cardsByColumn[col.id] ?? []} canEdit={canEdit} priorityLabel={pLabel}
                  onAddCard={() => setCardModal({ open: true, card: null, columnId: col.id })}
                  onCardClick={(c) => setCardModal({ open: true, card: c })}
                  onRename={() => setColumnModal({ open: true, column: col })}
                  onDelete={() => deleteColumn(col)}
                />
              ))}
              {canEdit && (
                <button onClick={() => setColumnModal({ open: true, column: null })} style={{ width: 200, minWidth: 200, height: 'fit-content', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}>
                  <Plus size={14} />{t('projects_add_column')}
                </button>
              )}
            </div>
            <DragOverlay>
              {activeDragCard ? <div style={{ width: 274 }}><CardView card={activeDragCard} priorityLabel={pLabel(activeDragCard.priority)} dragging /></div> : null}
            </DragOverlay>
          </DndContext>
        ) : view === 'list' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <ListView columns={columns} cards={cards} onCardClick={(c) => setCardModal({ open: true, card: c })} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <OverviewView columns={columns} cards={cards} />
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
      {cardModal.open && (
        <CardModal
          card={cardModal.card ?? null} members={members} canEdit={canEdit}
          onClose={() => setCardModal({ open: false })} onSave={saveCard}
          onDelete={cardModal.card ? deleteCard : undefined} onOpenPage={openLinkedPage}
        />
      )}
      {shareOpen && activeBoard && <ShareModal board={activeBoard} onClose={() => setShareOpen(false)} />}
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

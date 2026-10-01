// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
useDndContext,
useDroppable
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
GripVertical,
Pencil,
Plus,
Trash2
} from 'lucide-react'
import { useMemo } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { ProjectCard, ProjectCardPriority, ProjectColumn } from '../../../types'
import { SortableCard } from './Card'

// ─── Column ───────────────────────────────────────────────────────────────────

export function Column({
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
      // A coluna agrupa os cards com o nome dela (leitor de tela e E2E).
      role="group"
      aria-label={column.name}
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

export function SortableColumn({ column, canEdit, ...rest }: {
  column: ProjectColumn; cards: ProjectCard[]; canEdit: boolean; priorityLabel: (p: ProjectCardPriority) => string;
  onAddCard: () => void; onCardClick: (c: ProjectCard) => void; onRename: () => void; onDelete: () => void;
}) {
  const { active } = useDndContext()
  const cardDragging = !!active && active.data.current?.type !== 'column'
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id, data: { type: 'column' },
    disabled: { draggable: !canEdit, droppable: !canEdit || cardDragging },
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
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes as unknown as Record<string, unknown>}
        {...rest}
      />
    </div>
  )
}

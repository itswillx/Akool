// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
DndContext, DragOverlay,
useSensors
} from '@dnd-kit/core'
import {
ChevronLeft, ChevronRight
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { dndAccessibility } from '../../../lib/dndAccessibility'
import type { ProjectCard, ProjectCardPriority, ProjectColumn } from '../../../types'
import { CardView } from '../board/Card'
import { Column } from '../board/Column'
import { collisionDetection, COMPACT_COLUMN_KEY } from '../projectsShared'

// ─── Compact kanban (mobile focus) ────────────────────────────────────────────

export function CompactKanbanView({
  boardId,
  columns,
  cardsByColumn,
  canEdit,
  priorityLabel,
  sensors,
  accessibility,
  persistError,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
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
  accessibility: ReturnType<typeof dndAccessibility>
  persistError: string | null
  onDragStart: (e: DragStartEvent) => void
  onDragOver: (e: DragOverEvent) => void
  onDragEnd: (e: DragEndEvent) => void
  onDragCancel: () => void
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
      <DndContext sensors={sensors} collisionDetection={collisionDetection} accessibility={accessibility} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
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

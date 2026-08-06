import type React from 'react'
import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useLanguage } from '../../i18n/LanguageContext'
import { columnDroppableId, type BoardColumnDef, type ColumnAggregate } from './boardModel'

// Coluna do board: alvo de drop + cabeçalho com contador, soma e barra de teto.

export function BoardColumn({
  column, agg, itemIds, children, formatAmount, headerExtra, droppable,
}: {
  column: BoardColumnDef
  agg: ColumnAggregate
  /** Ids na ordem renderizada — o SortableContext precisa deles. */
  itemIds: string[]
  children: React.ReactNode
  formatAmount: (cents: number) => string
  headerExtra?: React.ReactNode
  droppable: boolean
}) {
  const { t } = useLanguage()
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(column.id), disabled: !droppable })
  const strategy = useMemo(() => verticalListSortingStrategy, [])
  const accent = column.color ?? 'var(--color-text-muted)'

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 290,
        minWidth: 290,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '100%',
        borderRadius: 12,
        border: '1px solid var(--color-border)',
        background: isOver ? 'var(--color-hover)' : 'var(--color-bg-secondary)',
        transition: 'background-color 0.12s',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: accent, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {column.label}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: agg.over ? 'var(--color-error)' : 'var(--color-text-muted)', background: 'var(--color-hover)', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>
            {agg.count}
          </span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: agg.over ? 'var(--color-error)' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {formatAmount(agg.total)}
          {typeof column.limit === 'number' && column.limit > 0 && ` / ${formatAmount(column.limit)}`}
        </div>
        {agg.pct !== null && (
          <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, agg.pct * 100)}%`, height: '100%', background: agg.over ? 'var(--color-error)' : accent }} />
          </div>
        )}
        {headerExtra}
      </div>

      <div style={{ flex: 1, minHeight: 90, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SortableContext items={itemIds} strategy={strategy}>
          {children}
        </SortableContext>
        {itemIds.length === 0 && (
          <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
            {t('board_empty_column')}
          </div>
        )}
      </div>
    </div>
  )
}

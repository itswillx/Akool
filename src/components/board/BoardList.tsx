import type React from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { BoardColumnDef, ColumnAggregate } from './boardModel'

// Fallback de lista: as mesmas colunas empilhadas verticalmente. É o que o
// mobile renderiza (colunas lado a lado não cabem em 375px e o drag brigaria
// com o scroll) e o que o toggle oferece no desktop.

export function BoardList<T>({
  columns, groups, aggregates, formatAmount, renderRow, headerExtra,
}: {
  columns: BoardColumnDef[]
  groups: Map<string, T[]>
  aggregates: Map<string, ColumnAggregate>
  formatAmount: (cents: number) => string
  renderRow: (item: T, columnId: string) => React.ReactNode
  headerExtra?: (col: BoardColumnDef, agg: ColumnAggregate) => React.ReactNode
}) {
  const { t } = useLanguage()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {columns.map(col => {
        const items = groups.get(col.id) ?? []
        const agg = aggregates.get(col.id)
        if (!agg) return null
        return (
          <div key={col.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: col.color ?? 'var(--color-text-muted)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{col.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: agg.over ? 'var(--color-error)' : 'var(--color-text-muted)', background: 'var(--color-hover)', borderRadius: 999, padding: '1px 7px' }}>
                  {agg.count}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: agg.over ? 'var(--color-error)' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatAmount(agg.total)}
                  {typeof col.limit === 'number' && col.limit > 0 && ` / ${formatAmount(col.limit)}`}
                </span>
              </div>
              {headerExtra?.(col, agg)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
              {items.length === 0
                ? <div style={{ padding: '14px 8px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('board_empty_column')}</div>
                : items.map(item => renderRow(item, col.id))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

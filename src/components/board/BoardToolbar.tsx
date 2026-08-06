import type React from 'react'
import { Eye, EyeOff, LayoutGrid, List as ListIcon, Search } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { BoardColumnDef, ColumnAggregate } from './boardModel'
import type { BoardView } from './useBoardPrefs'

// Barra de controle do board: busca, ordenação, chips de visibilidade das
// colunas e o toggle Kanban/Lista.

const chipStyle = (visible: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 9px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  background: visible ? 'var(--color-surface)' : 'transparent',
  color: visible ? 'var(--color-text)' : 'var(--color-text-muted)',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  opacity: visible ? 1 : 0.65,
})

const segBtn = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none',
  background: active ? 'var(--color-surface)' : 'transparent',
  color: active ? 'var(--color-text)' : 'var(--color-text-subtle)',
  fontSize: 12.5, fontWeight: active ? 600 : 500, padding: '5px 11px', borderRadius: 6,
  cursor: 'pointer', whiteSpace: 'nowrap',
  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
})

export function BoardToolbar({
  columns, aggregates, hidden, onToggleColumn, query, onQuery,
  sortOptions, sortId, onSortId, view, onView, formatAmount, extra, showViewToggle,
}: {
  columns: BoardColumnDef[]
  /** Contagem por coluna, para o chip mostrar quanto some ao esconder. */
  aggregates: Map<string, ColumnAggregate>
  hidden: ReadonlySet<string>
  onToggleColumn: (id: string) => void
  query: string
  onQuery: (v: string) => void
  sortOptions: { id: string; label: string }[]
  sortId: string | null
  onSortId: (id: string | null) => void
  view: BoardView
  onView: (v: BoardView) => void
  formatAmount: (cents: number) => string
  extra?: React.ReactNode
  /** No mobile o kanban não é oferecido — o toggle some em vez de mentir. */
  showViewToggle: boolean
}) {
  const { t } = useLanguage()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={e => onQuery(e.target.value)}
            placeholder={t('board_search_placeholder')}
            style={{
              width: '100%', padding: '8px 10px 8px 30px', border: '1px solid var(--color-border)',
              borderRadius: 8, fontSize: 13, backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {sortOptions.length > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
            {t('board_sort_by')}
            <select
              value={sortId ?? sortOptions[0].id}
              onChange={e => onSortId(e.target.value)}
              style={{
                padding: '7px 9px', border: '1px solid var(--color-border)', borderRadius: 8,
                fontSize: 12.5, background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none',
              }}
            >
              {sortOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        )}

        {extra}

        {showViewToggle && (
          <div style={{ display: 'inline-flex', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 3, flexShrink: 0 }}>
            <button style={segBtn(view === 'kanban')} onClick={() => onView('kanban')}>
              <LayoutGrid size={13} />{t('board_view_kanban')}
            </button>
            <button style={segBtn(view === 'list')} onClick={() => onView('list')}>
              <ListIcon size={13} />{t('board_view_list')}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
          {t('board_visible_blocks')}
        </span>
        {columns.map(col => {
          const visible = !hidden.has(col.id)
          const agg = aggregates.get(col.id)
          return (
            <button key={col.id} style={chipStyle(visible)} onClick={() => onToggleColumn(col.id)}
              title={agg ? formatAmount(agg.total) : undefined}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.color ?? 'var(--color-text-muted)', flexShrink: 0 }} />
              {col.label}
              <span style={{ opacity: 0.7 }}>{agg?.count ?? 0}</span>
              {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

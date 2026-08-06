import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor,
  pointerWithin, rectIntersection,
  useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useLanguage } from '../../i18n/LanguageContext'
import { formatBRL } from '../../lib/money'
import { BoardCardShell } from './BoardCard'
import { BoardColumn } from './BoardColumn'
import { BoardList } from './BoardList'
import { BoardToolbar } from './BoardToolbar'
import {
  aggregate, filterBySearch, groupByColumn, neighborColumnId,
  resolveDropColumnId, visibleColumns,
  type BoardColumnDef, type ColumnAggregate,
} from './boardModel'
import { useBoardPrefs, type BoardView } from './useBoardPrefs'

// Board genérico e sem domínio. Recebe colunas, itens e getters; devolve
// kanban (desktop) ou lista (mobile / toggle), com busca, ordenação, chips de
// visibilidade e movimentação por arrastar ou pelos botões ‹ ›.
//
// Regra central: o board NUNCA é dono dos dados. Ele nunca muta `items`; um
// movimento vira `pendingMove`, desenhado por cima, e some quando `onMove`
// resolve (`false` = recusado, o card volta) ou quando os dados reais chegam.
// É isso que permite um board cujo drop precisa abrir um modal de confirmação
// antes de gravar — o domínio continua dono da verdade.

// Copiado do ProjectsPanel.tsx:616 em vez de importado: a fronteira do módulo
// financeiro proíbe depender do mundo de projetos, e são três linhas.
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  return rectIntersection(args)
}

/** Estável entre renders: passar `[]` inline remontaria os sensores toda vez. */
const EMPTY_SENSORS: ReturnType<typeof useSensors> = []

export interface BoardSortOption<T> {
  id: string
  label: string
  compare: (a: T, b: T) => number
}

export interface KanbanBoardProps<T> {
  columns: BoardColumnDef[]
  items: T[]
  getId: (item: T) => string
  getColumnId: (item: T) => string
  /** Centavos. Alimenta a soma do cabeçalho e a ordenação por valor. */
  getAmount?: (item: T) => number
  getSearchText?: (item: T) => string
  renderCard: (item: T, ctx: { dragging: boolean }) => React.ReactNode
  /** Default: formatBRL. Um board de contagem passa `n => String(n)`. */
  formatAmount?: (value: number) => string
  renderColumnHeaderExtra?: (col: BoardColumnDef, agg: ColumnAggregate) => React.ReactNode
  onCardClick?: (item: T) => void
  /**
   * Confirma (ou recusa) o movimento. `false` devolve o card à coluna de
   * origem; qualquer outro retorno mantém o preview até os dados chegarem.
   */
  onMove?: (item: T, toColumnId: string) => Promise<boolean | void> | boolean | void
  canMove?: (item: T, toColumnId: string) => boolean
  sortOptions?: BoardSortOption<T>[]
  /** Namespace do localStorage das preferências. */
  storageKey: string
  /** Colunas que nascem escondidas (ex.: 'cancelled'). */
  defaultHiddenColumns?: string[]
  readOnly?: boolean
  isMobile?: boolean
  toolbarExtra?: React.ReactNode
}

export function KanbanBoard<T>({
  columns, items, getId, getColumnId, getAmount, getSearchText, renderCard,
  formatAmount = formatBRL, renderColumnHeaderExtra, onCardClick, onMove, canMove,
  sortOptions = [], storageKey, defaultHiddenColumns = [], readOnly = false,
  isMobile = false, toolbarExtra,
}: KanbanBoardProps<T>) {
  const { t } = useLanguage()
  const prefs = useBoardPrefs(storageKey, isMobile, defaultHiddenColumns)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<{ id: string; columnId: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)

  // MouseSensor ignora eventos de toque — deslizar o dedo continua rolando a
  // página. Mesma configuração do ProjectsPanel.tsx:1995.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const canDrag = !isMobile && !readOnly && !!onMove
  const view: BoardView = prefs.view

  // O preview otimista é uma projeção sobre `items`: em vez de clonar o item
  // (o board não sabe como escrever nele), o getter de coluna é interceptado.
  const columnIdOf = useCallback(
    (item: T) => (pending && getId(item) === pending.id ? pending.columnId : getColumnId(item)),
    [pending, getId, getColumnId],
  )

  const searched = useMemo(
    () => filterBySearch(items, query, getSearchText),
    [items, query, getSearchText],
  )

  const activeSort = sortOptions.find(o => o.id === prefs.sortId) ?? sortOptions[0] ?? null
  const sorted = useMemo(
    () => (activeSort ? [...searched].sort(activeSort.compare) : searched),
    [searched, activeSort],
  )

  const groups = useMemo(
    () => groupByColumn(columns, sorted, columnIdOf),
    [columns, sorted, columnIdOf],
  )

  // Os chips de visibilidade mostram os totais de TODAS as colunas, inclusive
  // as escondidas — senão esconder uma coluna apagaria a informação de quanto
  // foi escondido.
  const aggregates = useMemo(() => {
    const out = new Map<string, ColumnAggregate>()
    for (const col of columns) {
      out.set(col.id, aggregate(groups.get(col.id) ?? [], col.limit, getAmount))
    }
    return out
  }, [columns, groups, getAmount])

  const shown = useMemo(() => visibleColumns(columns, prefs.hidden), [columns, prefs.hidden])

  const requestMove = useCallback(async (item: T, toColumnId: string) => {
    if (!onMove) return
    const from = getColumnId(item)
    if (from === toColumnId) return
    if (canMove && !canMove(item, toColumnId)) {
      setRejected(true)
      return
    }
    setRejected(false)
    const id = getId(item)
    setPending({ id, columnId: toColumnId })
    try {
      const ok = await onMove(item, toColumnId)
      // Só um `false` explícito reverte. `void`/`true` mantêm o preview até os
      // dados reais chegarem — limpá-lo aqui faria o card piscar de volta na
      // coluna antiga entre o await e o re-render.
      if (ok === false) setPending(null)
      else setPending(p => (p && p.id === id && p.columnId === toColumnId ? null : p))
    } catch {
      setPending(null)
    }
  }, [onMove, canMove, getId, getColumnId])

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id))

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    if (!e.over) return
    const target = resolveDropColumnId(String(e.over.id), sorted, getId, columnIdOf)
    if (target === null) return
    const item = sorted.find(i => getId(i) === String(e.active.id))
    if (item) void requestMove(item, target)
  }

  const moveHandlers = (item: T) => {
    if (!onMove || readOnly) return { prev: null, next: null }
    const from = columnIdOf(item)
    const prevId = neighborColumnId(columns, prefs.hidden, from, -1)
    const nextId = neighborColumnId(columns, prefs.hidden, from, 1)
    const usable = (to: string | null) =>
      to && (!canMove || canMove(item, to)) ? () => void requestMove(item, to) : null
    return { prev: usable(prevId), next: usable(nextId) }
  }

  const card = (item: T) => {
    const id = getId(item)
    const { prev, next } = moveHandlers(item)
    return (
      <BoardCardShell
        key={id}
        id={id}
        draggable={canDrag}
        busy={pending?.id === id}
        onClick={onCardClick ? () => onCardClick(item) : undefined}
        onMovePrev={prev}
        onMoveNext={next}
      >
        {renderCard(item, { dragging: dragId === id })}
      </BoardCardShell>
    )
  }

  const draggingItem = dragId ? sorted.find(i => getId(i) === dragId) ?? null : null
  const noResults = query.trim().length > 0 && sorted.length === 0

  const toolbar = (
    <BoardToolbar
      columns={columns}
      aggregates={aggregates}
      hidden={prefs.hidden}
      onToggleColumn={prefs.toggleColumn}
      query={query}
      onQuery={setQuery}
      sortOptions={sortOptions.map(o => ({ id: o.id, label: o.label }))}
      sortId={activeSort?.id ?? null}
      onSortId={prefs.setSortId}
      view={view}
      onView={prefs.setView}
      formatAmount={formatAmount}
      extra={toolbarExtra}
      showViewToggle={!isMobile}
    />
  )

  const banner = rejected && (
    <div style={{ fontSize: 12, color: 'var(--color-error)', padding: '2px 2px 0' }}>
      {t('board_invalid_move')}
    </div>
  )

  const content = noResults ? (
    <div style={{ padding: '30px 12px', textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
      {t('board_no_results')}
    </div>
  ) : view === 'list' ? (
    <BoardList
      columns={shown}
      groups={groups}
      aggregates={aggregates}
      formatAmount={formatAmount}
      headerExtra={renderColumnHeaderExtra}
      renderRow={item => card(item)}
    />
  ) : (
    <div className="finance-hide-scrollbar" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6, alignItems: 'flex-start' }}>
      {shown.map(col => {
        const colItems = groups.get(col.id) ?? []
        return (
          <BoardColumn
            key={col.id}
            column={col}
            agg={aggregates.get(col.id)!}
            itemIds={colItems.map(getId)}
            formatAmount={formatAmount}
            headerExtra={renderColumnHeaderExtra?.(col, aggregates.get(col.id)!)}
            droppable={canDrag && col.droppable !== false}
          >
            {colItems.map(card)}
          </BoardColumn>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {toolbar}
      {banner}
      {/* O DndContext é montado SEMPRE, inclusive na lista e no board
          read-only: `useSortable`/`useDroppable` dentro dos cards e das colunas
          precisam de um contexto acima deles. Sem drag, ele fica sem sensores
          e nenhum handler dispara. */}
      <DndContext
        sensors={canDrag ? sensors : EMPTY_SENSORS}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragId(null)}
      >
        {content}
        <DragOverlay>
          {draggingItem && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 10, width: 274, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
              {renderCard(draggingItem, { dragging: true })}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

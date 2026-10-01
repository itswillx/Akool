// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useLanguage } from '../../i18n/LanguageContext'
import {
    applyCardMove,
    changedColumnOrder, changedPlacements, moveCardToColumn, resolveColumnId,
    type CardPlacement
} from '../../lib/boardMoves'
import {
    reorderCards, reorderColumns
} from '../../lib/data/projects'
import type { ProjectCard, ProjectColumn } from '../../types'
import type { useBoardData } from './useBoardData'

// Arrastar e soltar: cards entre colunas, ordem das colunas e anúncios de acessibilidade.
export function useBoardDnd({ board }: { board: ReturnType<typeof useBoardData> }) {
  const { t } = useLanguage()
  const { activeBoardId, boardBusyRef, boardReloadRef, cards, columns, dragSnapshotRef, dragSourceColumnRef, loadBoardData, setActiveDragId, setCards, setColumns, setPersistError } = board

  // ── Drag & drop ──
  // PERF-004: só o que mudou de lugar, numa requisição. As RPCs são um UPDATE
  // só (tudo ou nada) e erram se alguma linha não foi gravada; aí o quadro
  // recarrega com a ordem do banco.
  const persist = async (before: readonly CardPlacement[], after: ProjectCard[]) => {
    if (!activeBoardId) return false
    const moves = changedPlacements(before, after)
    if (moves.length === 0) { setPersistError(null); return true }
    const { error } = await reorderCards(activeBoardId, moves)
    if (error) {
      setPersistError(t('projects_persist_error'))
      await loadBoardData(activeBoardId, { silent: true })
      return false
    }
    setPersistError(null)
    return true
  }

  const persistColumns = async (before: ProjectColumn[], after: ProjectColumn[]) => {
    if (!activeBoardId) return false
    const changed = changedColumnOrder(before, after)
    if (changed.length === 0) { setPersistError(null); return true }
    const { error } = await reorderColumns(activeBoardId, changed)
    if (error) {
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
    await persistColumns(columns, reordered)
  }

  // Fim do drag (e da gravação da ordem): libera a recarga que esperou.
  const endBoardBusy = () => {
    boardBusyRef.current = false
    boardReloadRef.current?.release()
  }

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    boardBusyRef.current = true
    setActiveDragId(id)
    dragSourceColumnRef.current = cards.find(c => c.id === id)?.column_id ?? null
    dragSnapshotRef.current = cards.map(({ id: cardId, column_id, sort_order }) => ({ id: cardId, column_id, sort_order }))
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
      try {
        if (!over) return
        const overRaw = String(over.id)
        const overColId = overRaw.startsWith('col:') ? overRaw.slice(4) : overRaw
        const oldIndex = columns.findIndex(c => c.id === activeId)
        const newIndex = columns.findIndex(c => c.id === overColId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
        const reordered = arrayMove(columns, oldIndex, newIndex).map((c, i) => ({ ...c, sort_order: i }))
        setColumns(reordered)
        await persistColumns(columns, reordered)
      } finally {
        endBoardBusy()
      }
      return
    }

    const sourceCol = dragSourceColumnRef.current
    const before = dragSnapshotRef.current

    setActiveDragId(null)

    // `cards` já traz o que o drag-over mudou; o drop só aplica o último passo.
    // (Antes, `next` saía de dentro do updater do setCards, que o React não
    // garante ter rodado nessa hora.)
    const next = over ? applyCardMove(cards, activeId, String(over.id)) ?? cards : cards
    if (next !== cards) setCards(next)

    try {
      if (!sourceCol || !before) return
      await persist(before, next)
    } finally {
      dragSourceColumnRef.current = null
      dragSnapshotRef.current = null
      endBoardBusy()
    }
  }

  // Esc no meio do drag. O drag-over pode ter movido o card de coluna só na
  // tela; a recarga silenciosa traz de volta a posição gravada.
  const handleDragCancel = () => {
    setActiveDragId(null)
    dragSourceColumnRef.current = null
    dragSnapshotRef.current = null
    endBoardBusy()
    if (activeBoardId) void loadBoardData(activeBoardId, { silent: true })
  }

  const handleMoveCardToColumn = async (cardId: string, targetColumnId: string) => {
    const next = moveCardToColumn(cards, cardId, targetColumnId)
    if (!next) return
    setCards(next)
    await persist(cards, next)
  }

  return { persist, persistColumns, moveColumnByOffset, endBoardBusy, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel, handleMoveCardToColumn }
}

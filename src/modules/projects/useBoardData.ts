// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
    KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import {
    byOrder,
    type CardPlacement
} from '../../lib/boardMoves'
import { queueBadges, type CardQueueRow } from '../../lib/cardQueue'
import {
    listOwnBoards, listSharedBoards
} from '../../lib/data/projects'
import { createDeferredReload, type DeferredReload } from '../../lib/deferredReload'
import { KANBAN_KEYBOARD_CODES } from '../../lib/dndAccessibility'
import {
    collectBoardLabels,
    defaultCardFilters,
    filterProjectCards,
    hasActiveFilters,
    loadCardFilters,
    saveCardFilters,
    type ProjectCardFilters,
} from '../../lib/projectCardFilters'
import { supabase } from '../../lib/supabase'
import type { ProjectBoard, ProjectCard, ProjectCardPriority, ProjectColumn } from '../../types'
import { fetchBoardData, loadLatestBoard, type BoardData, type BoardLoadDeps } from './boardLoader'
import { clearCardModalState, loadCardModalState, saveCardModalState } from './card/cardDraft'
import { type ViewMode } from './ProjectsNav'
import type { Member } from './projectsShared'
import { ACTIVE_BOARD_KEY, OPEN_CARD_KEY, VALID_VIEWS, VIEW_KEY } from './projectsShared'

// Estado do quadro: listas, carga, realtime, fila, filtros e derivados.
export function useBoardData() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const { showToast } = useToast()

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
  const [boardError, setBoardError] = useState(false)
  const [boardsError, setBoardsError] = useState(false)

  const boardsRef = useRef(boards)
  boardsRef.current = boards
  const cardModalOpenRef = useRef(false)
  const modalRestoredRef = useRef(false)
  const cardSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragSourceColumnRef = useRef<string | null>(null)
  // PERF-004: posições no início do drag (o drag-over já muda `cards` no caminho).
  const dragSnapshotRef = useRef<CardPlacement[] | null>(null)
  const userId = user?.id

  // REL-006: o quadro na tela, a sequência dos carregamentos e o t/showToast
  // atuais, lidos pelos callbacks sem precisar recriá-los. Os efeitos ficam
  // antes do que carrega o quadro, então o ref já aponta o quadro novo.
  const activeBoardIdRef = useRef(activeBoardId)
  const boardRequestRef = useRef(0)
  const notifyRef = useRef({ t, showToast })
  useEffect(() => { activeBoardIdRef.current = activeBoardId }, [activeBoardId])
  useEffect(() => { notifyRef.current = { t, showToast } }, [t, showToast])

  // Modals
  const [boardModal, setBoardModal] = useState<{ open: boolean; board?: ProjectBoard | null }>({ open: false })
  const [boardSelectorOpen, setBoardSelectorOpen] = useState(false)
  const [cardModal, setCardModal] = useState<{ open: boolean; card?: ProjectCard | null; columnId?: string }>({ open: false })
  const [columnModal, setColumnModal] = useState<{ open: boolean; column?: ProjectColumn | null }>({ open: false })
  const [shareOpen, setShareOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueRows, setQueueRows] = useState<CardQueueRow[]>([])
  const [queueRefreshKey, setQueueRefreshKey] = useState(0)
  const queueReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // REL-010: card na mão ou ordem do drop ainda gravando; a recarga do realtime espera.
  const boardBusyRef = useRef(false)
  const boardReloadRef = useRef<DeferredReload | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ message: string; onConfirm: () => void | Promise<void> } | null>(null)

  const activeBoard = boards.find(b => b.id === activeBoardId) ?? null
  const canEdit = !!activeBoard && (activeBoard.user_id === user?.id || activeBoard.share_role === 'editor' || activeBoard.share_role === 'owner')
  const isOwner = !!activeBoard && activeBoard.user_id === user?.id

  // MouseSensor ignora eventos de toque — no touch, só o long-press do TouchSensor
  // inicia o drag; deslizar o dedo continua sendo scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: KANBAN_KEYBOARD_CODES }),
  )
  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}`)

  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])

  const loadBoards = useCallback(async () => {
    const userId = user?.id
    if (!userId) return
    setLoading(true)
    const [{ data: own, error: ownError }, { data: shared, error: sharedError }] = await Promise.all([
      listOwnBoards(userId),
      listSharedBoards(userId),
    ])
    // REL-006: falha não vira "nenhum quadro" (que convida a criar outro):
    // mantém os quadros que já estavam na tela e mostra o erro.
    if (ownError || sharedError) {
      setBoardsError(true)
      notifyRef.current.showToast('error', notifyRef.current.t('projects_boards_load_error'), { dedupeKey: 'boards-load-error' })
      setLoading(false)
      return
    }
    setBoardsError(false)
    const ownBoards: ProjectBoard[] = (own ?? []).map(b => ({ ...b, share_role: 'owner' as const }))
    const sharedBoards: ProjectBoard[] = []
    if (shared) {
      for (const { role, project_boards: b } of shared) {
        if (b) sharedBoards.push({ ...b, share_role: role, is_shared: true })
      }
    }
    const all = [...ownBoards, ...sharedBoards]
    setBoards(all)
    setActiveBoardId(prev => {
      if (prev && all.some(b => b.id === prev)) return prev
      return all[0]?.id ?? null
    })
    setLoading(false)
  }, [user?.id])

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

  // REL-006: só vale a resposta do pedido mais recente do quadro que está na
  // tela (a sequência e as regras ficam em ./boardLoader, que tem teste).
  const loadBoardData = useCallback((boardId: string, options?: { silent?: boolean }) => {
    const deps: BoardLoadDeps<BoardData> = {
      fetch: id => fetchBoardData(supabase, id, [userId, boardsRef.current.find(b => b.id === id)?.user_id]),
      isActive: id => id === activeBoardIdRef.current,
      apply: (_id, data) => {
        setBoardError(false)
        setColumns(data.columns)
        setQueueRows(data.queueRows)
        setCards(data.cards)
        setMembers(data.members)
      },
      fail: (_id, error, silent) => {
        console.error('[projects] board load failed:', error)
        if (silent) {
          // Recarga de fundo (realtime, depois de salvar): mantém o que está
          // na tela e só avisa.
          notifyRef.current.showToast('error', notifyRef.current.t('projects_board_load_error'), { dedupeKey: 'board-load-error' })
          return
        }
        setColumns([]); setCards([]); setQueueRows([]); setMembers([])
        setBoardError(true)
      },
      setLoading: loading => {
        setBoardLoading(loading)
        if (loading) setBoardError(false)
      },
    }
    return loadLatestBoard(boardRequestRef, deps, boardId, options?.silent ?? cardModalOpenRef.current)
  }, [userId])

  useEffect(() => {
    if (activeBoardId && boards.length) loadBoardData(activeBoardId)
    else { setColumns([]); setCards([]); setQueueRows([]) }
  }, [activeBoardId, boards.length, loadBoardData])

  // Fila de desenvolvimento: quando a IA (cards-api) inicia ou conclui um card,
  // o quadro recarrega sozinho. Um enqueue gera um evento por card, então os
  // eventos são agrupados numa recarga só.
  useEffect(() => {
    if (!activeBoardId) return
    const boardId = activeBoardId
    const channel = supabase
      .channel(`project-queue:${boardId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_card_queue', filter: `board_id=eq.${boardId}` },
        () => {
          if (queueReloadTimerRef.current) clearTimeout(queueReloadTimerRef.current)
          queueReloadTimerRef.current = setTimeout(() => {
            void loadBoardData(boardId, { silent: true })
            setQueueRefreshKey(k => k + 1)
          }, 400)
        },
      )
      .subscribe()
    return () => {
      if (queueReloadTimerRef.current) clearTimeout(queueReloadTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [activeBoardId, loadBoardData])

  // REL-010: o que outras pessoas mudam no quadro (cards e colunas) chega pelo
  // realtime e vira uma recarga silenciosa agrupada. Com um card na mão, ou a
  // ordem do drop ainda gravando, a recarga espera (ver lib/deferredReload).
  // DELETE não é assinado: o Postgres Changes não aplica RLS nem filtro em
  // DELETE e mandaria a todos os ids apagados de todos os quadros (mesmo motivo
  // do PagesContext). O card apagado some na próxima recarga do quadro.
  useEffect(() => {
    if (!activeBoardId) return
    const boardId = activeBoardId
    const deferred = createDeferredReload({
      delayMs: 400,
      reload: () => { void loadBoardData(boardId, { silent: true }) },
      isBlocked: () => boardBusyRef.current,
    })
    boardReloadRef.current = deferred
    const filter = `board_id=eq.${boardId}`
    const onChange = () => deferred.trigger()
    const channel = supabase
      .channel(`project-board:${boardId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_cards', filter }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_cards', filter }, onChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_columns', filter }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'project_columns', filter }, onChange)
      .subscribe()
    return () => {
      deferred.cancel()
      if (boardReloadRef.current === deferred) boardReloadRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [activeBoardId, loadBoardData])

  const queueBadgeMap = useMemo(() => queueBadges(queueRows), [queueRows])

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

  return { boards, setBoards, activeBoardId, setActiveBoardId, columns, setColumns, cards, setCards, members, setMembers, view, setView, loading, setLoading, boardLoading, setBoardLoading, activeDragId, setActiveDragId, cardSaveStatus, setCardSaveStatus, cardSaveErrorKind, setCardSaveErrorKind, persistError, setPersistError, cardFilters, setCardFilters, boardError, setBoardError, boardsError, setBoardsError, boardsRef, cardModalOpenRef, modalRestoredRef, cardSaveStatusTimerRef, dragSourceColumnRef, dragSnapshotRef, userId, activeBoardIdRef, boardRequestRef, notifyRef, boardModal, setBoardModal, boardSelectorOpen, setBoardSelectorOpen, cardModal, setCardModal, columnModal, setColumnModal, shareOpen, setShareOpen, importOpen, setImportOpen, queueOpen, setQueueOpen, queueRows, setQueueRows, queueRefreshKey, setQueueRefreshKey, queueReloadTimerRef, boardBusyRef, boardReloadRef, deleteConfirm, setDeleteConfirm, activeBoard, canEdit, isOwner, sensors, pLabel, loadBoards, loadBoardData, queueBadgeMap, filteredCards, availableLabels, filtersActive, cardsByColumn }
}

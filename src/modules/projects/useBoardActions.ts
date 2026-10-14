// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { useCallback, useMemo } from 'react'
import { usePages } from '../../contexts/PagesContext'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import { buildAutoSchedule } from '../../lib/autoSchedule'
import {
    createBoard as createBoardRow, deleteBoard as deleteBoardRow, deleteCard as deleteCardRow,
    deleteColumn as deleteColumnRow, enqueueCards, insertCard, insertColumn, normalizeCard, rescheduleCard,
    saveCardVersioned, scheduleCards, updateBoard as updateBoardRow, updateColumn as updateColumnRow, validateQueueCard
} from '../../lib/data/projects'
import { mapWriteError, requireRows, runGuarded, type WriteError } from '../../lib/optimistic'
import type { Page, ProjectColumn } from '../../types'
import { clearCardDraft, clearCardModalState, draftKeyFor, removeCardImages, uploadCardImage } from './card/cardDraft'
import type { CardIO } from './card/useCardEditor'
import { flattenPages } from './projectsShared'
import type { useBoardData } from './useBoardData'

// Gravações do quadro: quadros, colunas, cards, fila e cronograma.
export function useBoardActions({ board, onOpenPage }: { board: ReturnType<typeof useBoardData>; onOpenPage?: (page: Page) => void }) {
  const { showToast } = useToast()
  const { t } = useLanguage()
  const { pages, sharedPages, setActivePage } = usePages()
  const { activeBoard, activeBoardId, activeBoardIdRef, boardModal, cardModal, cards, columnModal, columns, isOwner, loadBoardData, loadBoards, setActiveBoardId, setBoardModal, setCardModal, setCards, setColumnModal, setDeleteConfirm, setPersistError, userId } = board

  // ── CRUD ──
  // REL-004: toda escrita confere o erro. Na falha, o modal continua aberto
  // com o que foi digitado e aparece um toast; só o sucesso fecha e recarrega.
  // update/delete levam .select('id') + requireRows: o RLS recusa sem erro,
  // com 0 linhas.
  const writeFailed = (fallback: TranslationKey) => (error: WriteError) =>
    showToast('error', mapWriteError(error, t, fallback))

  const createBoard = async (data: { name: string; icon: string; color: string; description: string }) => {
    const res = await runGuarded(
      () => createBoardRow(data),
      { label: 'createBoard', onError: writeFailed('toast_error_save') },
    )
    if (!res.ok) return
    setBoardModal({ open: false })
    await loadBoards()
    if (typeof res.data === 'string') setActiveBoardId(res.data)
  }
  const updateBoard = async (data: { name: string; icon: string; color: string; description: string }) => {
    if (!boardModal.board) return
    const boardId = boardModal.board.id
    const res = await runGuarded(
      async () => requireRows(await updateBoardRow(boardId, data)),
      { label: 'updateBoard', onError: writeFailed('toast_error_save') },
    )
    if (!res.ok) return
    setBoardModal({ open: false })
    await loadBoards()
  }
  const deleteBoard = () => {
    if (!activeBoard || !isOwner) return
    const boardId = activeBoard.id
    setDeleteConfirm({
      message: t('projects_delete_board_confirm'),
      onConfirm: async () => {
        const res = await runGuarded(
          async () => requireRows(await deleteBoardRow(boardId)),
          { label: 'deleteBoard', onError: writeFailed('toast_error_delete') },
        )
        setDeleteConfirm(null)
        if (!res.ok) return
        setActiveBoardId(null)
        await loadBoards()
      },
    })
  }

  const enqueueCard = async (cardId: string) => {
    if (!activeBoardId) return
    const { error } = await enqueueCards(activeBoardId, { cards: [cardId] })
    if (error) {
      showToast('error', t('projects_queue_error').replace('{message}', error.message))
      return
    }
    showToast('success', t('projects_queue_card_added'))
    await loadBoardData(activeBoardId, { silent: true })
  }

  const saveColumn = async (data: { name: string; color: string; wip_limit: number | null }) => {
    if (!activeBoardId) return
    const boardId = activeBoardId
    const editing = columnModal.column
    const order = columns.length ? Math.max(...columns.map(c => c.sort_order)) + 1 : 0
    const res = await runGuarded(
      async () => editing
        ? requireRows(await updateColumnRow(editing.id, data))
        : await insertColumn({ board_id: boardId, ...data, sort_order: order }),
      { label: 'saveColumn', onError: writeFailed('toast_error_save') },
    )
    if (!res.ok) return
    setColumnModal({ open: false })
    await loadBoardData(boardId)
  }
  const deleteColumn = (col: ProjectColumn) => {
    setDeleteConfirm({
      message: t('projects_delete_column_confirm'),
      onConfirm: async () => {
        const res = await runGuarded(
          async () => requireRows(await deleteColumnRow(col.id)),
          { label: 'deleteColumn', onError: writeFailed('toast_error_delete') },
        )
        setDeleteConfirm(null)
        if (res.ok && activeBoardId) await loadBoardData(activeBoardId)
      },
    })
  }

  // ── Card aberto (API-013) ──
  // A edição em si (versão, conflito, rascunho) é do editor do modal
  // (card/useCardEditor). Aqui fica só a E/S que ele usa e o que muda o quadro.
  const cardColumnId = cardModal.columnId ?? columns[0]?.id

  const cardIO = useMemo<CardIO | null>(() => (userId ? {
    userId,
    insert: async values => {
      const { data, error } = await insertCard(values)
      return error || !data ? { error: error ?? { message: 'insert sem linha' } } : { card: normalizeCard(data) }
    },
    save: saveCardVersioned,
    upload: (boardId, cardId, pending) => uploadCardImage(userId, boardId, cardId, pending),
    removeUploads: removeCardImages,
    onInserted: (card, live) => {
      // O quadro na tela pode ter mudado enquanto o insert ia.
      if (card.board_id !== activeBoardIdRef.current) return
      setCards(prev => (prev.some(c => c.id === card.id) ? prev : [...prev, card]))
      if (live) setCardModal(prev => (prev.open && !prev.card ? { ...prev, card } : prev))
    },
    onSaved: (cardId, base) => {
      setCards(prev => prev.map(c => (c.id === cardId ? { ...c, ...base.fields, updated_at: base.version } : c)))
    },
    // Relê os papéis sem desmontar o painel: o modal continua aberto, sem editar.
    onDenied: () => { void loadBoards({ silent: true }) },
  } : null), [userId, setCards, setCardModal, loadBoards, activeBoardIdRef])

  /** Fecha o modal. `keepDraft`: há um aviso de conflito pendente, e o rascunho fica para a próxima abertura. */
  const closeCardModal = useCallback((opts?: { keepDraft?: boolean }) => {
    if (activeBoardId && !opts?.keepDraft) {
      if (cardModal.card) clearCardDraft(draftKeyFor(activeBoardId, cardModal.card.id))
      clearCardDraft(draftKeyFor(activeBoardId, null, cardColumnId))
    }
    clearCardModalState()
    setCardModal({ open: false })
    // Os setters são do useState de useBoardData (estáveis); entram só porque,
    // vindos por parâmetro, o lint não sabe disso.
  }, [activeBoardId, cardModal.card, cardColumnId, setCardModal])

  /** Salvar: o editor já gravou tudo; fecha e recarrega o quadro. */
  const finishCardSave = async () => {
    const boardId = activeBoardId
    closeCardModal()
    if (boardId) await loadBoardData(boardId, { silent: true })
  }

  // Validação (fluxo v2): aprovar conclui; reprovar devolve o card ao topo da
  // fila. O modal espera o editor gravar antes de chamar (CardModal) e fecha
  // aqui, para o autosave não regravar o formulário antigo.
  const validateCard = async (cardId: string, approve: boolean, note?: string): Promise<boolean> => {
    if (!activeBoardId) return false
    const { error } = await validateQueueCard(activeBoardId, cardId, approve, note ?? null)
    if (error) {
      showToast('error', t('projects_queue_error').replace('{message}', error.message))
      return false
    }
    showToast('success', t(approve ? 'projects_queue_approved' : 'projects_queue_rejected'))
    closeCardModal()
    await loadBoardData(activeBoardId, { silent: true })
    return true
  }

  /** Excluir o card aberto. `editor` para de gravar antes do DELETE e volta se ele falhar. */
  const deleteCard = (editor?: { stop: () => Promise<void>; resume: () => void }) => {
    if (!cardModal.card || !activeBoardId) return
    const cardId = cardModal.card.id
    const boardId = activeBoardId
    setDeleteConfirm({
      message: t('projects_delete_card_confirm'),
      onConfirm: async () => {
        await editor?.stop()
        const res = await runGuarded(
          async () => requireRows(await deleteCardRow(cardId)),
          { label: 'deleteCard', onError: writeFailed('toast_error_delete') },
        )
        // Na falha, o card continua aberto, com o rascunho.
        if (!res.ok) { editor?.resume(); setDeleteConfirm(null); return }
        closeCardModal()
        await loadBoardData(boardId)
        setDeleteConfirm(null)
      },
    })
  }

  const openLinkedPage = (pageId: string) => {
    const all = [...flattenPages(pages), ...flattenPages(sharedPages)]
    const page = all.find(p => p.id === pageId)
    if (!page) return
    if (onOpenPage) onOpenPage(page) // o host resolve (Documentos: seleciona no próprio painel)
    else setActivePage(page) // fallback autônomo
  }

  // Arrastar na linha do tempo: só as datas, sem versão (a última que chega
  // vale). A versão nova vem do servidor.
  const handleRescheduleCard = async (
    cardId: string,
    dates: { start_date: string | null; due_date: string | null },
  ) => {
    if (!activeBoardId) return
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, ...dates } : c)))
    const { data, error } = await rescheduleCard(cardId, dates)
    const row = data?.[0]
    if (error || !row) {
      setPersistError(t('projects_persist_error'))
      await loadBoardData(activeBoardId, { silent: true })
      return
    }
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, updated_at: row.updated_at } : c)))
  }

  // NOTE: must schedule from the board's full `cards`/`columns` state, never
  // `filteredCards` (what GanttView renders) — an active filter would silently
  // break priority chains or skip cards from the schedule.
  const handleGenerateSchedule = async (
    targetDeadline: string | null,
  ): Promise<{ scheduled: number; overflowDays: number } | null> => {
    if (!activeBoardId) return null
    const { patches, overflowDays } = buildAutoSchedule(cards, columns, undefined, targetDeadline ?? undefined)
    if (patches.length === 0) return { scheduled: 0, overflowDays }
    // PERF-004: uma requisição, atômica (schedule_project_cards), em vez de um
    // UPDATE por card.
    const { error } = await scheduleCards(
      activeBoardId,
      patches.map(p => ({ id: p.cardId, start_date: p.start_date, due_date: p.due_date, depends_on: p.depends_on })),
    )
    if (error) {
      setPersistError(t('projects_persist_error'))
      await loadBoardData(activeBoardId, { silent: true })
      return null
    }
    // As versões novas (updated_at) chegam na recarga.
    setCards(prev => prev.map(c => {
      const patch = patches.find(p => p.cardId === c.id)
      return patch ? { ...c, start_date: patch.start_date, due_date: patch.due_date, depends_on: patch.depends_on } : c
    }))
    void loadBoardData(activeBoardId, { silent: true })
    return { scheduled: patches.length, overflowDays }
  }

  return { writeFailed, createBoard, updateBoard, deleteBoard, enqueueCard, saveColumn, deleteColumn, cardIO, cardColumnId, closeCardModal, finishCardSave, validateCard, deleteCard, openLinkedPage, handleRescheduleCard, handleGenerateSchedule }
}

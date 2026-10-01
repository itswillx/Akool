// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { useCallback } from 'react'
import { usePages } from '../../contexts/PagesContext'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import { buildAutoSchedule } from '../../lib/autoSchedule'
import {
    createBoard as createBoardRow, deleteBoard as deleteBoardRow, deleteCard as deleteCardRow, deleteColumn as deleteColumnRow,
    enqueueCards, insertCard, insertCardReturningId, insertColumn,
    scheduleCards,
    updateBoard as updateBoardRow, updateCard,
    updateColumn as updateColumnRow, validateQueueCard
} from '../../lib/data/projects'
import { mapWriteError, requireRows, runGuarded, type WriteError } from '../../lib/optimistic'
import type { Page, ProjectCard, ProjectCardAttachment, ProjectColumn } from '../../types'
import type { AutoSaveResult, CardForm, CardSaveExtras } from './card/cardDraft'
import { clearCardDraft, clearCardModalState, getDraftKey, persistCardAttachments, saveCardDraft } from './card/cardDraft'
import { flattenPages } from './projectsShared'
import type { useBoardData } from './useBoardData'

// Gravações do quadro: quadros, colunas, cards, fila e cronograma.
export function useBoardActions({ board, onOpenPage }: { board: ReturnType<typeof useBoardData>; onOpenPage?: (page: Page) => void }) {
  const { showToast } = useToast()
  const { t } = useLanguage()
  const { pages, sharedPages, setActivePage } = usePages()
  const { activeBoard, activeBoardId, boardModal, canEdit, cardModal, cardSaveStatusTimerRef, cards, cardsByColumn, columnModal, columns, isOwner, loadBoardData, loadBoards, setActiveBoardId, setBoardModal, setCardModal, setCardSaveErrorKind, setCardSaveStatus, setCards, setColumnModal, setDeleteConfirm, setPersistError, userId } = board

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

  const closeCardModal = useCallback(() => {
    if (activeBoardId) {
      clearCardDraft(getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId))
    }
    clearCardModalState()
    setCardModal({ open: false })
    setCardSaveStatus('idle')
    setCardSaveErrorKind('general')
    // Os setters são do useState de useBoardData (estáveis); entram só porque,
    // vindos por parâmetro, o lint não sabe disso.
  }, [activeBoardId, cardModal.card?.id, cardModal.columnId, setCardModal, setCardSaveStatus, setCardSaveErrorKind])

  // Validação (fluxo v2): aprovar conclui; reprovar devolve o card ao topo da
  // fila. O modal fecha para o autosave não regravar o formulário antigo.
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

  const handleDraftChange = useCallback((form: CardForm, removedAttachmentIds: string[]) => {
    if (!activeBoardId) return
    saveCardDraft(getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId), {
      form,
      savedAt: new Date().toISOString(),
      removedAttachmentIds,
    })
  }, [activeBoardId, cardModal.card?.id, cardModal.columnId])

  const cardDraftKey = activeBoardId
    ? getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId)
    : null

  const autoSaveCard = async (formSnapshot: CardForm, extras: CardSaveExtras = { pendingFiles: [], removedAttachmentIds: [] }): Promise<AutoSaveResult | null> => {
    if (!activeBoardId || !userId || !canEdit) return null

    const hasPending = extras.pendingFiles.length > 0
    const hasRemovals = extras.removedAttachmentIds.length > 0
    if (!cardModal.card && !formSnapshot.title.trim() && !hasPending && !hasRemovals) {
      setCardSaveStatus('idle')
      return null
    }
    if (!cardModal.card && !formSnapshot.title.trim()) {
      setCardSaveStatus('idle')
      return null
    }

    setCardSaveStatus('saving')
    setCardSaveErrorKind('general')
    const updatedAt = new Date().toISOString()

    let cardId = cardModal.card?.id
    let attachments = (formSnapshot.attachments ?? []).filter(a => !extras.removedAttachmentIds.includes(a.id))
    let uploadedPendingIds: string[] = []

    if (!cardId) {
      const colId = cardModal.columnId ?? columns[0]?.id
      if (!colId) {
        setCardSaveStatus('error')
        showToast('error', t('projects_autosave_error'), { dedupeKey: 'card-autosave-error' })
        return null
      }
      const order = (cardsByColumn[colId]?.length ?? 0)
      const insertPayload = {
        board_id: activeBoardId,
        column_id: colId,
        sort_order: order,
        title: formSnapshot.title.trim(),
        description: formSnapshot.description,
        priority: formSnapshot.priority,
        start_date: formSnapshot.start_date || null,
        due_date: formSnapshot.due_date || null,
        estimated_days: formSnapshot.estimated_days,
        assignee_user_id: formSnapshot.assignee_user_id,
        labels: formSnapshot.labels,
        linked_page_id: formSnapshot.linked_page_id,
        parent_card_id: formSnapshot.parent_card_id,
        depends_on: formSnapshot.depends_on,
        completed: formSnapshot.completed,
        checklist: formSnapshot.checklist,
        links: formSnapshot.links,
        attachments,
        updated_at: updatedAt,
      }
      const { data: inserted, error } = await insertCard(insertPayload)
      if (error || !inserted) {
        setCardSaveStatus('error')
        showToast('error', t('projects_autosave_error'), { dedupeKey: 'card-autosave-error' })
        return null
      }
      cardId = inserted.id
      const newCard: ProjectCard = {
        ...(inserted as ProjectCard),
        labels: (inserted as ProjectCard).labels ?? [],
        checklist: (inserted as ProjectCard).checklist ?? formSnapshot.checklist,
        attachments: (inserted as ProjectCard).attachments ?? attachments,
      }
      setCards(prev => [...prev, newCard])
      setCardModal(prev => ({ ...prev, card: newCard }))
      if (cardDraftKey) {
        clearCardDraft(cardDraftKey)
        saveCardDraft(getDraftKey(activeBoardId, newCard.id, colId), {
          form: { ...formSnapshot, attachments },
          savedAt: updatedAt,
          removedAttachmentIds: [],
        })
      }
    }

    if (!cardId) {
      setCardSaveStatus('error')
      showToast('error', t('projects_autosave_error'), { dedupeKey: 'card-autosave-error' })
      return null
    }

    try {
      const attachmentResult = await persistCardAttachments(userId, activeBoardId, cardId, formSnapshot, extras)
      attachments = attachmentResult.attachments
      uploadedPendingIds = attachmentResult.uploadedPendingIds
    } catch {
      setCardSaveErrorKind('upload')
      setCardSaveStatus('error')
      showToast('error', t('projects_attachments_upload_error'), { dedupeKey: 'card-autosave-error' })
      return null
    }

    const payload = {
      title: formSnapshot.title.trim(),
      description: formSnapshot.description,
      priority: formSnapshot.priority,
      start_date: formSnapshot.start_date || null,
      due_date: formSnapshot.due_date || null,
      estimated_days: formSnapshot.estimated_days,
      assignee_user_id: formSnapshot.assignee_user_id,
      labels: formSnapshot.labels,
      linked_page_id: formSnapshot.linked_page_id,
      parent_card_id: formSnapshot.parent_card_id,
      depends_on: formSnapshot.depends_on,
      completed: formSnapshot.completed,
      checklist: formSnapshot.checklist,
      links: formSnapshot.links,
      attachments,
      updated_at: updatedAt,
    }

    const { error } = await updateCard(cardId, payload)
    if (error) {
      setCardSaveStatus('error')
      showToast('error', t('projects_autosave_error'), { dedupeKey: 'card-autosave-error' })
      return null
    }

    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...payload } : c))
    setCardSaveStatus('saved')
    if (cardSaveStatusTimerRef.current) clearTimeout(cardSaveStatusTimerRef.current)
    cardSaveStatusTimerRef.current = setTimeout(() => setCardSaveStatus('idle'), 2000)
    return { attachments, uploadedPendingIds }
  }

  const saveCard = async (f: CardForm, extras: CardSaveExtras = { pendingFiles: [], removedAttachmentIds: [] }) => {
    if (!activeBoardId || !userId) return

    setCardSaveStatus('saving')
    setCardSaveErrorKind('general')
    const updatedAt = new Date().toISOString()
    const basePayload = {
      title: f.title.trim(), description: f.description, priority: f.priority,
      start_date: f.start_date || null, due_date: f.due_date || null, estimated_days: f.estimated_days,
      assignee_user_id: f.assignee_user_id, labels: f.labels,
      linked_page_id: f.linked_page_id, parent_card_id: f.parent_card_id, depends_on: f.depends_on,
      completed: f.completed, checklist: f.checklist, links: f.links,
    }

    let cardId = cardModal.card?.id

    if (!cardId) {
      const colId = cardModal.columnId ?? columns[0]?.id
      if (!colId) return
      const order = (cardsByColumn[colId]?.length ?? 0)
      const { data: inserted, error } = await insertCardReturningId({ board_id: activeBoardId, column_id: colId, sort_order: order, attachments: [], ...basePayload, updated_at: updatedAt })
      if (error || !inserted) {
        setCardSaveStatus('error')
        showToast('error', t('projects_autosave_error'))
        return
      }
      cardId = inserted.id
    }

    if (!cardId) {
      setCardSaveStatus('error')
      showToast('error', t('projects_autosave_error'))
      return
    }

    let attachments: ProjectCardAttachment[]
    try {
      ({ attachments } = await persistCardAttachments(userId, activeBoardId, cardId, f, extras))
    } catch {
      setCardSaveErrorKind('upload')
      setCardSaveStatus('error')
      showToast('error', t('projects_attachments_upload_error'))
      return
    }

    const { error } = await updateCard(cardId, { ...basePayload, attachments, updated_at: updatedAt })
    if (error) {
      setCardSaveStatus('error')
      showToast('error', t('projects_autosave_error'))
      return
    }

    if (cardDraftKey) clearCardDraft(cardDraftKey)
    clearCardModalState()
    setCardModal({ open: false })
    setCardSaveStatus('idle')
    await loadBoardData(activeBoardId, { silent: true })
  }
  const deleteCard = () => {
    if (!cardModal.card || !activeBoardId) return
    const cardId = cardModal.card.id
    setDeleteConfirm({
      message: t('projects_delete_card_confirm'),
      onConfirm: async () => {
        const res = await runGuarded(
          async () => requireRows(await deleteCardRow(cardId)),
          { label: 'deleteCard', onError: writeFailed('toast_error_delete') },
        )
        // Na falha, o card continua aberto, com o rascunho.
        if (!res.ok) { setDeleteConfirm(null); return }
        if (cardDraftKey) clearCardDraft(cardDraftKey)
        clearCardModalState()
        setCardModal({ open: false })
        await loadBoardData(activeBoardId)
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

  const handleRescheduleCard = async (
    cardId: string,
    dates: { start_date: string | null; due_date: string | null },
  ) => {
    if (!activeBoardId) return
    const updated_at = new Date().toISOString()
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, ...dates, updated_at } : c)))
    const { error } = await updateCard(cardId, { ...dates, updated_at })
    if (error) {
      setPersistError(t('projects_persist_error'))
      await loadBoardData(activeBoardId, { silent: true })
    }
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
    const updated_at = new Date().toISOString()
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
    setCards(prev => prev.map(c => {
      const patch = patches.find(p => p.cardId === c.id)
      return patch ? { ...c, ...patch, updated_at } : c
    }))
    return { scheduled: patches.length, overflowDays }
  }

  return { writeFailed, createBoard, updateBoard, deleteBoard, enqueueCard, saveColumn, deleteColumn, closeCardModal, validateCard, handleDraftChange, cardDraftKey, autoSaveCard, saveCard, deleteCard, openLinkedPage, handleRescheduleCard, handleGenerateSchedule }
}

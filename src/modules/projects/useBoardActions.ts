// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { useCallback, useRef } from 'react'
import { usePages } from '../../contexts/PagesContext'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import { buildAutoSchedule } from '../../lib/autoSchedule'
import {
    cardFields, changedFields, createBoard as createBoardRow, deleteBoard as deleteBoardRow, deleteCard as deleteCardRow,
    deleteColumn as deleteColumnRow, diffCardFields, enqueueCards, insertCard, insertColumn, normalizeCard, rescheduleCard,
    saveCardVersioned, scheduleCards, updateBoard as updateBoardRow, updateColumn as updateColumnRow, validateQueueCard,
    type CardField, type CardFields, type CardSave
} from '../../lib/data/projects'
import { mapWriteError, requireRows, runGuarded, type WriteError } from '../../lib/optimistic'
import type { Page, ProjectCard, ProjectCardAttachment, ProjectColumn } from '../../types'
import type { AutoSaveResult, CardConflict, CardForm, CardSaveExtras } from './card/cardDraft'
import {
    cardFormFrom, clearCardDraft, clearCardModalState, formFields, formPatchFrom, getDraftKey, persistCardAttachments,
    saveCardDraft
} from './card/cardDraft'
import { flattenPages } from './projectsShared'
import type { useBoardData } from './useBoardData'

/** API-013: de onde a edição do card aberto partiu (ver persistCard). */
interface CardBase {
  session: number
  id: string
  version: string
  fields: CardFields
}

type PersistResult = AutoSaveResult & { cardId: string }

const baseFrom = (card: ProjectCard, session: number): CardBase =>
  ({ session, id: card.id, version: card.updated_at, fields: cardFields(card) })

// Gravações do quadro: quadros, colunas, cards, fila e cronograma.
export function useBoardActions({ board, onOpenPage }: { board: ReturnType<typeof useBoardData>; onOpenPage?: (page: Page) => void }) {
  const { showToast } = useToast()
  const { t } = useLanguage()
  const { pages, sharedPages, setActivePage } = usePages()
  const { activeBoard, activeBoardId, boardModal, canEdit, cardModal, cardSaveStatusTimerRef, cards, columnModal, columns, isOwner, loadBoardData, loadBoards, setActiveBoardId, setBoardModal, setCardConflict, setCardModal, setCardSaveErrorKind, setCardSaveStatus, setCards, setColumnModal, setDeleteConfirm, setPersistError, userId } = board

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
  // A edição vai sobre uma versão: `baseRef` guarda o updated_at do servidor e
  // os campos de onde a edição partiu. Cada gravação manda só o que mudou
  // desde a base, presa à versão; se outra pessoa gravou no meio, o servidor
  // não acha a linha. Aí, se ela mexeu em outros campos, a gravação é refeita
  // por cima da versão dela; se mexeu nos mesmos, o modal pergunta. Cada
  // abertura do modal é uma sessão (a base de uma não vale na outra), e as
  // gravações vão em fila, cada uma partindo da base que a anterior deixou.
  const cardSessionRef = useRef(0)
  const baseRef = useRef<CardBase | null>(null)
  const conflictRef = useRef<CardConflict | null>(null)
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve())

  const showConflict = useCallback((conflict: CardConflict | null) => {
    conflictRef.current = conflict
    setCardConflict(conflict)
  }, [setCardConflict])

  const endCardSession = useCallback(() => {
    cardSessionRef.current += 1
    baseRef.current = null
    showConflict(null)
  }, [showConflict])

  const closeCardModal = useCallback(() => {
    if (activeBoardId) {
      clearCardDraft(getDraftKey(activeBoardId, cardModal.card?.id ?? null, cardModal.columnId))
    }
    clearCardModalState()
    endCardSession()
    setCardModal({ open: false })
    setCardSaveStatus('idle')
    setCardSaveErrorKind('general')
    // Os setters são do useState de useBoardData (estáveis); entram só porque,
    // vindos por parâmetro, o lint não sabe disso.
  }, [activeBoardId, cardModal.card?.id, cardModal.columnId, endCardSession, setCardModal, setCardSaveStatus, setCardSaveErrorKind])

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

  function enqueueSave<T>(job: () => Promise<T>): Promise<T> {
    const run = saveChainRef.current.then(job, job)
    saveChainRef.current = run.catch(() => undefined)
    return run
  }

  /** Recusa de regra do servidor (gatilho, RPC) traz o motivo; o resto é o aviso genérico. */
  const cardWriteMessage = (error: WriteError) =>
    error.hint === 'akool' ? t('projects_card_rule_error').replace('{message}', error.message) : t('projects_autosave_error')

  /** O modal desta sessão ainda está aberto (o resultado pode mexer nele)? */
  const isLive = (session: number) => session === cardSessionRef.current

  const saveFailed = (session: number, message: string, kind: 'upload' | 'general' = 'general'): null => {
    if (isLive(session)) {
      setCardSaveErrorKind(kind)
      setCardSaveStatus('error')
    }
    showToast('error', message, { dedupeKey: 'card-autosave-error' })
    return null
  }

  /** Card novo ainda não gravado nesta sessão? */
  const isNewCard = () => !cardModal.card && baseRef.current?.session !== cardSessionRef.current

  /**
   * Grava o formulário: cria o card se for novo, sobe as imagens pendentes e
   * manda os campos que mudaram desde a base. Devolve null quando não gravou
   * (erro ou conflito sem anexos novos para o modal adotar).
   */
  const persistCard = (form: CardForm, extras: CardSaveExtras): Promise<PersistResult | null> => {
    const session = cardSessionRef.current
    const openCard = cardModal.card ?? null
    const openColumnId = cardModal.columnId
    const columnId = openColumnId ?? columns[0]?.id
    const boardId = activeBoardId
    const uid = userId
    return enqueueSave(async (): Promise<PersistResult | null> => {
      if (!boardId || !uid) return null
      // Com um conflito esperando a pessoa, nada é gravado.
      if (isLive(session) && conflictRef.current) return null
      if (isLive(session)) {
        setCardSaveStatus('saving')
        setCardSaveErrorKind('general')
      }

      let base = baseRef.current?.session === session ? baseRef.current : openCard ? baseFrom(openCard, session) : null
      if (!base) {
        if (!columnId) return saveFailed(session, t('projects_autosave_error'))
        // Sem sort_order nem updated_at: o servidor põe no fim da coluna e data a versão.
        const kept = form.attachments.filter(a => !extras.removedAttachmentIds.includes(a.id))
        const { data: inserted, error } = await insertCard({ board_id: boardId, column_id: columnId, ...formFields(form, kept) })
        if (error || !inserted) return saveFailed(session, error ? cardWriteMessage(error) : t('projects_autosave_error'))
        const card = normalizeCard(inserted)
        base = baseFrom(card, session)
        setCards(prev => [...prev, card])
        if (isLive(session)) {
          baseRef.current = base
          setCardModal(prev => ({ ...prev, card }))
          clearCardDraft(getDraftKey(boardId, null, openColumnId))
          saveCardDraft(getDraftKey(boardId, card.id, openColumnId), {
            form: { ...form, attachments: kept },
            savedAt: new Date().toISOString(),
            removedAttachmentIds: [],
          })
        }
      }

      let attachments: ProjectCardAttachment[]
      let uploadedPendingIds: string[]
      try {
        ({ attachments, uploadedPendingIds } = await persistCardAttachments(uid, boardId, base.id, form, extras))
      } catch {
        return saveFailed(session, t('projects_attachments_upload_error'), 'upload')
      }

      const patch = diffCardFields(base.fields, formFields(form, attachments))
      const keys = Object.keys(patch) as CardField[]
      let merged: Partial<CardForm> | undefined
      let result: CardSave = keys.length === 0
        ? { status: 'saved', at: base.version }
        : await saveCardVersioned(base.id, patch, base.version)
      if (result.status === 'conflict' && changedFields(base.fields, result.current, keys).length === 0) {
        // Outra pessoa mudou outros campos: refaz por cima da versão dela e
        // devolve ao modal o que ela mudou.
        const theirs = cardFields(result.current)
        merged = formPatchFrom(diffCardFields(base.fields, theirs))
        base = { ...base, version: result.current.updated_at, fields: theirs }
        result = await saveCardVersioned(base.id, patch, base.version)
      }

      switch (result.status) {
        case 'saved': {
          const saved: CardBase = { ...base, version: result.at, fields: { ...base.fields, ...patch } }
          setCards(prev => prev.map(c => (c.id === saved.id ? { ...c, ...saved.fields, updated_at: saved.version } : c)))
          if (isLive(session)) {
            baseRef.current = saved
            setCardSaveStatus('saved')
            if (cardSaveStatusTimerRef.current) clearTimeout(cardSaveStatusTimerRef.current)
            cardSaveStatusTimerRef.current = setTimeout(() => setCardSaveStatus('idle'), 2000)
          }
          return { cardId: saved.id, attachments: saved.fields.attachments, uploadedPendingIds, merged }
        }
        case 'conflict':
          if (isLive(session)) {
            baseRef.current = base
            showConflict({ cardId: base.id, theirs: result.current, fields: changedFields(base.fields, result.current, keys) })
            setCardSaveStatus('idle')
          }
          // As imagens já subiram: o modal as guarda no formulário, sem subir de novo.
          return { cardId: base.id, attachments, uploadedPendingIds, merged }
        case 'gone':
          return saveFailed(session, t('projects_card_gone'))
        case 'error':
          return saveFailed(session, cardWriteMessage(result.error))
      }
    })
  }

  const autoSaveCard = async (formSnapshot: CardForm, extras: CardSaveExtras = { pendingFiles: [], removedAttachmentIds: [] }): Promise<AutoSaveResult | null> => {
    if (!activeBoardId || !userId || !canEdit) return null
    // Card novo só nasce com título.
    if (isNewCard() && !formSnapshot.title.trim()) {
      setCardSaveStatus('idle')
      return null
    }
    return persistCard(formSnapshot, extras)
  }

  const saveCard = async (f: CardForm, extras: CardSaveExtras = { pendingFiles: [], removedAttachmentIds: [] }) => {
    if (!activeBoardId || !userId || !canEdit) return
    if (isNewCard() && !f.title.trim()) return
    const boardId = activeBoardId
    const session = cardSessionRef.current
    const openColumnId = cardModal.columnId
    const result = await persistCard(f, extras)
    // Erro ou conflito: o modal fica aberto, com o que foi digitado.
    if (!result || conflictRef.current || !isLive(session)) return

    clearCardDraft(getDraftKey(boardId, result.cardId, openColumnId))
    clearCardModalState()
    endCardSession()
    setCardModal({ open: false })
    setCardSaveStatus('idle')
    await loadBoardData(boardId, { silent: true })
  }

  /**
   * Resolve o conflito. Devolve o formulário que o modal passa a mostrar (e
   * grava em seguida): a versão salva, ou ela com os campos que a pessoa mudou.
   */
  const resolveCardConflict = (choice: 'theirs' | 'mine', form: CardForm): CardForm | null => {
    const conflict = conflictRef.current
    if (!conflict) return null
    const base = baseRef.current
    const theirs = cardFields(conflict.theirs)
    const mine = base && base.id === conflict.cardId ? diffCardFields(base.fields, formFields(form)) : {}
    baseRef.current = { session: cardSessionRef.current, id: conflict.cardId, version: conflict.theirs.updated_at, fields: theirs }
    showConflict(null)
    setCards(prev => prev.map(c => (c.id === conflict.cardId ? { ...c, ...theirs, updated_at: conflict.theirs.updated_at } : c)))
    setCardSaveStatus('idle')
    const saved = cardFormFrom(theirs)
    return choice === 'theirs' ? saved : { ...saved, ...formPatchFrom(mine) }
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
        endCardSession()
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

  return { writeFailed, createBoard, updateBoard, deleteBoard, enqueueCard, saveColumn, deleteColumn, closeCardModal, validateCard, handleDraftChange, cardDraftKey, autoSaveCard, saveCard, resolveCardConflict, deleteCard, openLinkedPage, handleRescheduleCard, handleGenerateSchedule }
}

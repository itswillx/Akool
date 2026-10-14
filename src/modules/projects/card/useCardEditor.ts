// API-013: a edição de um card aberto no modal. Cada abertura é um editor:
// quadro, coluna e base (versão + campos) ficam congelados na abertura, e há
// no máximo uma gravação em voo. Uma edição marca "sujo"; quando a gravação em
// voo termina, o editor primeiro absorve o resultado (base e formulário
// juntos) e, se ficou sujo, grava de novo lendo o formulário mais novo. Não há
// fila de retratos velhos do formulário, então uma gravação nunca desfaz o que
// outra pessoa gravou no meio. As decisões ficam em ./cardSession; a E/S vem
// do quadro (useBoardActions) em `io`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../../contexts/ToastContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { baseOf, sameCardValue, type CardBase, type CardInsert, type CardPatch, type CardSave } from '../../../lib/data/projects'
import type { WriteError } from '../../../lib/optimistic'
import type { ProjectCard, ProjectCardAttachment } from '../../../types'
import { ATTACHMENTS_MAX } from '../../../lib/cardLimits'
import { AUTOSAVE_DEBOUNCE_MS } from '../projectsShared'
import { draftKeyFor, formFields, loadCardDraft, saveCardDraft, clearCardDraft, type CardForm, type PendingFile } from './cardDraft'
import {
  absorbForeign, confirmAttachments, contestedKeys, foreignChanges, openEditor, planPatch, resolveChoice,
  type CardConflict,
} from './cardSession'

/** A E/S do quadro que o editor usa (useBoardActions.cardIO). */
export interface CardIO {
  userId: string
  insert(values: CardInsert): Promise<{ card: ProjectCard } | { error: WriteError }>
  save(cardId: string, patch: CardPatch, version: string): Promise<CardSave>
  upload(boardId: string, cardId: string, pending: PendingFile): Promise<ProjectCardAttachment | null>
  removeUploads(paths: string[]): Promise<void>
  /** Card novo criado. `live`: o modal ainda está aberto nele. */
  onInserted(card: ProjectCard, live: boolean): void
  /** Versão nova gravada (ou adotada): atualiza a lista do quadro. */
  onSaved(cardId: string, base: CardBase): void
  /** O servidor recusou por permissão: o quadro relê os papéis. */
  onDenied(): void
}

export type CardSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Uma tentativa de gravar some depois de tantos refazeres seguidos: o card está mudando demais agora. */
const MAX_REBASES = 3

export function useCardEditor({ card, boardId, columnId, canEdit, io }: {
  card: ProjectCard | null
  boardId: string
  columnId?: string
  canEdit: boolean
  io: CardIO
}) {
  const { t } = useLanguage()
  const { showToast } = useToast()

  // Congelado na abertura (o quadro ativo pode mudar com o modal aberto).
  const [start] = useState(() => openEditor(card, loadCardDraft(draftKeyFor(boardId, card?.id ?? null, columnId)), canEdit))
  const frozen = useRef({ boardId, columnId })

  const [form, setFormState] = useState<CardForm>(start.form)
  const [removedAttachmentIds, setRemovedState] = useState<string[]>(start.removedAttachmentIds)
  const [pendingFiles, setPendingState] = useState<PendingFile[]>([])
  const [status, setStatus] = useState<CardSaveStatus>('idle')
  const [errorKind, setErrorKind] = useState<'upload' | 'general'>('general')
  const [conflict, setConflictState] = useState<CardConflict | null>(null)
  /** Sobe quando a descrição muda por fora (o que outra pessoa gravou, ou a escolha no aviso): o editor de texto aberto remonta com ela. */
  const [descRev, setDescRev] = useState(0)

  const formRef = useRef(start.form)
  const removedRef = useRef(start.removedAttachmentIds)
  const pendingRef = useRef<PendingFile[]>([])
  const baseRef = useRef<CardBase | null>(start.base)
  const cardIdRef = useRef<string | null>(card?.id ?? null)
  const conflictRef = useRef<CardConflict | null>(null)
  /** Imagens que subiram nesta edição (pelo id da pendente), para não subir de novo. */
  const uploadsRef = useRef(new Map<string, ProjectCardAttachment>())
  /** Imagens que subiram numa edição anterior (vieram do rascunho) e ainda não entraram no card. */
  const carriedRef = useRef<ProjectCardAttachment[]>(start.uploaded)
  /** O que a edição anterior gravava quando a página recarregou: o servidor ter isso é nosso, não conflito. */
  const ownSentRef = useRef<CardPatch | null>(start.sentPatch)
  const dirtyRef = useRef(false)
  const runningRef = useRef<Promise<void> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)
  const endedRef = useRef(false)
  /** Parou de gravar: card apagado, sem permissão ou sendo excluído. */
  const stoppedRef = useRef<'gone' | 'denied' | 'deleting' | null>(null)
  /** A última gravação falhou (Salvar não fecha o modal). */
  const lastFailedRef = useRef(false)
  const ioRef = useRef(io)
  useEffect(() => { ioRef.current = io }, [io])

  const live = () => mountedRef.current && !endedRef.current
  const draftKey = () => draftKeyFor(frozen.current.boardId, cardIdRef.current, frozen.current.columnId)

  /** Imagens que subiram e ainda não estão no card. */
  const unconfirmedUploads = () => {
    const inBase = (id: string) => !!baseRef.current?.fields.attachments.some(a => a.id === id)
    return [...uploadsRef.current.values(), ...carriedRef.current].filter(a => !inBase(a.id))
  }

  const writeDraft = useCallback((base: CardBase | null = baseRef.current, sentPatch?: CardPatch) => {
    const uploaded = unconfirmedUploads()
    saveCardDraft(draftKey(), {
      form: formRef.current, savedAt: new Date().toISOString(), removedAttachmentIds: removedRef.current,
      ...(base ? { base } : {}), ...(uploaded.length ? { uploaded } : {}), ...(sentPatch ? { sentPatch } : {}),
    })
  }, [])

  // O formulário muda pelo ref, de uma vez (não depende de quando o React roda o updater).
  const setForm = useCallback((next: CardForm) => {
    formRef.current = next
    if (mountedRef.current) setFormState(next)
  }, [])
  /** Formulário que vem de fora (absorção ou escolha no aviso). */
  const adoptForm = useCallback((next: CardForm) => {
    const descChanged = next.description !== formRef.current.description
    setForm(next)
    if (descChanged && mountedRef.current) setDescRev(n => n + 1)
  }, [setForm])
  const setRemoved = (next: string[]) => {
    removedRef.current = next
    if (mountedRef.current) setRemovedState(next)
  }
  const setPending = (next: PendingFile[]) => {
    pendingRef.current = next
    if (mountedRef.current) setPendingState(next)
  }
  const setConflict = (next: CardConflict | null) => {
    conflictRef.current = next
    if (mountedRef.current) setConflictState(next)
  }
  const setLiveStatus = (next: CardSaveStatus, kind: 'upload' | 'general' = 'general') => {
    if (!live()) return
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setStatus(next)
    setErrorKind(kind)
    if (next === 'saved') savedTimerRef.current = setTimeout(() => { if (mountedRef.current) setStatus('idle') }, 2000)
  }

  const failMessage = (error: WriteError) =>
    error.hint === 'akool' ? t('projects_card_rule_error').replace('{message}', error.message)
      : error.code === '42501' ? t('projects_card_denied')
        : t('projects_autosave_error')

  const fail = (message: string, kind: 'upload' | 'general' = 'general') => {
    lastFailedRef.current = true
    showToast('error', message, { dedupeKey: 'card-autosave-error' })
    setLiveStatus('error', kind)
    // Depois de fechar, o que não foi gravado fica no rascunho: reabrir o card grava de novo.
    if (!live()) writeDraft()
  }

  const raiseConflict = (next: CardConflict) => {
    if (live()) {
      setConflict(next)
      setLiveStatus('idle')
      writeDraft(next.editsBase)
      return
    }
    // Sessão já fechada: ninguém vê o aviso. O rascunho guarda a mudança, a
    // base dela e as imagens que subiram; reabrir o card mostra o aviso.
    conflictRef.current = next
    showToast('error', t('projects_card_conflict_closed'), { dedupeKey: 'card-conflict-closed' })
    writeDraft(next.editsBase)
  }

  /** As imagens que esta gravação põe no card: as pendentes que subiram e as que vieram do rascunho. */
  const uploadedNow = () => [
    ...[...uploadsRef.current.entries()].filter(([pid]) => pendingRef.current.some(p => p.id === pid)).map(([, a]) => a),
    ...carriedRef.current.filter(a => !removedRef.current.includes(a.id)),
  ]

  /** Uma gravação: cria o card se for novo, sobe as imagens que faltam e grava o que mudou desde a base. */
  const runOnce = async () => {
    const sent = formRef.current
    if (!baseRef.current && !sent.title.trim()) return // card novo só nasce com título
    setLiveStatus('saving')

    if (!baseRef.current) {
      const columnId = frozen.current.columnId
      if (!columnId) return fail(t('projects_autosave_error'))
      const kept = sent.attachments.filter(a => !removedRef.current.includes(a.id))
      const res = await ioRef.current.insert({ board_id: frozen.current.boardId, column_id: columnId, ...formFields(sent, kept) })
      if ('error' in res) return fail(failMessage(res.error))
      const newKey = draftKeyFor(frozen.current.boardId, res.card.id)
      clearCardDraft(draftKey())
      cardIdRef.current = res.card.id
      baseRef.current = baseOf(res.card)
      ioRef.current.onInserted(res.card, live())
      if (live()) saveCardDraft(newKey, { form: formRef.current, savedAt: new Date().toISOString(), removedAttachmentIds: removedRef.current, base: baseRef.current })
    }
    const cardId = cardIdRef.current!

    let uploadFailed = false
    for (const p of [...pendingRef.current]) {
      if (uploadsRef.current.has(p.id)) continue
      const att = await ioRef.current.upload(frozen.current.boardId, cardId, p)
      if (att) uploadsRef.current.set(p.id, att)
      else uploadFailed = true
    }

    // As mudanças da pessoa são medidas da base de onde `sent` partiu; a cada
    // refazer, só elas vão sobre a versão nova.
    const editsBase = baseRef.current
    let base = editsBase
    let merged: CardPatch = {}
    let done = false
    for (let attempt = 0; attempt < MAX_REBASES && !done; attempt++) {
      const patch = planPatch(editsBase, base, sent, removedRef.current, uploadedNow())
      if (Object.keys(patch).length === 0) { done = true; break }
      // Se a página recarregar no meio, o rascunho sabe o que estava indo.
      if (live()) writeDraft(editsBase, patch)
      const res = await ioRef.current.save(cardId, patch, base.version)
      switch (res.status) {
        case 'saved':
          if (res.current) {
            merged = { ...merged, ...foreignChanges(base.fields, res.current, patch) }
            base = baseOf(res.current)
          } else {
            base = { version: res.at, fields: { ...base.fields, ...patch } }
          }
          done = true
          break
        case 'conflict': {
          // O que a edição anterior gravava antes de a página recarregar e já
          // está no servidor é desta pessoa, não disputa.
          const own = ownSentRef.current
          const contested = contestedKeys(base.fields, res.current, patch)
            .filter(key => !(own && key in own && sameCardValue(res.current[key], own[key])))
          if (contested.length > 0) {
            // As mudanças da pessoa são medidas da base de onde o formulário
            // partiu (`editsBase`), não da versão do refazer: senão o que a
            // outra pessoa gravou antes contaria como edição desta.
            raiseConflict({ theirs: baseOf(res.current), fields: contested, editsBase })
            return
          }
          // Outra pessoa mexeu em outros campos: refaz por cima da versão dela.
          merged = { ...merged, ...foreignChanges(base.fields, res.current, patch) }
          base = baseOf(res.current)
          break
        }
        case 'gone':
          stoppedRef.current = 'gone'
          return fail(t('projects_card_gone'))
        case 'denied':
          stoppedRef.current = 'denied'
          ioRef.current.onDenied()
          return fail(t('projects_card_denied'))
        case 'error':
          return fail(failMessage(res.error))
      }
    }
    if (!done) return fail(t('projects_card_busy'))

    // Absorve: base e formulário juntos.
    baseRef.current = base
    ownSentRef.current = null
    carriedRef.current = carriedRef.current.filter(a => !base.fields.attachments.some(b => b.id === a.id))
    ioRef.current.onSaved(cardId, base)
    const absorbed = absorbForeign(formRef.current, sent, merged)
    const att = confirmAttachments(base.fields, removedRef.current, pendingRef.current, uploadsRef.current)
    for (const pid of att.confirmed) {
      uploadsRef.current.delete(pid)
      const file = pendingRef.current.find(p => p.id === pid)
      if (file) URL.revokeObjectURL(file.preview)
    }
    adoptForm({ ...absorbed.form, attachments: att.attachments })
    setRemoved(att.removedIds)
    setPending(att.pending)
    if (absorbed.contested.length > 0) {
      // A pessoa mexeu no meio da gravação num campo que a outra também mudou.
      raiseConflict({ theirs: base, fields: absorbed.contested, editsBase: base })
      return
    }
    if (live()) writeDraft(base)
    if (uploadFailed) fail(t('projects_attachments_upload_error'), 'upload')
    else {
      lastFailedRef.current = false
      setLiveStatus('saved')
    }
  }

  const canSave = () => canEdit && !conflictRef.current && !stoppedRef.current

  /** Pede uma gravação; com uma em voo, marca sujo e ela grava de novo ao terminar. */
  const kick = useCallback((): Promise<void> => {
    dirtyRef.current = true
    if (runningRef.current) return runningRef.current
    let run: Promise<void> | null = null
    run = (async () => {
      // Começa no próximo microtask: o `finally` só pode limpar depois de
      // `runningRef` apontar para esta rodada (senão ficava presa numa já
      // terminada, e nenhuma gravação começava mais).
      await Promise.resolve()
      try {
        while (dirtyRef.current && canSave()) {
          dirtyRef.current = false
          await runOnce()
        }
      } finally {
        if (runningRef.current === run) runningRef.current = null
      }
    })()
    runningRef.current = run
    return run
    // runOnce e canSave leem só refs.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const schedule = useCallback((immediate: boolean) => {
    if (!canEdit) return
    clearTimer()
    if (immediate) void kick()
    else timerRef.current = setTimeout(() => { timerRef.current = null; if (mountedRef.current) void kick() }, AUTOSAVE_DEBOUNCE_MS)
  }, [canEdit, kick])

  const patchForm = useCallback((updater: (f: CardForm) => CardForm, immediate = false) => {
    setForm(updater(formRef.current))
    if (live()) writeDraft()
    schedule(immediate)
  }, [setForm, writeDraft, schedule])

  const removeAttachment = useCallback((id: string) => {
    setRemoved([...removedRef.current, id])
    if (live()) writeDraft()
    schedule(true)
  }, [writeDraft, schedule])

  /**
   * 'closed': o modal já fechou (a foto terminou de comprimir depois);
   * 'full': o card chegou ao limite de anexos (conta as pendentes: várias
   * imagens coladas de uma vez, ou duas escolhas seguidas, não passam).
   */
  const addPending = useCallback((file: PendingFile): 'added' | 'closed' | 'full' => {
    if (!live()) return 'closed'
    const shown = formRef.current.attachments.filter(a => !removedRef.current.includes(a.id)).length
    if (shown + pendingRef.current.length >= ATTACHMENTS_MAX) return 'full'
    setPending([...pendingRef.current, file])
    schedule(true)
    return 'added'
  }, [schedule])

  const removePending = useCallback((id: string) => {
    const item = pendingRef.current.find(p => p.id === id)
    if (item) URL.revokeObjectURL(item.preview)
    setPending(pendingRef.current.filter(p => p.id !== id))
    // Já subiu (talvez já esteja indo para o card numa gravação em voo): sai
    // do card na próxima gravação, e o arquivo é apagado ao fechar se não ficou.
    const up = uploadsRef.current.get(id)
    if (up) {
      setRemoved([...removedRef.current, up.id])
      schedule(true)
    }
  }, [schedule])

  /** Grava o que falta e espera. true = gravado, sem aviso nem erro. */
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer()
    if (!canEdit) return true
    await kick()
    return !conflictRef.current && !stoppedRef.current && !lastFailedRef.current
  }, [canEdit, kick])

  /** Escolha no aviso: monta o formulário e grava em seguida. */
  const resolve = useCallback((choice: 'theirs' | 'mine') => {
    const current = conflictRef.current
    if (!current) return
    const next = resolveChoice(choice, current, formRef.current)
    baseRef.current = next.base
    lastFailedRef.current = false
    if (cardIdRef.current) ioRef.current.onSaved(cardIdRef.current, next.base)
    setConflict(null)
    adoptForm({ ...next.form, attachments: next.base.fields.attachments })
    if (live()) writeDraft(next.base)
    void kick()
  }, [kick, adoptForm, writeDraft])

  /**
   * Fecha a edição. O que faltou gravar vai (sem bloquear a tela), inclusive
   * num card novo cujo insert está em voo; card novo que nem começou a ser
   * criado é descartado, como antes. Quando a última gravação termina:
   * - limpa: as imagens que subiram e não entraram no card são apagadas;
   * - com aviso ou falha: o rascunho guarda a mudança, a base e essas
   *   imagens, e reabrir o card retoma (nada se perde);
   * - card apagado, sem permissão ou excluído: as imagens são apagadas.
   */
  const finish = useCallback(() => {
    const pendingSave = timerRef.current !== null || dirtyRef.current
    clearTimer()
    endedRef.current = true
    const last = pendingSave && canSave() && (baseRef.current || runningRef.current) ? kick() : runningRef.current
    void Promise.resolve(last).then(() => {
      if (!stoppedRef.current && (conflictRef.current || lastFailedRef.current)) {
        writeDraft()
        return
      }
      const orphans = (stoppedRef.current ? [...uploadsRef.current.values(), ...carriedRef.current] : unconfirmedUploads()).map(a => a.url)
      uploadsRef.current.clear()
      carriedRef.current = []
      if (orphans.length > 0) void ioRef.current.removeUploads(orphans)
    })
  }, [kick, writeDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Antes de excluir: para de gravar (espera a que está em voo). A edição no debounce fica marcada. */
  const stop = useCallback(async () => {
    if (timerRef.current) dirtyRef.current = true
    clearTimer()
    stoppedRef.current = 'deleting'
    await runningRef.current
  }, [])
  /** O DELETE falhou: volta a gravar, inclusive o que estava no debounce. */
  const resume = useCallback(() => {
    if (stoppedRef.current !== 'deleting') return
    stoppedRef.current = null
    if (dirtyRef.current) void kick()
  }, [kick])

  useEffect(() => {
    mountedRef.current = true
    // Rascunho restaurado com mudança não gravada: grava agora (a página recarregou no meio).
    if (start.pending && canEdit) void kick()
    const flushDraft = () => { if (live()) writeDraft() }
    document.addEventListener('visibilitychange', flushDraft)
    window.addEventListener('pagehide', flushDraft)
    return () => {
      mountedRef.current = false
      clearTimer()
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      document.removeEventListener('visibilitychange', flushDraft)
      window.removeEventListener('pagehide', flushDraft)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => ({
    form, removedAttachmentIds, pendingFiles, status, errorKind, conflict, descRev,
    patchForm, removeAttachment, addPending, removePending, flush, resolve, finish, stop, resume, formRef,
  }), [form, removedAttachmentIds, pendingFiles, status, errorKind, conflict, descRev, patchForm, removeAttachment, addPending, removePending, flush, resolve, finish, stop, resume])
}

export type CardEditor = ReturnType<typeof useCardEditor>

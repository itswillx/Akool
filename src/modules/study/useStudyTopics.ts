import { useCallback, useMemo, useRef, useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import * as db from '../../lib/data/study'
import type { StudyCardFieldPatch, StudyCardInput, StudyResult, StudySave, StudyTopicFieldPatch } from '../../lib/data/study'
import { findInGroups, mapWriteError, reinsertAt, runGuarded, runOptimistic, type WriteError } from '../../lib/optimistic'
import { fitImportCards, type ParsedStudyCard, type StudyParseResult } from '../../lib/studyMarkdownParser'
import type { StudyCard, StudyQuizAnswer, StudyTopic } from '../../types'
import {
  addCheckpointLocal, addResourceLocal, answerQuizLocal, editCheckpointLocal, fieldConflict, removeCheckpointLocal,
  removeResourceLocal, resetQuizLocal, saveWithRetry, toggleCheckpointLocal,
  type PendingOp, type StudyFieldOutcome, type StudyLedger,
} from './studyMutations'
import { useStudySync } from './useStudySync'

// Operações de Estudos (API-029). A tela muda na hora e grava pela camada de
// dados (src/lib/data/study.ts):
//   • item de lista (ponto, recurso, resposta) → a RPC do item, que mexe só
//     nele: o ponto que outra aba somou não some quando esta marca outro;
//   • campo escalar (título, descrição, prazo, status…) → UPDATE com a versão
//     do servidor; mudou só outra coisa, refaz com a versão nova; mudou o
//     mesmo campo desde o início da edição, recarrega e oferece "Copiar meu
//     texto";
//   • criar card, anexar .md, importar e reagendar → uma RPC cada, tudo ou nada.
// As gravações saem na hora; só a mesma chave (card + item, card + campo, ou o
// quiz do card inteiro) espera a anterior. O estado e o refetch ficam em
// useStudySync.ts.

export type StudyCardPatch = StudyCardFieldPatch
export type TopicPatch = StudyTopicFieldPatch

export interface CreateTopicForm {
  title: string
  area?: string
  level?: string
  objective?: string
  target_date?: string | null
}

export type StudyImportOutcome = { ok: true; topic: StudyTopic } | { ok: false; message: string }

/** As operações de lista de um card, já ligadas a ele (StudyCardItem). `true` = gravou. */
export interface StudyCardOps {
  addCheckpoint: (text: string, id: string) => Promise<boolean>
  editCheckpoint: (checkpointId: string, change: { text?: string; note?: string }) => Promise<boolean>
  toggleCheckpoint: (checkpointId: string) => Promise<boolean>
  addResource: (resource: { id: string; title: string; url: string }) => Promise<boolean>
  removeResource: (resourceId: string) => Promise<boolean>
  answerQuiz: (questionId: string, answer: StudyQuizAnswer | number) => Promise<boolean>
  resetQuiz: (onlyWrong: boolean) => Promise<boolean>
}

const toCardInput = (card: ParsedStudyCard): StudyCardInput => ({
  title: card.title, description: card.description, rationale: card.rationale,
  checkpoints: card.checkpoints, resources: card.resources, quiz: card.quiz,
})

/** A chave da fila de um campo escalar: o mesmo campo espera a gravação anterior. */
const fieldKey = (patch: object) => `f:${Object.keys(patch).sort().join(',')}`

/** O que muda entre card e tópico na gravação dos campos escalares. */
interface FieldTarget<T extends { id: string; updated_at: string }, P extends Partial<T>> {
  book: StudyLedger<T>
  begin: (id: string, op: PendingOp<T>) => void
  end: (id: string, op: PendingOp<T>, row?: T | null) => void
  save: (id: string, patch: P, version: string) => Promise<StudySave<T>>
  /** A linha não existe mais no servidor. */
  gone: (id: string) => void
  conflict: TranslationKey
  dedupeKey: string
  label: string
}

async function settled<T>(call: () => PromiseLike<StudyResult<T>>): Promise<StudyResult<T>> {
  try {
    return await call()
  } catch (thrown) {
    // Defensivo: o supabase-js não lança, mas um transporte custom pode.
    return { data: null, error: { message: thrown instanceof Error ? thrown.message : String(thrown) } }
  }
}

export function useStudyTopics(userId: string | undefined) {
  const sync = useStudySync(userId)
  const { cards, topicBook, tracker, bases, topicsRef, cardsRef, logsRef, setTopics, setCards, setLogs } = sync
  const { showCard, showTopic, addCards, addTopic, dropCard, markTopicGone, beginCard, endCard, beginTopic, endTopic } = sync
  const { showToast } = useToast()
  const { t } = useLanguage()

  // PGRST202: o front saiu antes da migration do API-024. O módulo para de
  // tentar as RPCs (aviso fixo na tela; listas, importar e reagendar
  // desligados) até recarregar. Sem volta para gravar a lista inteira, que
  // traria o bug de volta.
  const [serverOutdated, setServerOutdatedState] = useState(false)
  const outdatedRef = useRef(false)
  const markOutdated = useCallback(() => {
    outdatedRef.current = true
    setServerOutdatedState(true)
  }, [])

  // dedupeKey por OPERAÇÃO (não por mensagem): uma rajada offline abre um aviso só.
  const toastError = useCallback((error: WriteError, fallbackKey: TranslationKey, dedupeKey: string) => {
    const kind = db.studyErrorKind(error)
    if (kind === 'outdated') {
      markOutdated()
      showToast('error', t('study_error_server_outdated'), { dedupeKey: 'study:outdated' })
      return
    }
    showToast('error', kind === 'invalid' ? t('toast_error_invalid') : mapWriteError(error, t, fallbackKey), { dedupeKey })
  }, [markOutdated, showToast, t])

  /** O texto que a pessoa digitou volta pela ação "Copiar meu texto" do aviso. */
  const notifyConflict = useCallback((key: TranslationKey, patch: object) => {
    const mine = Object.values(patch).filter((value): value is string => typeof value === 'string' && value !== '').join('\n\n')
    const copy = () => {
      void navigator.clipboard?.writeText(mine).catch(error => console.error('[study] copiar o texto', error))
    }
    showToast('warning', t(key), {
      dedupeKey: `study:${key}`,
      duration: 12000,
      ...(mine ? { action: { label: t('study_conflict_copy'), onClick: copy } } : {}),
    })
  }, [showToast, t])

  /**
   * O tópico não existe mais (P0002 numa RPC dele, ou a gravação com versão
   * sem linha): sai da tela com cards e diário, e o aberto vira o aviso.
   */
  const topicGone = useCallback((topicId: string) => {
    markTopicGone(topicId)
    showToast('info', t('study_topic_deleted_elsewhere'), { dedupeKey: 'study:topic-gone' })
  }, [markTopicGone, showToast, t])

  /** Relê o card depois de P0002/P0001: adota a linha, ou o tira da tela se não existe mais. */
  const rereadCard = useCallback(async (cardId: string): Promise<'here' | 'gone' | 'error'> => {
    const fresh = await settled(() => db.getStudyCard(cardId))
    if (fresh.error) return 'error'
    if (!fresh.data) {
      dropCard(cardId)
      return 'gone'
    }
    cards.adopt(fresh.data)
    showCard(cardId)
    return 'here'
  }, [cards, dropCard, showCard])

  /**
   * Uma operação de item: espelho na hora, RPC na fila da chave, linha nova
   * adotada. P0002 (o item ou o card sumiu) relê o card: numa remoção é
   * sucesso calado, nas outras um aviso. P0001 (já respondida) relê e avisa.
   */
  const runItem = useCallback(async (
    cardId: string,
    key: string,
    apply: (card: StudyCard) => StudyCard,
    call: () => PromiseLike<StudyResult<StudyCard>>,
    removal = false,
  ): Promise<boolean> => {
    if (outdatedRef.current || !cards.base(cardId)) return false
    const op: PendingOp<StudyCard> = { apply }
    beginCard(cardId, op)
    const res = await tracker.serial(`${cardId}:${key}`, () => settled(call))
    endCard(cardId, op, res.data)
    if (res.data) return true
    const error = res.error ?? { message: 'sem resposta' }
    const kind = db.studyErrorKind(error)
    if (kind === 'missing' || kind === 'answered') {
      // O servidor já disse o que houve; a releitura só traz o card de lá.
      const where = await rereadCard(cardId)
      if (kind === 'missing' && removal && where !== 'gone') return true
      const message = kind === 'answered' ? 'study_quiz_already_answered' : 'study_item_gone'
      showToast('info', t(message), { dedupeKey: `study:${message}` })
      return false
    }
    console.error(`[study] ${key}`, error)
    toastError(error, 'study_error_generic', 'study:card-save')
    return false
  }, [cards, tracker, beginCard, endCard, rereadCard, showToast, t, toastError])

  const addCheckpoint = useCallback((cardId: string, point: { id: string; text: string }) =>
    runItem(cardId, `cp:${point.id}`, card => addCheckpointLocal(card, point), () => db.addCheckpoint(cardId, point)), [runItem])

  const editCheckpoint = useCallback((cardId: string, checkpointId: string, change: { text?: string; note?: string }) =>
    runItem(cardId, `cp:${checkpointId}`, card => editCheckpointLocal(card, checkpointId, change),
      () => db.editCheckpoint(cardId, checkpointId, change)), [runItem])

  // O valor vai explícito: repetir não inverte de novo.
  const toggleCheckpoint = useCallback(async (cardId: string, checkpointId: string) => {
    const point = cards.view(cardId)?.checkpoints.find(p => p.id === checkpointId)
    if (!point) return false
    const completed = !point.completed
    return runItem(cardId, `cp:${checkpointId}`, card => toggleCheckpointLocal(card, checkpointId, completed),
      () => db.toggleCheckpoint(cardId, checkpointId, completed))
  }, [cards, runItem])

  const removeCheckpoint = useCallback((cardId: string, checkpointId: string) =>
    runItem(cardId, `cp:${checkpointId}`, card => removeCheckpointLocal(card, checkpointId),
      () => db.removeCheckpoint(cardId, checkpointId), true), [runItem])

  const addResource = useCallback((cardId: string, resource: { id: string; title: string; url: string }) =>
    runItem(cardId, `res:${resource.id}`, card => addResourceLocal(card, resource), () => db.addResource(cardId, resource)), [runItem])

  const removeResource = useCallback((cardId: string, resourceId: string) =>
    runItem(cardId, `res:${resourceId}`, card => removeResourceLocal(card, resourceId),
      () => db.removeResource(cardId, resourceId), true), [runItem])

  // Responder e reiniciar ficam numa fila só por card: o reinício mexe em
  // todas as perguntas, e a resposta dada depois dele (com a tela já zerada)
  // não pode chegar antes e levar P0001; nem o reinício, antes da resposta
  // que ele devia zerar. As duas RPCs travam a mesma linha do card.
  const answerQuiz = useCallback((cardId: string, questionId: string, answer: StudyQuizAnswer | number) =>
    runItem(cardId, 'quiz', card => answerQuizLocal(card, questionId, answer),
      () => db.answerQuiz(cardId, questionId, answer)), [runItem])

  const resetQuiz = useCallback((cardId: string, onlyWrong: boolean) =>
    runItem(cardId, 'quiz', card => resetQuizLocal(card, onlyWrong), () => db.resetQuiz(cardId, onlyWrong)), [runItem])

  /**
   * Campos escalares (card ou tópico). `base` é o valor do campo no início da
   * edição (foco, abrir o texto): sem ele (prazo, status, gravados no
   * onChange) a última gravação vale. A pré-checagem compara com o que a linha
   * terá quando as gravações próprias pendentes chegarem: a segunda mudança
   * seguida do mesmo campo não é conflito. Na hora de sair da fila, confere de
   * novo: a gravação anterior do mesmo campo, que esta esperou, pode ter dado
   * conflito (e trazido o texto de lá) ou falhado (e esta herda a base dela,
   * se partiu do texto dela: StudyFieldBases). Toda saída apaga a herança da
   * chave, menos a falha, que deixa a sua.
   */
  const saveFields = useCallback(async <T extends { id: string; updated_at: string }, P extends Partial<T>>(
    target: FieldTarget<T, P>, id: string, patch: P, base?: P,
  ): Promise<StudyFieldOutcome> => {
    const key = `${id}:${fieldKey(patch)}`
    const pick = (current: T) => bases.pick(key, current, base, patch)
    const expected = target.book.view(id)
    const before = expected && pick(expected)
    if (!expected || (before && fieldConflict(expected, before, patch))) {
      bases.settle(key)
      if (expected) notifyConflict(target.conflict, patch)
      return 'conflict'
    }
    const op: PendingOp<T> = { apply: row => ({ ...row, ...patch }) }
    target.begin(id, op)
    const result = await tracker.serial(key, async (): Promise<StudySave<T>> => {
      const known = target.book.base(id)
      const used = known && pick(known)
      let outcome: StudySave<T>
      if (!known) outcome = { status: 'gone' }
      else if (used && fieldConflict(known, used, patch)) outcome = { status: 'conflict', current: known }
      else {
        try {
          // Cada linha relida refaz a escolha: só é conflito se o servidor não
          // está na base própria, na herdada (se houver) nem no patch.
          outcome = await saveWithRetry<T>(version => target.save(id, patch, version), known.updated_at, patch, base && pick,
            current => { target.book.adopt(current) })
        } catch (thrown) {
          outcome = { status: 'error', error: { message: String(thrown) } }
        }
      }
      // A que falhou deixa para a seguinte a base com que saiu, presa ao texto
      // dela, escolhida de novo com a última linha relida: a de antes da
      // releitura pode já ter saído do servidor.
      const failed = outcome.status === 'error' || outcome.status === 'denied'
      const last = known && (target.book.base(id) ?? known)
      bases.settle(key, failed && used && base && last ? { base: pick(last) ?? used, value: patch, own: base } : undefined)
      return outcome
    })
    target.end(id, op, result.status === 'saved' ? result.row : null)
    switch (result.status) {
      case 'saved': return 'saved'
      case 'conflict':
        notifyConflict(target.conflict, patch)
        return 'conflict'
      case 'gone':
        target.gone(id)
        return 'conflict'
      case 'denied':
        showToast('error', t('toast_error_permission'), { dedupeKey: target.dedupeKey })
        return 'failed'
      default:
        console.error(`[study] ${target.label}`, result.error)
        toastError(result.error, 'study_error_generic', target.dedupeKey)
        return 'failed'
    }
  }, [bases, tracker, notifyConflict, showToast, t, toastError])

  const cardFields = useMemo((): FieldTarget<StudyCard, StudyCardPatch> => ({
    book: cards, begin: beginCard, end: endCard, save: db.saveCardFields, conflict: 'study_card_conflict',
    gone: id => {
      dropCard(id)
      showToast('info', t('study_item_gone'), { dedupeKey: 'study:study_item_gone' })
    },
    dedupeKey: 'study:card-save', label: 'updateCard',
  }), [cards, beginCard, endCard, dropCard, showToast, t])

  /** Não manda datas nem versão: o gatilho study_topics_rules preenche started_at e completed_at pelo status, e a linha que volta traz as duas. */
  const topicFields = useMemo((): FieldTarget<StudyTopic, TopicPatch> => ({
    book: topicBook, begin: beginTopic, end: endTopic, save: db.saveTopicFields, conflict: 'study_topic_conflict',
    gone: topicGone, dedupeKey: 'study:topic-save', label: 'updateTopic',
  }), [topicBook, beginTopic, endTopic, topicGone])

  const updateCard = useCallback((cardId: string, patch: StudyCardPatch, base?: StudyCardPatch) =>
    saveFields(cardFields, cardId, patch, base), [saveFields, cardFields])

  const updateTopic = useCallback((id: string, patch: TopicPatch, base?: TopicPatch) =>
    saveFields(topicFields, id, patch, base), [saveFields, topicFields])

  const createTopicManual = useCallback(async (form: CreateTopicForm): Promise<StudyTopic | null> => {
    if (!userId) return null
    const res = await runGuarded(
      () => db.insertTopic(userId, {
        title: form.title.trim(),
        area: form.area?.trim() ?? '',
        level: form.level?.trim() ?? '',
        objective: form.objective?.trim() ?? '',
        target_date: form.target_date ?? null,
      }),
      { label: 'createTopicManual', onError: error => toastError(error, 'study_error_create', 'study:create') },
    )
    if (!res.ok || !res.data) return null
    addTopic(res.data)
    return res.data
  }, [userId, addTopic, toastError])

  /** A mensagem de uma importação recusada: o card N e o título; o motivo (pt-BR) vai ao console. */
  const importMessage = useCallback((error: WriteError | null, input: readonly StudyCardInput[]): string => {
    if (!error) return t('study_error_generic')
    if (db.studyErrorKind(error) === 'outdated') {
      markOutdated()
      return t('study_error_server_outdated')
    }
    const failed = db.importErrorCard(error, input)
    console.error('[study] importação recusada', failed?.reason ?? error)
    if (failed) return t('study_error_import_card', { n: failed.n, title: failed.title || t('study_card_untitled') })
    return db.studyErrorKind(error) === 'invalid' ? t('toast_error_invalid') : mapWriteError(error, t, 'study_error_create')
  }, [markOutdated, t])

  // O formulário vence os metadados do .md; o .md preenche o que ficou em
  // branco. Com meta, o servidor distribui os prazos dos cards até ela (o
  // "cronograma"), na mesma transação.
  const createTopicFromImport = useCallback(async (parsed: StudyParseResult, form: CreateTopicForm): Promise<StudyImportOutcome> => {
    const topic = {
      title: form.title.trim() || parsed.topic.title || '',
      area: form.area?.trim() || parsed.topic.area || '',
      level: form.level?.trim() || parsed.topic.level || '',
      objective: form.objective?.trim() || parsed.topic.objective || '',
      target_date: form.target_date ?? null,
    }
    if (!topic.title) return { ok: false, message: t('study_error_generic') }
    if (outdatedRef.current) return { ok: false, message: t('study_error_server_outdated') }
    const input = parsed.cards.map(toCardInput)
    // O parser já cortou medindo com o tópico do .md; o do formulário pode ser maior.
    if (fitImportCards(input, topic).cards.length < input.length) return { ok: false, message: t('study_error_import_too_large') }
    const res = await settled(() => db.importStudyTopic({ topic, cards: input }))
    if (!res.data) return { ok: false, message: importMessage(res.error, input) }
    addTopic(res.data.topic)
    addCards(res.data.cards)
    return { ok: true, topic: res.data.topic }
  }, [addTopic, addCards, importMessage, t])

  const deleteTopic = useCallback(async (id: string) => {
    const index = topicsRef.current.findIndex(topic => topic.id === id)
    if (index === -1) return
    const topic = topicsRef.current[index]
    const topicCards = cardsRef.current[id]
    const topicLogs = logsRef.current[id]
    // A FK em cascata leva cards e diário no servidor: o refetch não os traz de volta.
    const ids = [id, ...(topicCards ?? []).map(card => card.id), ...(topicLogs ?? []).map(log => log.id)]
    const ok = await runOptimistic({
      label: 'deleteTopic',
      apply: () => {
        ids.forEach(item => tracker.removing(item))
        setTopics(prev => prev.filter(item => item.id !== id))
        setCards(prev => { const next = { ...prev }; delete next[id]; return next })
        setLogs(prev => { const next = { ...prev }; delete next[id]; return next })
      },
      write: () => db.deleteTopic(id),
      revert: () => {
        ids.forEach(item => tracker.restored(item))
        setTopics(prev => reinsertAt(prev, topicBook.view(id) ?? topic, index))
        if (topicCards) setCards(prev => (prev[id] ? prev : { ...prev, [id]: topicCards.map(card => cards.view(card.id) ?? card) }))
        if (topicLogs) setLogs(prev => (prev[id] ? prev : { ...prev, [id]: topicLogs }))
      },
      onError: error => toastError(error, 'study_error_delete', 'study:delete'),
    })
    if (!ok) return
    ids.forEach(item => tracker.removed(item))
    topicBook.forget(id)
    for (const card of topicCards ?? []) cards.forget(card.id)
  }, [cards, topicBook, tracker, topicsRef, cardsRef, logsRef, setTopics, setCards, setLogs, toastError])

  // A posição do card novo é do servidor (max + 1 sob a trava do tópico).
  const createCard = useCallback(async (topicId: string): Promise<boolean> => {
    if (outdatedRef.current) return false
    const res = await settled(() => db.appendStudyCards(topicId, [{ title: '' }]))
    if (!res.data) {
      const error = res.error ?? { message: 'sem resposta' }
      // P0002 nas RPCs do tópico: ele foi excluído em outra aba ou pela API.
      if (db.studyErrorKind(error) === 'missing') topicGone(topicId)
      else toastError(error, 'study_error_create', 'study:create')
      return false
    }
    addCards(res.data)
    return true
  }, [addCards, toastError, topicGone])

  /** Anexa os cards do .md (o parser já cortou no teto). A mensagem vai para o modal, sem aviso a mais. */
  const appendCards = useCallback(async (topicId: string, parsedCards: ParsedStudyCard[]): Promise<{ count: number; message?: string }> => {
    if (outdatedRef.current) return { count: 0, message: t('study_error_server_outdated') }
    const input = parsedCards.map(toCardInput)
    const res = await settled(() => db.appendStudyCards(topicId, input))
    if (db.studyErrorKind(res.error) === 'missing') {
      topicGone(topicId)
      return { count: 0, message: t('study_topic_deleted_elsewhere') }
    }
    if (!res.data) return { count: 0, message: importMessage(res.error, input) }
    addCards(res.data)
    return { count: res.data.length }
  }, [addCards, importMessage, t, topicGone])

  const deleteCard = useCallback(async (cardId: string) => {
    const found = findInGroups(cardsRef.current, cardId)
    if (!found) return
    const { groupId: topicId, index, row } = found
    const ok = await runOptimistic({
      label: 'deleteCard',
      apply: () => {
        tracker.removing(cardId)
        setCards(prev => ({ ...prev, [topicId]: (prev[topicId] ?? []).filter(card => card.id !== cardId) }))
      },
      write: () => db.deleteCard(cardId),
      revert: () => {
        tracker.restored(cardId)
        setCards(prev => ({ ...prev, [topicId]: reinsertAt(prev[topicId] ?? [], cards.view(cardId) ?? row, index) }))
      },
      onError: error => toastError(error, 'study_error_delete', 'study:delete'),
    })
    if (!ok) return
    tracker.removed(cardId)
    cards.forget(cardId)
  }, [cards, tracker, cardsRef, setCards, toastError])

  /** P0001 no reagendar: outra aba tirou a meta. Relê o tópico (o botão some com a meta) e avisa. */
  const lostTarget = useCallback(async (topicId: string) => {
    const fresh = await settled(() => db.getStudyTopic(topicId))
    if (!fresh.error && !fresh.data) {
      topicGone(topicId)
      return
    }
    if (fresh.data && topicBook.adopt(fresh.data)) showTopic(topicId)
    showToast('info', t('study_reschedule_no_target'), { dedupeKey: 'study:reschedule-no-target' })
  }, [topicBook, showTopic, showToast, t, topicGone])

  /**
   * "Recalcular cronograma": o servidor distribui os prazos até a meta e
   * devolve todos os cards. Cada linha entra na cadeia de versões do card: no
   * card com gravação pendente, o prazo novo aparece com a pendente por cima,
   * e a gravação dele refaz com a versão nova.
   */
  const rescheduleCards = useCallback(async (topicId: string): Promise<boolean> => {
    if (outdatedRef.current || !topicBook.view(topicId)?.target_date) return false
    const res = await settled(() => db.rescheduleStudyTopic(topicId))
    if (!res.data) {
      const error = res.error ?? { message: 'sem resposta' }
      const kind = db.studyErrorKind(error)
      if (kind === 'missing') topicGone(topicId)
      else if (kind === 'answered') await lostTarget(topicId)
      else toastError(error, 'study_error_generic', 'study:reschedule')
      return false
    }
    const fresh: StudyCard[] = []
    for (const row of res.data) {
      if (tracker.isRemoved(row.id)) continue
      if (!cards.base(row.id)) { fresh.push(row); continue }
      tracker.mark(row.id)
      if (cards.adopt(row)) showCard(row.id)
    }
    addCards(fresh)
    return true
  }, [cards, topicBook, tracker, addCards, showCard, toastError, topicGone, lostTarget])

  const addLog = useCallback(async (topicId: string, content: string) => {
    if (!userId) return
    const res = await runGuarded(
      () => db.insertLog(userId, topicId, content),
      { label: 'addLog', onError: error => toastError(error, 'study_error_create', 'study:create') },
    )
    if (!res.ok || !res.data) return
    const log = res.data
    tracker.mark(log.id)
    setLogs(prev => ({ ...prev, [topicId]: [log, ...(prev[topicId] ?? [])] }))
  }, [userId, tracker, setLogs, toastError])

  const deleteLog = useCallback(async (logId: string) => {
    const found = findInGroups(logsRef.current, logId)
    if (!found) return
    const { groupId: topicId, index, row } = found
    const ok = await runOptimistic({
      label: 'deleteLog',
      apply: () => {
        tracker.removing(logId)
        setLogs(prev => ({ ...prev, [topicId]: (prev[topicId] ?? []).filter(log => log.id !== logId) }))
      },
      write: () => db.deleteLog(logId),
      revert: () => {
        tracker.restored(logId)
        setLogs(prev => ({ ...prev, [topicId]: reinsertAt(prev[topicId] ?? [], row, index) }))
      },
      onError: error => toastError(error, 'study_error_delete', 'study:delete'),
    })
    if (ok) tracker.removed(logId)
  }, [tracker, logsRef, setLogs, toastError])

  return {
    topics: sync.topics,
    cardsByTopic: sync.cardsByTopic,
    logsByTopic: sync.logsByTopic,
    loading: sync.loading,
    goneTopicIds: sync.goneTopicIds,
    serverOutdated,
    createTopicManual,
    createTopicFromImport,
    updateTopic,
    deleteTopic,
    createCard,
    updateCard,
    addCheckpoint,
    editCheckpoint,
    toggleCheckpoint,
    removeCheckpoint,
    addResource,
    removeResource,
    answerQuiz,
    resetQuiz,
    deleteCard,
    appendCards,
    rescheduleCards,
    addLog,
    deleteLog,
  }
}

export type StudyStore = ReturnType<typeof useStudyTopics>

/** As operações de lista de um card, ligadas a ele, para o StudyCardItem. */
export function bindCardOps(store: StudyStore, cardId: string): StudyCardOps {
  return {
    addCheckpoint: (text, id) => store.addCheckpoint(cardId, { id, text }),
    editCheckpoint: (checkpointId, change) => store.editCheckpoint(cardId, checkpointId, change),
    toggleCheckpoint: checkpointId => store.toggleCheckpoint(cardId, checkpointId),
    addResource: resource => store.addResource(cardId, resource),
    removeResource: resourceId => store.removeResource(cardId, resourceId),
    answerQuiz: (questionId, answer) => store.answerQuiz(cardId, questionId, answer),
    resetQuiz: onlyWrong => store.resetQuiz(cardId, onlyWrong),
  }
}

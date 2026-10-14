import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { listStudy } from '../../lib/data/study'
import type { StudyCard, StudyLog, StudyTopic } from '../../types'
import {
  compareCardOrder, mergeRefetch, StudyFieldBases, StudyLedger, StudyWriteTracker, type PendingOp, type RefetchGuard,
} from './studyMutations'

// API-029: o estado de Estudos e a sincronização com o servidor. A carga
// inicial, o refetch ao voltar o foco ou a visibilidade da aba (antes a tela
// carregava uma vez só e regravava listas a partir de estado velho) e o livro
// de cada linha (StudyLedger): a tela mostra a última linha do servidor com
// as gravações desta aba ainda em voo por cima. As operações ficam em
// useStudyTopics.ts.

/** Intervalo mínimo entre dois refetches; o pedido no meio vira uma rodada no fim do intervalo. */
export const STUDY_REFETCH_GAP_MS = 5000

/**
 * Pedido até este tempo depois do início do refetch em voo é o mesmo retorno à
 * aba (visibilitychange e focus chegam juntos): não pede outra rodada.
 */
export const STUDY_REFETCH_SAME_RETURN_MS = 1000

function groupCards(rows: readonly StudyCard[]): Record<string, StudyCard[]> {
  const out: Record<string, StudyCard[]> = {}
  for (const row of rows) (out[row.topic_id] ??= []).push(row)
  for (const list of Object.values(out)) list.sort(compareCardOrder)
  return out
}

function groupLogs(rows: readonly StudyLog[]): Record<string, StudyLog[]> {
  const out: Record<string, StudyLog[]> = {}
  for (const row of rows) (out[row.topic_id] ??= []).push(row)
  return out
}

export function useStudySync(userId: string | undefined) {
  const [topics, setTopicsState] = useState<StudyTopic[]>([])
  const [cardsByTopic, setCardsState] = useState<Record<string, StudyCard[]>>({})
  const [logsByTopic, setLogsState] = useState<Record<string, StudyLog[]>>({})
  const [loading, setLoading] = useState(true)
  // Tópicos que um refetch não trouxe mais (excluídos em outra aba): a tela
  // avisa se um deles estava aberto.
  const [goneTopicIds, setGoneTopicIds] = useState<ReadonlySet<string>>(() => new Set())
  const { showToast } = useToast()
  const { t } = useLanguage()

  // Setters lastreados em ref: `ref.current` muda SINCRONAMENTE, então uma
  // operação que lê, aguarda a rede e recalcula vê as linhas como estão agora,
  // mesmo numa rajada no mesmo tick. TODA escrita nesses três estados passa
  // por aqui; nunca chame set*State direto.
  const topicsRef = useRef<StudyTopic[]>([])
  const cardsRef = useRef<Record<string, StudyCard[]>>({})
  const logsRef = useRef<Record<string, StudyLog[]>>({})
  // A carga inicial terminou, com sucesso ou não: só então o refetch roda (ele
  // não corre com a carga). Depois de uma carga que falhou, o refetch seguinte
  // é a nova tentativa (com a tela vazia, ele equivale a uma carga).
  const settledRef = useRef(false)
  const [cards] = useState(() => new StudyLedger<StudyCard>())
  const [topicBook] = useState(() => new StudyLedger<StudyTopic>())
  const [tracker] = useState(() => new StudyWriteTracker())
  // A base herdada das gravações de campo que falharam (StudyFieldBases): as
  // gravações ficam em useStudyTopics; o refetch encerra a herança.
  const [bases] = useState(() => new StudyFieldBases())

  const setTopics = useCallback((fn: (prev: StudyTopic[]) => StudyTopic[]) => {
    topicsRef.current = fn(topicsRef.current)
    setTopicsState(topicsRef.current)
  }, [])
  const setCards = useCallback((fn: (prev: Record<string, StudyCard[]>) => Record<string, StudyCard[]>) => {
    cardsRef.current = fn(cardsRef.current)
    setCardsState(cardsRef.current)
  }, [])
  const setLogs = useCallback((fn: (prev: Record<string, StudyLog[]>) => Record<string, StudyLog[]>) => {
    logsRef.current = fn(logsRef.current)
    setLogsState(logsRef.current)
  }, [])

  /** Põe na tela o card como o livro o vê. Card fora da tela (excluído, ainda não mostrado) não volta. */
  const showCard = useCallback((id: string) => {
    const row = cards.view(id)
    if (!row || tracker.isRemoved(id)) return
    setCards(prev => {
      const group = prev[row.topic_id] ?? []
      const index = group.findIndex(card => card.id === id)
      if (index === -1) return prev
      const next = [...group]
      next[index] = row
      return { ...prev, [row.topic_id]: next }
    })
  }, [cards, tracker, setCards])

  const showTopic = useCallback((id: string) => {
    const row = topicBook.view(id)
    if (!row || tracker.isRemoved(id)) return
    setTopics(prev => (prev.some(topic => topic.id === id) ? prev.map(topic => (topic.id === id ? row : topic)) : prev))
  }, [topicBook, tracker, setTopics])

  /** Cards que o servidor acabou de criar: entram no livro e na tela, na ordem do roteiro. */
  const addCards = useCallback((rows: readonly StudyCard[]) => {
    const fresh = rows.filter(row => !tracker.isRemoved(row.id))
    if (fresh.length === 0) return
    for (const row of fresh) {
      cards.replace(row)
      tracker.mark(row.id)
    }
    setCards(prev => {
      const next = { ...prev }
      for (const row of fresh) {
        const group = (next[row.topic_id] ?? []).filter(card => card.id !== row.id)
        next[row.topic_id] = [...group, row]
      }
      for (const topicId of new Set(fresh.map(row => row.topic_id))) next[topicId] = [...next[topicId]].sort(compareCardOrder)
      return next
    })
  }, [cards, tracker, setCards])

  const addTopic = useCallback((row: StudyTopic) => {
    topicBook.replace(row)
    tracker.mark(row.id)
    setTopics(prev => [row, ...prev.filter(topic => topic.id !== row.id)])
  }, [topicBook, tracker, setTopics])

  /**
   * O card não existe mais no servidor: sai do livro e da tela, e fica
   * "removido" para o refetch em voo, que o leu antes, não o trazer de volta.
   */
  const dropCard = useCallback((id: string) => {
    const topicId = cards.base(id)?.topic_id
    tracker.removed(id)
    cards.forget(id)
    if (!topicId) return
    setCards(prev => ({ ...prev, [topicId]: (prev[topicId] ?? []).filter(card => card.id !== id) }))
  }, [cards, tracker, setCards])

  const dropTopic = useCallback((id: string) => {
    topicBook.forget(id)
    setTopics(prev => prev.filter(topic => topic.id !== id))
  }, [topicBook, setTopics])

  /**
   * O servidor disse que o tópico não existe mais (P0002 numa RPC dele, ou a
   * gravação sem linha): sai com os cards e o diário, que a FK em cascata
   * levou, e o aberto vira o aviso "excluído em outra aba", como no refetch.
   * Tudo fica "removido", como no deleteTopic: o refetch em voo, que leu antes
   * da exclusão, não traz de volta o tópico, os cards nem o diário.
   */
  const markTopicGone = useCallback((id: string) => {
    const topicCards = cardsRef.current[id] ?? []
    for (const item of [id, ...topicCards.map(card => card.id), ...(logsRef.current[id] ?? []).map(log => log.id)]) tracker.removed(item)
    for (const card of topicCards) cards.forget(card.id)
    dropTopic(id)
    const without = <T,>(prev: Record<string, T[]>) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    }
    setCards(without)
    setLogs(without)
    setGoneTopicIds(prev => (prev.has(id) ? prev : new Set([...prev, id])))
  }, [cards, tracker, dropTopic, setCards, setLogs])

  // Gravação própria em voo: o livro guarda o espelho, o registro conta a
  // escrita (o refetch não a pisa) e a tela mostra o resultado esperado.
  const beginCard = useCallback((id: string, op: PendingOp<StudyCard>) => {
    cards.push(id, op)
    tracker.begin(id)
    showCard(id)
  }, [cards, tracker, showCard])

  /** Fim da gravação: sai o espelho, entra a linha nova (se mais nova) e a tela recalcula. */
  const endCard = useCallback((id: string, op: PendingOp<StudyCard>, row?: StudyCard | null) => {
    cards.pop(id, op)
    if (row && !tracker.isRemoved(row.id)) cards.adopt(row)
    tracker.end(id)
    showCard(id)
  }, [cards, tracker, showCard])

  const beginTopic = useCallback((id: string, op: PendingOp<StudyTopic>) => {
    topicBook.push(id, op)
    tracker.begin(id)
    showTopic(id)
  }, [topicBook, tracker, showTopic])

  const endTopic = useCallback((id: string, op: PendingOp<StudyTopic>, row?: StudyTopic | null) => {
    topicBook.pop(id, op)
    if (row && !tracker.isRemoved(row.id)) topicBook.adopt(row)
    tracker.end(id)
    showTopic(id)
  }, [topicBook, tracker, showTopic])

  // O aviso de carga lê toast/idioma por ref: trocar o idioma não recarrega.
  const notifyRef = useRef({ showToast, t })
  useEffect(() => { notifyRef.current = { showToast, t } }, [showToast, t])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    settledRef.current = false
    // QA-001: leitura que falhou não vira "nenhum tópico" (a tela convidaria a
    // recriar tudo) nem deixa o carregamento girando para sempre.
    void listStudy(userId).then(snapshot => {
      if (cancelled) return
      settledRef.current = true
      if (snapshot.error) {
        console.error('study load error:', snapshot.error)
        notifyRef.current.showToast('error', notifyRef.current.t('study_load_error'), { dedupeKey: 'study:load' })
        setLoading(false)
        return
      }
      for (const row of snapshot.topics) topicBook.replace(row)
      for (const row of snapshot.cards) cards.replace(row)
      setTopics(() => snapshot.topics)
      setCards(() => groupCards(snapshot.cards))
      setLogs(() => groupLogs(snapshot.logs))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId, cards, topicBook, setTopics, setCards, setLogs])

  /**
   * Relê tudo sem tela de carregando e sem aviso (falha de fundo vai só para o
   * console). Não pisa no que esta aba gravou ou ainda grava depois que o
   * refetch saiu (mergeRefetch); nas linhas protegidas, a versão que veio
   * entra no livro se for mais nova, com as pendentes por cima. `alive` diz
   * se o efeito que o pediu ainda vale: a resposta que chega depois do
   * desmonte (ou da troca de usuário) é descartada.
   */
  const refetch = useCallback(async (alive: () => boolean) => {
    if (!userId || !settledRef.current) return
    const since = tracker.now()
    const snapshot = await listStudy(userId)
    if (!alive()) return
    if (snapshot.error) {
      console.error('[study] refetch', snapshot.error)
      return
    }
    const guard: RefetchGuard = { keepLocal: id => tracker.keepLocal(id, since), removed: id => tracker.isRemoved(id) }
    // Card e diário de tópico removido também não voltam, mesmo os que esta aba
    // nunca viu (criados em outra aba antes da exclusão).
    const live = <T extends { topic_id: string }>(rows: readonly T[]) => rows.filter(row => !tracker.isRemoved(row.topic_id))
    const sync = <T extends { id: string; updated_at: string }>(book: StudyLedger<T>, local: readonly T[], server: readonly T[]) => {
      const merged = mergeRefetch(local, server, guard)
      for (const row of server) {
        if (guard.removed(row.id)) continue
        // O valor de uma gravação que falhou está no servidor: a herança acaba.
        bases.seen(row.id, row)
        if (guard.keepLocal(row.id)) book.adopt(row)
        else book.replace(row)
      }
      for (const row of merged.gone) book.forget(row.id)
      return { rows: merged.rows.map(row => (guard.keepLocal(row.id) ? book.view(row.id) ?? row : row)), gone: merged.gone }
    }
    const topicSync = sync(topicBook, topicsRef.current, snapshot.topics)
    const cardSync = sync(cards, Object.values(cardsRef.current).flat(), live(snapshot.cards))
    const logRows = mergeRefetch(Object.values(logsRef.current).flat(), live(snapshot.logs), guard).rows
    setTopics(() => topicSync.rows)
    setCards(() => groupCards(cardSync.rows))
    setLogs(() => groupLogs(logRows))
    tracker.expireRemoved(since)
    if (topicSync.gone.length > 0) setGoneTopicIds(prev => new Set([...prev, ...topicSync.gone.map(row => row.id)]))
  }, [userId, cards, topicBook, tracker, bases, setTopics, setCards, setLogs])

  // Ao voltar o foco da janela ou a visibilidade da aba, no padrão do
  // useViewedMonthBudgets. No máximo um a cada STUDY_REFETCH_GAP_MS, sem
  // reentrar; o pedido no meio do intervalo vira uma rodada no fim dele (a
  // troca rápida de janela também traz o card criado na outra), menos o que
  // chega junto com o início do refetch em voo (o mesmo retorno à aba). Depois
  // da limpeza (desmonte, troca de usuário) nada reagenda.
  useEffect(() => {
    if (!userId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    let again = false
    let last = Date.now()
    const alive = () => !disposed
    // Toda rodada passa por aqui (evento, timer, o fim do refetch em voo): a
    // guarda do `disposed` basta para nada reagendar depois da limpeza.
    const trigger = () => {
      if (disposed || document.visibilityState === 'hidden') return
      if (running) {
        if (Date.now() - last >= STUDY_REFETCH_SAME_RETURN_MS) again = true
        return
      }
      const wait = last + STUDY_REFETCH_GAP_MS - Date.now()
      if (wait > 0) {
        timer ??= setTimeout(() => { timer = undefined; trigger() }, wait)
        return
      }
      running = true
      last = Date.now()
      void refetch(alive).finally(() => {
        running = false
        if (again) { again = false; trigger() }
      })
    }
    window.addEventListener('focus', trigger)
    document.addEventListener('visibilitychange', trigger)
    return () => {
      disposed = true
      window.removeEventListener('focus', trigger)
      document.removeEventListener('visibilitychange', trigger)
      if (timer) clearTimeout(timer)
    }
  }, [userId, refetch])

  return {
    topics, cardsByTopic, logsByTopic, loading, goneTopicIds,
    topicsRef, cardsRef, logsRef, setTopics, setCards, setLogs,
    cards, topicBook, tracker, bases,
    showCard, showTopic, addCards, addTopic, dropCard, dropTopic, markTopicGone,
    beginCard, endCard, beginTopic, endTopic,
  }
}

export type StudySync = ReturnType<typeof useStudySync>

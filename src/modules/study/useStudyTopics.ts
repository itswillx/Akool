import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import {
  fieldsUnchanged,
  findInGroups,
  mapWriteError,
  pickFields,
  reinsertAt,
  requireRows,
  revertFields,
  runGuarded,
  runOptimistic,
  type WriteError,
} from '../../lib/optimistic'
import { supabase } from '../../lib/supabase'
import type { ParsedStudyCard, StudyParseResult } from '../../lib/studyMarkdownParser'
import { localDateISO } from '../../lib/studyProgress'
import { distributeDueDates } from '../../lib/studySchedule'
import type { StudyCard, StudyLog, StudyTopic } from '../../types'
import {
  applyReschedule,
  planReschedule,
  rescheduleFailures,
  revertReschedule,
} from './studyMutations'

// Data layer of the study module: mutate local state immediately, then persist
// via supabase.from(). All rows are per-user (RLS on user_id).
//
// Toda escrita passa por runOptimistic/runGuarded (REL-002): supabase-js nao
// lanca em falha, entao sem isso um write barrado por RLS ou por rede caida
// deixaria a tela mostrando um estado que o banco nunca aceitou.

type TopicPatch = Partial<Pick<StudyTopic, 'title' | 'area' | 'level' | 'objective' | 'status' | 'target_date'>>
export type StudyCardPatch = Partial<Pick<StudyCard, 'title' | 'description' | 'rationale' | 'checkpoints' | 'resources' | 'quiz' | 'due_date'>>

export interface CreateTopicForm {
  title: string
  area?: string
  level?: string
  objective?: string
  target_date?: string | null
}

function normalizeCard(row: StudyCard): StudyCard {
  return {
    ...row,
    rationale: row.rationale ?? '',
    checkpoints: (row.checkpoints ?? []) as StudyCard['checkpoints'],
    resources: (row.resources ?? []) as StudyCard['resources'],
    // Branch per quiz kind so TS keeps each member's userAnswer type narrow.
    quiz: ((row.quiz ?? []) as StudyCard['quiz']).map(q =>
      q.kind === 'choice'
        ? { ...q, userAnswer: q.userAnswer ?? null }
        : { ...q, userAnswer: q.userAnswer ?? null },
    ),
  }
}

export function useStudyTopics(userId: string | undefined) {
  const [topics, setTopicsState] = useState<StudyTopic[]>([])
  const [cardsByTopic, setCardsState] = useState<Record<string, StudyCard[]>>({})
  const [logsByTopic, setLogsState] = useState<Record<string, StudyLog[]>>({})
  const [loading, setLoading] = useState(true)
  const { showToast } = useToast()
  const { t } = useLanguage()

  // Setters lastreados em ref: `ref.current` e atualizado SINCRONAMENTE, entao
  // uma mutacao que tira snapshot, aguarda o write e depois reverte sempre ve
  // exatamente as linhas que mexeu — mesmo com uma rajada de autosaves no mesmo
  // tick, sem React ter re-renderizado entre eles. TODA escrita nesses tres
  // estados passa por aqui; nunca chame set*State direto.
  const topicsRef = useRef<StudyTopic[]>([])
  const cardsRef = useRef<Record<string, StudyCard[]>>({})
  const logsRef = useRef<Record<string, StudyLog[]>>({})

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

  // dedupeKey por OPERACAO (nao por mensagem): rede/permissao/generico geram
  // textos diferentes, e sem a chave fixa uma rajada de autosaves offline
  // abriria varios toasts de uma vez.
  const toastWriteError = useCallback(
    (fallbackKey: TranslationKey, dedupeKey: string) => (error: WriteError) =>
      showToast('error', mapWriteError(error, t, fallbackKey), { dedupeKey }),
    [showToast, t],
  )

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('study_topics').select('*').eq('user_id', userId).order('updated_at', { ascending: false }),
      supabase.from('study_cards').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
      supabase.from('study_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]).then(([topicsRes, cardsRes, logsRes]) => {
      if (cancelled) return
      setTopics(() => ((topicsRes.data as StudyTopic[]) ?? []))
      const cards: Record<string, StudyCard[]> = {}
      for (const row of ((cardsRes.data as StudyCard[]) ?? []).map(normalizeCard)) {
        (cards[row.topic_id] ??= []).push(row)
      }
      setCards(() => cards)
      const logs: Record<string, StudyLog[]> = {}
      for (const row of ((logsRes.data as StudyLog[]) ?? [])) {
        (logs[row.topic_id] ??= []).push(row)
      }
      setLogs(() => logs)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId, setTopics, setCards, setLogs])

  const createTopicManual = useCallback(async (form: CreateTopicForm): Promise<StudyTopic | null> => {
    if (!userId) return null
    const res = await runGuarded(
      () => supabase
        .from('study_topics')
        .insert({
          user_id: userId,
          title: form.title.trim(),
          area: form.area?.trim() ?? '',
          level: form.level?.trim() ?? '',
          objective: form.objective?.trim() ?? '',
          target_date: form.target_date ?? null,
        })
        .select('*')
        .single(),
      { label: 'createTopicManual', onError: toastWriteError('study_error_create', 'study:create') },
    )
    if (!res.ok || !res.data) return null
    const topic = res.data as StudyTopic
    setTopics(prev => [topic, ...prev])
    return topic
  }, [userId, setTopics, toastWriteError])

  const insertCards = useCallback(async (
    topicId: string,
    cards: ParsedStudyCard[],
    startOrder: number,
    dueDates?: (string | null)[],
  ): Promise<number> => {
    if (!userId || cards.length === 0) return 0
    const rows = cards.map((card, i) => ({
      user_id: userId,
      topic_id: topicId,
      title: card.title,
      description: card.description,
      rationale: card.rationale,
      checkpoints: card.checkpoints,
      resources: card.resources,
      quiz: card.quiz,
      sort_order: startOrder + i,
      due_date: dueDates?.[i] ?? null,
    }))
    const res = await runGuarded(
      () => supabase.from('study_cards').insert(rows).select('*'),
      { label: 'insertCards', onError: toastWriteError('study_error_create', 'study:create') },
    )
    if (!res.ok || !res.data) return 0
    const inserted = (res.data as StudyCard[]).map(normalizeCard).sort((a, b) => a.sort_order - b.sort_order)
    setCards(prev => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), ...inserted] }))
    return inserted.length
  }, [userId, setCards, toastWriteError])

  // Form values win over the parsed .md metadata; parsed values fill blanks.
  // With a target date, due dates are distributed across the cards (last card
  // lands exactly on the target) — the automatic "cronograma".
  const createTopicFromImport = useCallback(async (parsed: StudyParseResult, form: CreateTopicForm): Promise<StudyTopic | null> => {
    const merged: CreateTopicForm = {
      title: form.title.trim() || parsed.topic.title || '',
      area: form.area?.trim() || parsed.topic.area || '',
      level: form.level?.trim() || parsed.topic.level || '',
      objective: form.objective?.trim() || parsed.topic.objective || '',
      target_date: form.target_date ?? null,
    }
    if (!merged.title) return null
    const topic = await createTopicManual(merged)
    if (!topic) return null
    const dueDates = topic.target_date && parsed.cards.length > 0
      ? distributeDueDates(localDateISO(), topic.target_date, parsed.cards.length)
      : undefined
    const created = await insertCards(topic.id, parsed.cards, 0, dueDates)
    // Sem isto o modal fecha reportando sucesso e navega para um topico vazio:
    // o topico existe, mas os cards nunca foram gravados.
    if (parsed.cards.length > 0 && created < parsed.cards.length) {
      showToast('warning', t('study_error_import_cards'), { dedupeKey: 'study:import-cards' })
    }
    return topic
  }, [createTopicManual, insertCards, showToast, t])

  const updateTopic = useCallback(async (id: string, patch: TopicPatch) => {
    const current = topicsRef.current.find(topic => topic.id === id)
    if (!current) return
    const updated_at = new Date().toISOString()
    const full: Partial<StudyTopic> = { ...patch, updated_at }
    if (patch.status && patch.status !== current.status) {
      if (patch.status === 'studying' && !current.started_at) full.started_at = updated_at
      if (patch.status === 'completed') full.completed_at = updated_at
      if (current.status === 'completed' && patch.status !== 'completed') full.completed_at = null
    }
    // Snapshot SO dos campos que este write toca, lidos da linha como esta agora.
    const before = pickFields(current, full)
    await runOptimistic({
      label: 'updateTopic',
      apply: () => setTopics(prev => prev.map(topic => (topic.id === id ? { ...topic, ...full } : topic))),
      // .select('id') porque um UPDATE barrado por RLS resolve com error: null e
      // zero linhas — sucesso fantasma indistinguivel de gravacao real.
      write: async () => requireRows(await supabase.from('study_topics').update(full).eq('id', id).select('id')),
      // Guard: se os campos ja nao valem o que aplicamos, uma edicao mais nova
      // pousou no meio — reverter aqui apagaria o trabalho do usuario.
      revert: () => setTopics(prev => revertFields(prev, id, before, {
        onlyIf: topic => fieldsUnchanged(topic, full),
      })),
      onError: toastWriteError('study_error_generic', 'study:topic-save'),
    })
  }, [setTopics, toastWriteError])

  const deleteTopic = useCallback(async (id: string) => {
    const index = topicsRef.current.findIndex(topic => topic.id === id)
    if (index === -1) return
    const topic = topicsRef.current[index]
    const cards = cardsRef.current[id]
    const logs = logsRef.current[id]
    await runOptimistic({
      label: 'deleteTopic',
      apply: () => {
        setTopics(prev => prev.filter(item => item.id !== id))
        setCards(prev => { const next = { ...prev }; delete next[id]; return next })
        setLogs(prev => { const next = { ...prev }; delete next[id]; return next })
      },
      // FK ON DELETE CASCADE removes the topic's cards and logs server-side —
      // logo um delete que falhou nao cascateou nada, e restaurar os tres
      // estados e exato, nao palpite.
      write: () => supabase.from('study_topics').delete().eq('id', id),
      revert: () => {
        setTopics(prev => reinsertAt(prev, topic, index))
        if (cards) setCards(prev => (prev[id] ? prev : { ...prev, [id]: cards }))
        if (logs) setLogs(prev => (prev[id] ? prev : { ...prev, [id]: logs }))
      },
      onError: toastWriteError('study_error_delete', 'study:delete'),
    })
  }, [setTopics, setCards, setLogs, toastWriteError])

  const createCard = useCallback(async (topicId: string) => {
    if (!userId) return
    const existing = cardsRef.current[topicId] ?? []
    const sort_order = existing.length > 0 ? Math.max(...existing.map(c => c.sort_order)) + 1 : 0
    const res = await runGuarded(
      () => supabase
        .from('study_cards')
        .insert({ user_id: userId, topic_id: topicId, title: '', description: '', rationale: '', checkpoints: [], resources: [], quiz: [], sort_order })
        .select('*')
        .single(),
      { label: 'createCard', onError: toastWriteError('study_error_create', 'study:create') },
    )
    if (!res.ok || !res.data) return
    const card = normalizeCard(res.data as StudyCard)
    setCards(prev => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), card] }))
  }, [userId, setCards, toastWriteError])

  const updateCard = useCallback(async (cardId: string, patch: StudyCardPatch) => {
    const found = findInGroups(cardsRef.current, cardId)
    if (!found) return
    const { groupId: topicId, row: before } = found
    const updated_at = new Date().toISOString()
    const applied: Partial<StudyCard> = { ...patch, updated_at }
    const snapshot = pickFields(before, patch, ['updated_at'])
    await runOptimistic({
      label: 'updateCard',
      // So o array do topico dono e reconstruido (a versao anterior rebuildava
      // o mapa inteiro a cada tecla do autosave).
      apply: () => setCards(prev => ({
        ...prev,
        [topicId]: (prev[topicId] ?? []).map(card => (card.id === cardId ? { ...card, ...applied } : card)),
      })),
      // Sem .select('id') aqui de proposito: este e o caminho de rajada do
      // autosave e o round-trip com representation nao paga.
      // TODO(REL-002): reavaliar depois de medir o custo do autosave.
      write: () => supabase.from('study_cards').update(applied).eq('id', cardId),
      revert: () => setCards(prev => ({
        ...prev,
        [topicId]: revertFields(prev[topicId] ?? [], cardId, snapshot, {
          // checkpoints/resources/quiz comparam por REFERENCIA contra o objeto
          // que o apply espalhou: se outro updateCard passou por cima, a
          // referencia mudou e o revert vira no-op.
          onlyIf: card => fieldsUnchanged(card, applied),
        }),
      })),
      onError: toastWriteError('study_error_generic', 'study:card-save'),
    })
  }, [setCards, toastWriteError])

  const toggleCheckpoint = useCallback(async (cardId: string, checkpointId: string) => {
    const target = findInGroups(cardsRef.current, cardId)?.row
    if (!target) return
    const checkpoints = target.checkpoints.map(p => (p.id === checkpointId ? { ...p, completed: !p.completed } : p))
    await updateCard(cardId, { checkpoints })
  }, [updateCard])

  const deleteCard = useCallback(async (cardId: string) => {
    const found = findInGroups(cardsRef.current, cardId)
    if (!found) return
    const { groupId: topicId, index, row } = found
    await runOptimistic({
      label: 'deleteCard',
      apply: () => setCards(prev => ({
        ...prev,
        [topicId]: (prev[topicId] ?? []).filter(card => card.id !== cardId),
      })),
      // Sem .select() nos deletes: 0 linhas e ambiguo (RLS barrou vs. alguem ja
      // apagou) e tratar como falha faria a linha "voltar" num caso legitimo.
      write: () => supabase.from('study_cards').delete().eq('id', cardId),
      revert: () => setCards(prev => ({
        ...prev,
        [topicId]: reinsertAt(prev[topicId] ?? [], row, index),
      })),
      onError: toastWriteError('study_error_delete', 'study:delete'),
    })
  }, [setCards, toastWriteError])

  const appendCards = useCallback(async (topicId: string, cards: ParsedStudyCard[]): Promise<number> => {
    const existing = cardsRef.current[topicId] ?? []
    const start = existing.length > 0 ? Math.max(...existing.map(c => c.sort_order)) + 1 : 0
    return insertCards(topicId, cards, start)
  }, [insertCards])

  // Manual "Recalcular cronograma": redistributes due dates over the topic's
  // cards (by sort_order) from today to the target date. Dates are applied to
  // state BY CARD ID so array-order drift can never desync the mapping.
  const rescheduleCards = useCallback(async (topicId: string): Promise<void> => {
    const topic = topicsRef.current.find(item => item.id === topicId)
    const sorted = [...(cardsRef.current[topicId] ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    if (!topic?.target_date || sorted.length === 0) return
    const dates = distributeDueDates(localDateISO(), topic.target_date, sorted.length)
    const plan = planReschedule(sorted, dates, new Date().toISOString())

    setCards(prev => ({ ...prev, [topicId]: applyReschedule(prev[topicId] ?? [], plan) }))

    // allSettled, nao all: `all` rejeita no primeiro reject e perderia o
    // resultado dos demais. Com .select('id') o RLS silencioso (0 linhas) vira
    // falha — vale aqui porque e acionamento manual e raro.
    const settled = await Promise.allSettled(plan.map(item =>
      supabase.from('study_cards').update(item.applied).eq('id', item.id).select('id')))
    const failed = rescheduleFailures(plan, settled)
    if (failed.length === 0) return

    setCards(prev => ({ ...prev, [topicId]: revertReschedule(prev[topicId] ?? [], failed) }))

    const done = plan.length - failed.length
    console.error('[optimistic] rescheduleCards', { topicId, failed: failed.length, total: plan.length })
    showToast(
      'error',
      done === 0
        ? t('study_error_generic')
        : t('study_error_reschedule_partial', { done, total: plan.length }),
      { dedupeKey: 'study:reschedule' },
    )
  }, [setCards, showToast, t])

  const addLog = useCallback(async (topicId: string, content: string) => {
    if (!userId) return
    const res = await runGuarded(
      () => supabase
        .from('study_logs')
        .insert({ user_id: userId, topic_id: topicId, content })
        .select('*')
        .single(),
      { label: 'addLog', onError: toastWriteError('study_error_create', 'study:create') },
    )
    if (!res.ok || !res.data) return
    const log = res.data as StudyLog
    setLogs(prev => ({ ...prev, [topicId]: [log, ...(prev[topicId] ?? [])] }))
  }, [userId, setLogs, toastWriteError])

  const deleteLog = useCallback(async (logId: string) => {
    const found = findInGroups(logsRef.current, logId)
    if (!found) return
    const { groupId: topicId, index, row } = found
    await runOptimistic({
      label: 'deleteLog',
      apply: () => setLogs(prev => ({
        ...prev,
        [topicId]: (prev[topicId] ?? []).filter(log => log.id !== logId),
      })),
      write: () => supabase.from('study_logs').delete().eq('id', logId),
      revert: () => setLogs(prev => ({
        ...prev,
        [topicId]: reinsertAt(prev[topicId] ?? [], row, index),
      })),
      onError: toastWriteError('study_error_delete', 'study:delete'),
    })
  }, [setLogs, toastWriteError])

  return {
    topics,
    cardsByTopic,
    logsByTopic,
    loading,
    createTopicManual,
    createTopicFromImport,
    updateTopic,
    deleteTopic,
    createCard,
    updateCard,
    toggleCheckpoint,
    deleteCard,
    appendCards,
    rescheduleCards,
    addLog,
    deleteLog,
  }
}

export type StudyStore = ReturnType<typeof useStudyTopics>

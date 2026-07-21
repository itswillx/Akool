import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ParsedStudyCard, StudyParseResult } from '../../lib/studyMarkdownParser'
import { localDateISO } from '../../lib/studyProgress'
import { distributeDueDates } from '../../lib/studySchedule'
import type { StudyCard, StudyLog, StudyTopic } from '../../types'

// Data layer of the study module, following the optimistic state-first shape
// of useQuickNotes: mutate local state immediately, then persist via
// supabase.from(). All rows are per-user (RLS on user_id).

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
    quiz: ((row.quiz ?? []) as StudyCard['quiz']).map(q => ({ ...q, userAnswer: q.userAnswer ?? null })),
  }
}

export function useStudyTopics(userId: string | undefined) {
  const [topics, setTopics] = useState<StudyTopic[]>([])
  const [cardsByTopic, setCardsByTopic] = useState<Record<string, StudyCard[]>>({})
  const [logsByTopic, setLogsByTopic] = useState<Record<string, StudyLog[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('study_topics').select('*').eq('user_id', userId).order('updated_at', { ascending: false }),
      supabase.from('study_cards').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
      supabase.from('study_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]).then(([topicsRes, cardsRes, logsRes]) => {
      if (cancelled) return
      setTopics(((topicsRes.data as StudyTopic[]) ?? []))
      const cards: Record<string, StudyCard[]> = {}
      for (const row of ((cardsRes.data as StudyCard[]) ?? []).map(normalizeCard)) {
        (cards[row.topic_id] ??= []).push(row)
      }
      setCardsByTopic(cards)
      const logs: Record<string, StudyLog[]> = {}
      for (const row of ((logsRes.data as StudyLog[]) ?? [])) {
        (logs[row.topic_id] ??= []).push(row)
      }
      setLogsByTopic(logs)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId])

  const createTopicManual = useCallback(async (form: CreateTopicForm): Promise<StudyTopic | null> => {
    if (!userId) return null
    const { data, error } = await supabase
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
      .single()
    if (error || !data) return null
    const topic = data as StudyTopic
    setTopics(prev => [topic, ...prev])
    return topic
  }, [userId])

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
    const { data, error } = await supabase.from('study_cards').insert(rows).select('*')
    if (error || !data) return 0
    const inserted = (data as StudyCard[]).map(normalizeCard).sort((a, b) => a.sort_order - b.sort_order)
    setCardsByTopic(prev => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), ...inserted] }))
    return inserted.length
  }, [userId])

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
    await insertCards(topic.id, parsed.cards, 0, dueDates)
    return topic
  }, [createTopicManual, insertCards])

  const updateTopic = useCallback(async (id: string, patch: TopicPatch) => {
    const current = topics.find(t => t.id === id)
    if (!current) return
    const updated_at = new Date().toISOString()
    const full: Partial<StudyTopic> = { ...patch, updated_at }
    if (patch.status && patch.status !== current.status) {
      if (patch.status === 'studying' && !current.started_at) full.started_at = updated_at
      if (patch.status === 'completed') full.completed_at = updated_at
      if (current.status === 'completed' && patch.status !== 'completed') full.completed_at = null
    }
    setTopics(prev => prev.map(t => (t.id === id ? { ...t, ...full } : t)))
    await supabase.from('study_topics').update(full).eq('id', id)
  }, [topics])

  const deleteTopic = useCallback(async (id: string) => {
    setTopics(prev => prev.filter(t => t.id !== id))
    setCardsByTopic(prev => { const next = { ...prev }; delete next[id]; return next })
    setLogsByTopic(prev => { const next = { ...prev }; delete next[id]; return next })
    // FK ON DELETE CASCADE removes the topic's cards and logs server-side.
    await supabase.from('study_topics').delete().eq('id', id)
  }, [])

  const createCard = useCallback(async (topicId: string) => {
    if (!userId) return
    const existing = cardsByTopic[topicId] ?? []
    const sort_order = existing.length > 0 ? Math.max(...existing.map(c => c.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('study_cards')
      .insert({ user_id: userId, topic_id: topicId, title: '', description: '', rationale: '', checkpoints: [], resources: [], quiz: [], sort_order })
      .select('*')
      .single()
    if (!error && data) {
      const card = normalizeCard(data as StudyCard)
      setCardsByTopic(prev => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), card] }))
    }
  }, [userId, cardsByTopic])

  const updateCard = useCallback(async (cardId: string, patch: StudyCardPatch) => {
    const updated_at = new Date().toISOString()
    setCardsByTopic(prev => {
      const next: Record<string, StudyCard[]> = {}
      for (const [topicId, cards] of Object.entries(prev)) {
        next[topicId] = cards.map(c => (c.id === cardId ? { ...c, ...patch, updated_at } : c))
      }
      return next
    })
    await supabase.from('study_cards').update({ ...patch, updated_at }).eq('id', cardId)
  }, [])

  const toggleCheckpoint = useCallback(async (cardId: string, checkpointId: string) => {
    let target: StudyCard | undefined
    for (const cards of Object.values(cardsByTopic)) {
      target = cards.find(c => c.id === cardId)
      if (target) break
    }
    if (!target) return
    const checkpoints = target.checkpoints.map(p => (p.id === checkpointId ? { ...p, completed: !p.completed } : p))
    await updateCard(cardId, { checkpoints })
  }, [cardsByTopic, updateCard])

  const deleteCard = useCallback(async (cardId: string) => {
    setCardsByTopic(prev => {
      const next: Record<string, StudyCard[]> = {}
      for (const [topicId, cards] of Object.entries(prev)) {
        next[topicId] = cards.filter(c => c.id !== cardId)
      }
      return next
    })
    await supabase.from('study_cards').delete().eq('id', cardId)
  }, [])

  const appendCards = useCallback(async (topicId: string, cards: ParsedStudyCard[]): Promise<number> => {
    const existing = cardsByTopic[topicId] ?? []
    const start = existing.length > 0 ? Math.max(...existing.map(c => c.sort_order)) + 1 : 0
    return insertCards(topicId, cards, start)
  }, [cardsByTopic, insertCards])

  // Manual "Recalcular cronograma": redistributes due dates over the topic's
  // cards (by sort_order) from today to the target date. Dates are applied to
  // state BY CARD ID so array-order drift can never desync the mapping.
  const rescheduleCards = useCallback(async (topicId: string): Promise<void> => {
    const topic = topics.find(t => t.id === topicId)
    const sorted = [...(cardsByTopic[topicId] ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    if (!topic?.target_date || sorted.length === 0) return
    const dates = distributeDueDates(localDateISO(), topic.target_date, sorted.length)
    const updated_at = new Date().toISOString()
    const dateById = new Map(sorted.map((card, i) => [card.id, dates[i]]))
    setCardsByTopic(prev => ({
      ...prev,
      [topicId]: (prev[topicId] ?? []).map(card =>
        dateById.has(card.id) ? { ...card, due_date: dateById.get(card.id)!, updated_at } : card),
    }))
    await Promise.all(sorted.map((card, i) =>
      supabase.from('study_cards').update({ due_date: dates[i], updated_at }).eq('id', card.id)))
  }, [topics, cardsByTopic])

  const addLog = useCallback(async (topicId: string, content: string) => {
    if (!userId) return
    const { data, error } = await supabase
      .from('study_logs')
      .insert({ user_id: userId, topic_id: topicId, content })
      .select('*')
      .single()
    if (!error && data) {
      const log = data as StudyLog
      setLogsByTopic(prev => ({ ...prev, [topicId]: [log, ...(prev[topicId] ?? [])] }))
    }
  }, [userId])

  const deleteLog = useCallback(async (logId: string) => {
    setLogsByTopic(prev => {
      const next: Record<string, StudyLog[]> = {}
      for (const [topicId, logs] of Object.entries(prev)) {
        next[topicId] = logs.filter(l => l.id !== logId)
      }
      return next
    })
    await supabase.from('study_logs').delete().eq('id', logId)
  }, [])

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

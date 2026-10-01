// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { StudyCard, StudyLog, StudyTopic } from '../../types'

// QA-001: carga, erro de leitura e desfazer das escritas otimistas do módulo
// de estudos, com um supabase falso (resultado por tabela + operação).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string; code?: string } | null }

const db = vi.hoisted(() => {
  const results: Record<string, Res | 'reject'> = {}
  return { results, calls: [] as string[] }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let op: Op = 'select'
      const b = {
        select: () => b, eq: () => b, order: () => b, single: () => b,
        insert: () => { op = 'insert'; return b },
        update: () => { op = 'update'; return b },
        delete: () => { op = 'delete'; return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const key = `${table}:${op}`
          db.calls.push(key)
          const result = db.results[key] ?? { data: [], error: null }
          const promise = result === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(result)
          return promise.then(resolve, reject)
        },
      }
      return b
    },
  },
}))

const showToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))

import { useStudyTopics } from './useStudyTopics'

const topic = (id: string, title: string): StudyTopic => ({
  id, user_id: 'u1', title, area: '', level: '', objective: '', status: 'planned',
  target_date: null, started_at: null, completed_at: null, created_at: '', updated_at: '',
})
const card = (id: string, topicId: string, sort: number): StudyCard => ({
  id, user_id: 'u1', topic_id: topicId, title: id, description: '', rationale: '',
  checkpoints: [], resources: [], quiz: [], sort_order: sort, due_date: null, created_at: '', updated_at: '',
})
const log = (id: string, topicId: string): StudyLog => ({ id, user_id: 'u1', topic_id: topicId, content: id, created_at: '' })

let hook: ReturnType<typeof useStudyTopics>
const capture = (value: ReturnType<typeof useStudyTopics>) => { hook = value }
function Probe({ userId }: { userId: string | undefined }) {
  const value = useStudyTopics(userId)
  useEffect(() => { capture(value) })
  return null
}

let container: HTMLDivElement
let root: Root
const render = (userId: string | undefined) => act(async () => { root.render(<Probe userId={userId} />) })

function seed() {
  db.results['study_topics:select'] = { data: [topic('t1', 'Rust'), topic('t2', 'Go')], error: null }
  db.results['study_cards:select'] = { data: [card('c1', 't1', 0), card('c2', 't1', 1)], error: null }
  db.results['study_logs:select'] = { data: [log('l1', 't1')], error: null }
}

beforeEach(() => {
  for (const key of Object.keys(db.results)) delete db.results[key]
  db.calls = []
  showToast.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('useStudyTopics: carga', () => {
  it('agrupa cards e diário por tópico', async () => {
    seed()
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(hook.topics.map(t => t.title)).toEqual(['Rust', 'Go'])
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(hook.logsByTopic.t1.map(l => l.id)).toEqual(['l1'])
  })

  it('erro de leitura avisa e não finge que não há tópicos carregando para sempre', async () => {
    seed()
    db.results['study_cards:select'] = { data: null, error: { message: 'JWT expired', code: 'PGRST301' } }
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(showToast).toHaveBeenCalledWith('error', 'study_load_error', { dedupeKey: 'study:load' })
  })

  it('rede caída (promessa rejeitada) também sai do carregamento', async () => {
    seed()
    db.results['study_topics:select'] = 'reject'
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(showToast).toHaveBeenCalledWith('error', 'study_load_error', { dedupeKey: 'study:load' })
  })
})

describe('useStudyTopics: escritas', () => {
  it('update recusado pelo RLS (0 linhas) volta o título e avisa', async () => {
    seed()
    await render('u1')
    db.results['study_topics:update'] = { data: [], error: null }
    await act(async () => { await hook.updateTopic('t1', { title: 'Rust 2' }) })
    expect(hook.topics.find(t => t.id === 't1')?.title).toBe('Rust')
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_permission', { dedupeKey: 'study:topic-save' })
  })

  it('update que grava marca started_at ao começar a estudar', async () => {
    seed()
    await render('u1')
    db.results['study_topics:update'] = { data: [{ id: 't1' }], error: null }
    await act(async () => { await hook.updateTopic('t1', { status: 'studying' }) })
    const t1 = hook.topics.find(t => t.id === 't1')
    expect(t1?.status).toBe('studying')
    expect(t1?.started_at).not.toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('excluir tópico que falha devolve tópico, cards e diário no lugar', async () => {
    seed()
    await render('u1')
    db.results['study_topics:delete'] = { data: null, error: { message: 'Failed to fetch' } }
    await act(async () => { await hook.deleteTopic('t1') })
    expect(hook.topics.map(t => t.id)).toEqual(['t1', 't2'])
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(hook.logsByTopic.t1.map(l => l.id)).toEqual(['l1'])
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_network', { dedupeKey: 'study:delete' })
  })

  it('excluir card que falha devolve o card na mesma posição', async () => {
    seed()
    await render('u1')
    db.results['study_cards:delete'] = { data: null, error: { message: 'Failed to fetch' } }
    await act(async () => { await hook.deleteCard('c1') })
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('criar card entra no fim do tópico com o sort_order seguinte', async () => {
    seed()
    await render('u1')
    db.results['study_cards:insert'] = { data: card('c3', 't1', 2), error: null }
    await act(async () => { await hook.createCard('t1') })
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})

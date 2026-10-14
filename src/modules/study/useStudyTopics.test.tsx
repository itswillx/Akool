// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { currentStepIndex, topicProgress } from '../../lib/studyProgress'
import { isQuizPassed } from '../../lib/studyQuiz'
import type { StudyParseResult } from '../../lib/studyMarkdownParser'
import type { StudyFieldOutcome } from './studyMutations'

// API-029: o hook de Estudos sobre um banco em memória atrás de um supabase
// falso, que faz o que as RPCs do API-024 fazem (trava por item, P0002,
// P0001, versão que só anda para frente). A "outra aba" grava direto no banco.
// Antes, a tela regravava listas inteiras a partir do estado velho, carimbava
// datas e posição no aparelho e carregava uma vez só (reprodução em
// scratchpad l06/API-029/repro.test.tsx).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => {
  interface Item {
    id: string
    text?: string
    note?: string
    completed?: boolean
    title?: string
    url?: string
    statement?: string
    answer?: unknown
    userAnswer?: unknown
    [key: string]: unknown
  }
  interface Row {
    id: string
    topic_id?: string
    title?: string
    description?: string
    status?: string
    sort_order?: number
    created_at?: string
    updated_at?: string
    due_date?: string | null
    target_date?: string | null
    started_at?: string | null
    completed_at?: string | null
    checkpoints?: Item[]
    resources?: Item[]
    quiz?: Item[]
    [key: string]: unknown
  }
  interface Args {
    p_card?: string
    p_checkpoint?: string
    p_text?: string
    p_note?: string
    p_id?: string
    p_completed?: boolean
    p_url?: string
    p_title?: string
    p_resource?: string
    p_question?: string
    p_answer?: unknown
    p_only_wrong?: boolean
    p_topic?: string
    p_cards?: Row[]
    p_payload?: { topic: Row; cards: Row[] }
    p_today?: string
  }
  type Err = { message: string; code?: string; hint?: string }
  type Res = { data: unknown; error: Err | null }
  const state = {
    tables: {} as Record<string, Row[]>,
    n: 0,
    log: [] as string[],
    rpcArgs: [] as [string, Args][],
    writes: [] as { key: string; values: unknown; filters: [string, unknown][] }[],
    override: {} as Record<string, Res | 'reject'>,
    holdBefore: {} as Record<string, Promise<unknown>>,
    holdAfter: {} as Record<string, Promise<unknown>>,
  }
  const version = () => `2026-10-12T10:00:00.${String(++state.n).padStart(6, '0')}+00:00`
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const ok = (data: unknown): Res => ({ data: clone(data), error: null })
  const err = (code: string, message: string): Res => ({ data: null, error: { message, code, hint: 'akool' } })
  const cards = () => state.tables.study_cards
  const findCard = (id: unknown) => cards().find(card => card.id === id)
  const bump = (row: Row) => { row.updated_at = version(); return ok(row) }
  const byOrder = (a: Row, b: Row) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at), 'en')
  const newCard = (fields: Row): Row => ({
    description: '', rationale: '', checkpoints: [], resources: [], quiz: [], blocks: [], due_date: null,
    created_at: version(), updated_at: version(), ...fields,
  })
  const newTopic = (fields: Partial<Row>): Row => ({
    id: `topic-${++state.n}`, area: '', level: '', objective: '', status: 'planned', target_date: null,
    started_at: null, completed_at: null, created_at: version(), updated_at: version(), ...fields,
  })
  const find = (list: Item[] | undefined, id: unknown) => list?.find(entry => entry.id === id)

  const rpcs: Record<string, (a: Args) => Res> = {
    study_checkpoint_add: a => {
      const card = findCard(a.p_card)
      if (!card?.checkpoints) return err('P0002', 'Card não encontrado')
      const old = find(card.checkpoints, a.p_id)
      if (old) return old.text === a.p_text ? ok(card) : err('23505', 'Já existe um ponto de estudo com este id')
      card.checkpoints.push({ id: a.p_id ?? '', text: a.p_text, completed: false })
      return bump(card)
    },
    study_checkpoint_edit: a => {
      const card = findCard(a.p_card)
      const point = find(card?.checkpoints, a.p_checkpoint)
      if (!card || !point) return err('P0002', 'Ponto de estudo não encontrado')
      if (a.p_text !== undefined) point.text = a.p_text
      if (a.p_note === '') delete point.note
      else if (a.p_note !== undefined) point.note = a.p_note
      return bump(card)
    },
    study_checkpoint_toggle: a => {
      const card = findCard(a.p_card)
      if (!card) return err('P0002', 'Card não encontrado')
      const point = find(card.checkpoints, a.p_checkpoint)
      if (!point) return err('P0002', 'Ponto de estudo não encontrado')
      const done = a.p_completed ?? !point.completed
      if (point.completed === done) return ok(card)
      point.completed = done
      return bump(card)
    },
    study_checkpoint_remove: a => {
      const card = findCard(a.p_card)
      if (!card || !find(card.checkpoints, a.p_checkpoint)) return err('P0002', 'Ponto de estudo não encontrado')
      card.checkpoints = card.checkpoints?.filter(p => p.id !== a.p_checkpoint)
      return bump(card)
    },
    study_resource_add: a => {
      const card = findCard(a.p_card)
      if (!card?.resources) return err('P0002', 'Card não encontrado')
      if (find(card.resources, a.p_id)) return ok(card)
      card.resources.push({ id: a.p_id ?? '', title: a.p_title, url: a.p_url })
      return bump(card)
    },
    study_resource_remove: a => {
      const card = findCard(a.p_card)
      if (!card || !find(card.resources, a.p_resource)) return err('P0002', 'Recurso não encontrado')
      card.resources = card.resources?.filter(r => r.id !== a.p_resource)
      return bump(card)
    },
    study_quiz_answer: a => {
      const card = findCard(a.p_card)
      const question = find(card?.quiz, a.p_question)
      if (!card || !question) return err('P0002', 'Pergunta não encontrada')
      if (question.userAnswer !== null) return question.userAnswer === a.p_answer ? ok(card) : err('P0001', 'Pergunta já respondida')
      question.userAnswer = a.p_answer
      return bump(card)
    },
    study_quiz_reset: a => {
      const card = findCard(a.p_card)
      if (!card) return err('P0002', 'Card não encontrado')
      for (const q of card.quiz ?? []) if (!a.p_only_wrong || q.userAnswer !== q.answer) q.userAnswer = null
      return bump(card)
    },
    study_cards_append: a => {
      const topic = state.tables.study_topics.find(row => row.id === a.p_topic)
      if (!topic) return err('P0002', 'Tópico não encontrado')
      const input = a.p_cards ?? []
      for (const [i, card] of input.entries()) if (card.title === 'RUIM') return err('23514', `cards/${i}: Recursos fora do formato: item 0`)
      const start = Math.max(-1, ...cards().filter(card => card.topic_id === a.p_topic).map(card => card.sort_order ?? 0)) + 1
      const made = input.map((card, i) => newCard({ ...card, id: `card-${++state.n}`, user_id: 'u1', topic_id: a.p_topic, sort_order: start + i }))
      cards().push(...made)
      return ok(made)
    },
    study_reschedule: a => {
      const topic = state.tables.study_topics.find(row => row.id === a.p_topic)
      if (!topic) return err('P0002', 'Tópico não encontrado')
      if (!topic.target_date) return err('P0001', 'O tópico não tem data-alvo')
      const list = cards().filter(card => card.topic_id === a.p_topic).sort(byOrder)
      list.forEach((card, i) => {
        const due = i === list.length - 1 ? topic.target_date : `2026-11-${String(i + 1).padStart(2, '0')}`
        if (card.due_date !== due) { card.due_date = due; card.updated_at = version() }
      })
      return ok(list)
    },
    study_import_topic: a => {
      const payload = a.p_payload ?? { topic: { id: '' }, cards: [] }
      for (const [i, card] of payload.cards.entries()) if (card.title === 'RUIM') return err('23514', `cards/${i}: Recursos fora do formato: item 0`)
      const topic = newTopic({ ...payload.topic, user_id: 'u1' })
      state.tables.study_topics.push(topic)
      const made = payload.cards.map((card, i) => newCard({
        ...card, id: `card-${++state.n}`, user_id: 'u1', topic_id: topic.id, sort_order: i, due_date: topic.target_date,
      }))
      cards().push(...made)
      return ok({ topic, cards: made })
    },
  }

  async function run(key: string, exec: () => Res): Promise<Res> {
    state.log.push(key)
    const override = state.override[key]
    if (override === 'reject') throw new TypeError('Failed to fetch')
    if (override) return override
    if (key in state.holdBefore) await state.holdBefore[key]
    const res = exec()
    if (key in state.holdAfter) await state.holdAfter[key]
    return res
  }

  function from(table: string) {
    let op = 'select'
    let values: Row | null = null
    let wantRows = false
    let single = false
    const filters: [string, unknown][] = []
    const match = (row: Row) => filters.every(([col, value]) => row[col] === value)
    const exec = (): Res => {
      const rows = state.tables[table]
      if (op === 'select') {
        const hit = rows.filter(match).map(clone)
        if (table === 'study_cards') hit.sort(byOrder)
        return { data: single ? hit[0] ?? null : hit, error: null }
      }
      state.writes.push({ key: `${table}:${op}`, values: clone(values), filters: [...filters] })
      if (op === 'update') {
        const hit = rows.filter(match)
        for (const row of hit) {
          // O gatilho study_topics_rules: as datas vêm do status.
          if (table === 'study_topics' && values?.status && values.status !== row.status) {
            if (values.status === 'studying' && !row.started_at) row.started_at = `iniciado-${state.n}`
            row.completed_at = values.status === 'completed' ? `concluido-${state.n}` : null
          }
          Object.assign(row, values)
          row.updated_at = version()
        }
        return { data: wantRows ? hit.map(clone) : null, error: null }
      }
      if (op === 'insert') {
        const made: Row = table === 'study_topics' ? newTopic(values ?? {}) : { id: `${table}-${++state.n}`, created_at: version(), ...values }
        rows.push(made)
        return { data: single ? clone(made) : [clone(made)], error: null }
      }
      state.tables[table] = rows.filter(row => !match(row))
      if (table === 'study_topics') {
        const gone = new Set(rows.filter(match).map(row => row.id))
        for (const child of ['study_cards', 'study_logs']) state.tables[child] = state.tables[child].filter(row => !gone.has(String(row.topic_id)))
      }
      return { data: null, error: null }
    }
    const b = {
      select: () => { wantRows = true; return b },
      order: () => b,
      eq: (col: string, value: unknown) => { filters.push([col, value]); return b },
      single: () => { single = true; return b },
      maybeSingle: () => { single = true; return b },
      insert: (v: Row) => { op = 'insert'; values = v; return b },
      update: (v: Row) => { op = 'update'; values = v; return b },
      delete: () => { op = 'delete'; return b },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run(`${table}:${op}`, exec).then(resolve, reject),
    }
    return b
  }

  const supabase = {
    from,
    rpc: (name: string, args: Args) => ({
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        state.rpcArgs.push([name, clone(args)])
        return run(`rpc:${name}`, () => rpcs[name](args)).then(resolve, reject)
      },
    }),
  }
  return { state, supabase, version, clone }
})

vi.mock('../../lib/supabase', () => ({ supabase: fake.supabase }))

const showToast = vi.fn()
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
}))

import { useStudyTopics } from './useStudyTopics'
import { STUDY_REFETCH_GAP_MS, STUDY_REFETCH_SAME_RETURN_MS } from './useStudySync'

const db = fake.state
type DbRow = (typeof db.tables)[string][number]

function seed() {
  db.n = 0
  db.tables = {
    study_topics: [
      { id: 't1', user_id: 'u1', title: 'Rust', area: '', level: '', objective: '', status: 'planned', target_date: '2026-12-31', started_at: null, completed_at: null, created_at: fake.version(), updated_at: fake.version() },
      { id: 't2', user_id: 'u1', title: 'Go', area: '', level: '', objective: '', status: 'planned', target_date: null, started_at: null, completed_at: null, created_at: fake.version(), updated_at: fake.version() },
    ],
    study_cards: [
      {
        id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card', description: '', rationale: '', sort_order: 0, due_date: null, blocks: [],
        checkpoints: [{ id: 'p1', text: 'Ler', completed: false }], resources: [{ id: 'r1', title: 'Docs', url: 'https://docs.rs' }],
        quiz: [{ id: 'q1', statement: 'S', answer: 'certo', userAnswer: null }],
        created_at: fake.version(), updated_at: fake.version(),
      },
      {
        id: 'c2', user_id: 'u1', topic_id: 't1', title: 'Dois', description: '', rationale: '', sort_order: 1, due_date: null, blocks: [],
        checkpoints: [], resources: [], quiz: [], created_at: fake.version(), updated_at: fake.version(),
      },
    ],
    study_logs: [{ id: 'l1', user_id: 'u1', topic_id: 't1', content: 'oi', created_at: fake.version() }],
  }
}

/** A outra aba (ou a API) grava direto no banco: a versão anda. */
function otherTab(table: 'study_cards' | 'study_topics', id: string, change: (row: DbRow) => void) {
  const row = db.tables[table].find(item => item.id === id)!
  change(row)
  row.updated_at = fake.version()
}

function deferred() {
  let release: () => void = () => {}
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

/** Uma requisição presa que termina em erro de rede (o fetch rejeita). */
function failing() {
  let fail: () => void = () => {}
  const promise = new Promise<void>((_, reject) => { fail = () => reject(new TypeError('Failed to fetch')) })
  promise.catch(() => {})
  return { promise, fail }
}

/** Só a próxima chamada de `key` responde `res`; as seguintes vão ao banco. */
function once(key: string, res: { data: unknown; error: { message: string; code?: string } | null }) {
  let used = false
  Object.defineProperty(db.override, key, {
    configurable: true,
    enumerable: true,
    get: () => {
      if (used) return undefined
      used = true
      return res
    },
  })
}

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
const settle = () => act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() })
const card = (id: string, topicId = 't1') => hook.cardsByTopic[topicId]?.find(c => c.id === id)
const dbCard = (id: string) => db.tables.study_cards.find(c => c.id === id)!

beforeEach(() => {
  seed()
  db.log = []
  db.rpcArgs = []
  db.writes = []
  db.override = {}
  db.holdBefore = {}
  db.holdAfter = {}
  showToast.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useStudyTopics: carga', () => {
  it('agrupa cards (na ordem do roteiro) e diário por tópico', async () => {
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(hook.topics.map(t => t.title)).toEqual(['Rust', 'Go'])
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(hook.logsByTopic.t1.map(l => l.id)).toEqual(['l1'])
    expect(db.log.filter(key => key.startsWith('rpc:'))).toEqual([])
  })

  it('erro de leitura avisa e não fica carregando para sempre', async () => {
    db.override['study_cards:select'] = { data: null, error: { message: 'JWT expired', code: 'PGRST301' } }
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(showToast).toHaveBeenCalledWith('error', 'study_load_error', { dedupeKey: 'study:load' })
  })

  it('rede caída (promessa rejeitada) também sai do carregamento', async () => {
    db.override['study_topics:select'] = 'reject'
    await render('u1')
    expect(hook.loading).toBe(false)
    expect(showToast).toHaveBeenCalledWith('error', 'study_load_error', { dedupeKey: 'study:load' })
  })

  // API-021: antes, quiz {} lançava dentro do .then (a carga girava para
  // sempre) e checkpoints {} derrubava a Visão geral (topicProgress).
  it('JSON fora da forma não trava a carga nem a Visão geral', async () => {
    const [c1, c2] = db.tables.study_cards
    Object.assign(c1, { checkpoints: {}, resources: 'x', quiz: {} })
    Object.assign(c2, {
      checkpoints: [null, 'texto', { id: 'p1', text: 'ok', completed: true }],
      resources: [7, { id: 'r1', title: 'Docs', url: 'https://example.com' }],
      quiz: [null, { kind: 'choice', id: 'q1', statement: 'sem alternativas', answer: 0 }, { kind: 'choice', id: 'q2', statement: 'ok', options: ['a', 'b'], answer: 1 }, { id: 'q3', statement: 'legado', answer: 'certo' }],
      rationale: null,
    })
    await render('u1')
    const [n1, n2] = hook.cardsByTopic.t1
    expect([n1.checkpoints, n1.resources, n1.quiz]).toEqual([[], [], []])
    expect(n2.checkpoints.map(p => p.id)).toEqual(['p1'])
    expect(n2.resources.map(r => r.id)).toEqual(['r1'])
    expect(n2.quiz.map(q => [q.id, q.userAnswer])).toEqual([['q2', null], ['q3', null]])
    expect(n2.rationale).toBe('')
    expect(topicProgress(hook.cardsByTopic.t1)).toEqual(expect.objectContaining({ done: 1, total: 3 }))
    expect(() => currentStepIndex(hook.cardsByTopic.t1)).not.toThrow()
    expect(isQuizPassed(n2.quiz)).toBe(false)
  })
})

describe('useStudyTopics: itens pelas RPCs (aceite do API-029)', () => {
  it('outra aba soma p2 e esta marca p1: os dois ficam, no banco e na tela', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { (row.checkpoints as DbRow[]).push({ id: 'p2', text: 'Da outra aba', completed: false }) })
    let ok: boolean | undefined
    await act(async () => { ok = await hook.toggleCheckpoint('c1', 'p1') })
    expect(ok).toBe(true)
    expect(db.rpcArgs).toEqual([['study_checkpoint_toggle', { p_card: 'c1', p_checkpoint: 'p1', p_completed: true }]])
    expect(db.writes.filter(w => w.key === 'study_cards:update')).toEqual([])
    expect(dbCard('c1').checkpoints).toEqual([{ id: 'p1', text: 'Ler', completed: true }, { id: 'p2', text: 'Da outra aba', completed: false }])
    expect(card('c1')?.checkpoints.map(p => [p.id, p.completed])).toEqual([['p1', true], ['p2', false]])
    expect(card('c1')?.updated_at).toBe(dbCard('c1').updated_at)
  })

  it('o recurso e a resposta da outra aba também ficam', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { (row.resources as DbRow[]).push({ id: 'r9', title: 'x', url: 'https://x.example' }) })
    await act(async () => { await hook.addResource('c1', { id: 'r2', title: 'Book', url: 'https://book.example' }) })
    await act(async () => { await hook.removeResource('c1', 'r1') })
    expect((dbCard('c1').resources as DbRow[]).map(r => r.id)).toEqual(['r9', 'r2'])
    expect(card('c1')?.resources.map(r => r.id)).toEqual(['r9', 'r2'])
    expect(db.rpcArgs[0]).toEqual(['study_resource_add', { p_card: 'c1', p_url: 'https://book.example', p_title: 'Book', p_id: 'r2' }])
  })

  it('a tela muda na hora e só a mesma chave espera: dois toggles do mesmo ponto saem em ordem', async () => {
    await render('u1')
    const gate = deferred()
    db.holdBefore['rpc:study_checkpoint_toggle'] = gate.promise
    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(false)
    await act(async () => { first = hook.toggleCheckpoint('c1', 'p1') })
    expect(card('c1')?.checkpoints[0].completed).toBe(true)
    await act(async () => { second = hook.toggleCheckpoint('c1', 'p1') })
    expect(card('c1')?.checkpoints[0].completed).toBe(false)
    // Outra chave (outro item) não espera.
    await act(async () => { await hook.addCheckpoint('c1', { id: 'p3', text: 'Novo' }) })
    expect(dbCard('c1').checkpoints?.map(p => p.id)).toEqual(['p1', 'p3'])
    await act(async () => { gate.release(); await first; await second })
    expect(db.rpcArgs.filter(([name]) => name === 'study_checkpoint_toggle').map(([, a]) => a.p_completed)).toEqual([true, false])
    expect(dbCard('c1').checkpoints?.[0].completed).toBe(false)
    expect(card('c1')?.checkpoints.map(p => [p.id, p.completed])).toEqual([['p1', false], ['p3', false]])
  })

  it('edição de texto e nota do ponto; nota vazia tira a chave', async () => {
    await render('u1')
    await act(async () => { await hook.editCheckpoint('c1', 'p1', { note: 'Ler o cap. 3' }) })
    expect(card('c1')?.checkpoints[0].note).toBe('Ler o cap. 3')
    await act(async () => { await hook.editCheckpoint('c1', 'p1', { note: '' }) })
    expect(card('c1')?.checkpoints[0]).not.toHaveProperty('note')
    expect(db.rpcArgs.map(([, a]) => a)).toEqual([
      { p_card: 'c1', p_checkpoint: 'p1', p_note: 'Ler o cap. 3' },
      { p_card: 'c1', p_checkpoint: 'p1', p_note: '' },
    ])
  })

  it('quiz: responder e reiniciar só as erradas pelas RPCs', async () => {
    await render('u1')
    await act(async () => { await hook.answerQuiz('c1', 'q1', 'errado') })
    expect(card('c1')?.quiz[0].userAnswer).toBe('errado')
    await act(async () => { await hook.resetQuiz('c1', true) })
    expect(card('c1')?.quiz[0].userAnswer).toBeNull()
    expect(db.rpcArgs.map(([name]) => name)).toEqual(['study_quiz_answer', 'study_quiz_reset'])
  })

  // Revisão do lote 06 (#5): responder ia na fila 'quiz:<id>' e reiniciar na
  // 'quiz', e uma não esperava a outra.
  it('quiz: o reinício atrasado e a resposta nova saem em ordem, e a resposta grava sem aviso falso', async () => {
    await render('u1')
    await act(async () => { await hook.answerQuiz('c1', 'q1', 'errado') })
    const gate = deferred()
    db.holdBefore['rpc:study_quiz_reset'] = gate.promise
    let reset: Promise<boolean> = Promise.resolve(false)
    let again: Promise<boolean> = Promise.resolve(false)
    await act(async () => { reset = hook.resetQuiz('c1', false) })
    expect(card('c1')?.quiz[0].userAnswer).toBeNull()
    await act(async () => { again = hook.answerQuiz('c1', 'q1', 'certo') })
    expect(card('c1')?.quiz[0].userAnswer).toBe('certo')
    await act(async () => { gate.release(); await reset; await again })
    expect(await Promise.all([reset, again])).toEqual([true, true])
    expect(db.rpcArgs.map(([name]) => name)).toEqual(['study_quiz_answer', 'study_quiz_reset', 'study_quiz_answer'])
    expect((dbCard('c1').quiz as DbRow[])[0].userAnswer).toBe('certo')
    expect(card('c1')?.quiz[0].userAnswer).toBe('certo')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('quiz: a resposta atrasada e o reinício saem em ordem, e o reinício zera a resposta', async () => {
    await render('u1')
    const gate = deferred()
    db.holdBefore['rpc:study_quiz_answer'] = gate.promise
    let answer: Promise<boolean> = Promise.resolve(false)
    let reset: Promise<boolean> = Promise.resolve(false)
    await act(async () => { answer = hook.answerQuiz('c1', 'q1', 'errado') })
    await act(async () => { reset = hook.resetQuiz('c1', false) })
    expect(card('c1')?.quiz[0].userAnswer).toBeNull()
    await act(async () => { gate.release(); await answer; await reset })
    expect(db.rpcArgs.map(([name]) => name)).toEqual(['study_quiz_answer', 'study_quiz_reset'])
    expect((dbCard('c1').quiz as DbRow[])[0].userAnswer).toBeNull()
    expect(card('c1')?.quiz[0].userAnswer).toBeNull()
  })

  it('falha de rede: o item volta e avisa; o ponto somado na outra aba continua', async () => {
    await render('u1')
    db.override['rpc:study_checkpoint_add'] = { data: null, error: { message: 'Failed to fetch' } }
    let ok: boolean | undefined
    await act(async () => { ok = await hook.addCheckpoint('c1', { id: 'p9', text: 'Novo' }) })
    expect(ok).toBe(false)
    expect(card('c1')?.checkpoints.map(p => p.id)).toEqual(['p1'])
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_network', { dedupeKey: 'study:card-save' })
  })
})

describe('useStudyTopics: P0002 e P0001', () => {
  it('remover um ponto que outra aba já removeu: sucesso calado, com o card de lá', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { row.checkpoints = []; row.title = 'Mudou lá' })
    let ok: boolean | undefined
    await act(async () => { ok = await hook.removeCheckpoint('c1', 'p1') })
    expect(ok).toBe(true)
    expect(showToast).not.toHaveBeenCalled()
    expect(card('c1')).toMatchObject({ checkpoints: [], title: 'Mudou lá' })
  })

  it('marcar um ponto que outra aba removeu: aviso e o card de lá', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { row.checkpoints = [] })
    let ok: boolean | undefined
    await act(async () => { ok = await hook.toggleCheckpoint('c1', 'p1') })
    expect(ok).toBe(false)
    expect(card('c1')?.checkpoints).toEqual([])
    expect(showToast).toHaveBeenCalledWith('info', 'study_item_gone', { dedupeKey: 'study:study_item_gone' })
  })

  it('card excluído em outra aba: sai da tela, com aviso', async () => {
    await render('u1')
    db.tables.study_cards = db.tables.study_cards.filter(c => c.id !== 'c1')
    await act(async () => { await hook.toggleCheckpoint('c1', 'p1') })
    expect(card('c1')).toBeUndefined()
    expect(showToast).toHaveBeenCalledWith('info', 'study_item_gone', { dedupeKey: 'study:study_item_gone' })
  })

  it('responder a pergunta que outra aba já respondeu: mostra a resposta de lá (P0001)', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { (row.quiz as DbRow[])[0].userAnswer = 'certo' })
    let ok: boolean | undefined
    await act(async () => { ok = await hook.answerQuiz('c1', 'q1', 'errado') })
    expect(ok).toBe(false)
    expect(card('c1')?.quiz[0].userAnswer).toBe('certo')
    expect(showToast).toHaveBeenCalledWith('info', 'study_quiz_already_answered', { dedupeKey: 'study:study_quiz_already_answered' })
  })
})

describe('useStudyTopics: campos escalares com versão', () => {
  it('título mudado na outra aba e salvo com a base antiga: conflito, o card de lá e "Copiar meu texto"', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await render('u1')
    otherTab('study_cards', 'c1', row => { row.title = 'Deles' })
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { title: 'Meu' }, { title: 'Card' }) })
    expect(ok).toBe('conflict')
    expect(dbCard('c1').title).toBe('Deles')
    expect(card('c1')?.title).toBe('Deles')
    const [variant, message, options] = showToast.mock.calls[0] as [string, string, { action: { label: string; onClick: () => void } }]
    expect([variant, message, options.action.label]).toEqual(['warning', 'study_card_conflict', 'study_conflict_copy'])
    options.action.onClick()
    expect(writeText).toHaveBeenCalledWith('Meu')
  })

  it('só a lista mudou na outra aba: refaz com a versão nova, sem aviso, e o ponto de lá fica', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { (row.checkpoints as DbRow[]).push({ id: 'p2', text: 'Lá', completed: false }) })
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { title: 'Meu' }, { title: 'Card' }) })
    expect(ok).toBe('saved')
    expect(showToast).not.toHaveBeenCalled()
    const updates = db.writes.filter(w => w.key === 'study_cards:update')
    expect(updates.map(w => w.values)).toEqual([{ title: 'Meu' }, { title: 'Meu' }])
    expect(updates[0].filters.map(([col]) => col)).toEqual(['id', 'updated_at'])
    expect(card('c1')).toMatchObject({ title: 'Meu', checkpoints: [{ id: 'p1' }, { id: 'p2' }] })
  })

  it('o refazer tem fim: a versão mudando sempre dá erro, não laço', async () => {
    await render('u1')
    const original = fake.supabase.from
    vi.spyOn(fake.supabase, 'from').mockImplementation((table: string) => {
      // Outra aba grava uma lista a cada tentativa.
      if (table === 'study_cards') otherTab('study_cards', 'c1', row => { row.description = `${String(row.description)}x` })
      return original(table)
    })
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { title: 'Meu' }, { title: 'Card' }) })
    expect(ok).toBe('failed')
    expect(db.writes.filter(w => w.key === 'study_cards:update')).toHaveLength(3)
    expect(showToast).toHaveBeenCalledWith('error', 'study_error_generic', { dedupeKey: 'study:card-save' })
    expect(card('c1')?.title).toBe('Card')
  })

  it('pré-checagem: o refetch trouxe o título de lá antes do blur; conflito sem ir à rede', async () => {
    await render('u1')
    otherTab('study_cards', 'c1', row => { row.title = 'Deles' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle()
    expect(card('c1')?.title).toBe('Deles')
    await act(async () => { await hook.updateCard('c1', { title: 'Meu' }, { title: 'Card' }) })
    expect(db.writes).toEqual([])
    expect(showToast).toHaveBeenCalledWith('warning', 'study_card_conflict', expect.objectContaining({ dedupeKey: 'study:study_card_conflict' }))
  })

  it('pré-checagem sem conflito falso: duas mudanças seguidas no mesmo campo, a 1ª em voo', async () => {
    await render('u1')
    const gate = deferred()
    db.holdBefore['study_topics:update'] = gate.promise
    let first: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    // Data-alvo (onChange, sem base) e título (blur, com a base do foco: o valor que a tela mostrava).
    await act(async () => { first = hook.updateTopic('t1', { target_date: '2026-11-02' }) })
    await act(async () => { second = hook.updateTopic('t1', { target_date: '2026-11-03' }) })
    let title1: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    let title2: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    await act(async () => { title1 = hook.updateTopic('t1', { title: 'Rust 2' }, { title: 'Rust' }) })
    await act(async () => { title2 = hook.updateTopic('t1', { title: 'Rust 3' }, { title: 'Rust 2' }) })
    expect(hook.topics[0]).toMatchObject({ target_date: '2026-11-03', title: 'Rust 3' })
    await act(async () => { gate.release(); await Promise.all([first, second, title1, title2]) })
    expect(await Promise.all([first, second, title1, title2])).toEqual(['saved', 'saved', 'saved', 'saved'])
    expect(showToast).not.toHaveBeenCalled()
    expect(db.tables.study_topics[0]).toMatchObject({ target_date: '2026-11-03', title: 'Rust 3' })
    expect(hook.topics[0]).toMatchObject({ target_date: '2026-11-03', title: 'Rust 3' })
  })

  it('a 2ª gravação do mesmo campo, na fila atrás de uma que deu conflito, não passa por cima do texto de lá', async () => {
    await render('u1')
    const gate = deferred()
    db.holdBefore['study_cards:update'] = gate.promise
    let first: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    await act(async () => { first = hook.updateCard('c1', { title: 'A2' }, { title: 'Card' }) })
    // A pessoa voltou ao campo (base = o que a tela mostrava) e mudou de novo.
    await act(async () => { second = hook.updateCard('c1', { title: 'A3' }, { title: 'A2' }) })
    otherTab('study_cards', 'c1', row => { row.title = 'Deles' })
    await act(async () => { gate.release(); await first; await second })
    expect(await Promise.all([first, second])).toEqual(['conflict', 'conflict'])
    expect(dbCard('c1').title).toBe('Deles')
    expect(card('c1')?.title).toBe('Deles')
    expect(db.writes.filter(w => w.key === 'study_cards:update')).toHaveLength(1)
  })

  // Revisão do lote 06 (#1): a base da 2ª era o valor da 1ª, que falhou e
  // nunca chegou ao servidor; o servidor com o valor de antes parecia mudança
  // de outra aba, e a 2ª era descartada sem ir à rede.
  it('card: a 2ª gravação do mesmo campo, na fila atrás de uma que falhou na rede, herda a base dela e grava', async () => {
    await render('u1')
    const net = failing()
    db.holdBefore['study_cards:update'] = net.promise
    let first: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => { first = hook.updateCard('c1', { title: 'A2' }, { title: 'Card' }) })
    // A pessoa voltou ao campo com a 1ª em voo: a base é o que a tela mostra.
    expect(card('c1')?.title).toBe('A2')
    await act(async () => { second = hook.updateCard('c1', { title: 'A3' }, { title: 'A2' }) })
    delete db.holdBefore['study_cards:update']
    await act(async () => { net.fail(); await first; await second })
    expect(await Promise.all([first, second])).toEqual(['failed', 'saved'])
    expect(dbCard('c1').title).toBe('A3')
    expect(card('c1')?.title).toBe('A3')
    expect(showToast.mock.calls.map(([kind, key]: unknown[]) => [kind, key])).toEqual([['error', 'toast_error_network']])
  })

  it('tópico: a 2ª gravação do mesmo campo, atrás de uma recusada pelo RLS, herda a base dela e grava', async () => {
    await render('u1')
    once('study_topics:update', { data: [], error: null })
    let first: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => {
      first = hook.updateTopic('t1', { title: 'Rust 2' }, { title: 'Rust' })
      second = hook.updateTopic('t1', { title: 'Rust 3' }, { title: 'Rust 2' })
      await first
      await second
    })
    expect(await Promise.all([first, second])).toEqual(['failed', 'saved'])
    expect(db.tables.study_topics[0].title).toBe('Rust 3')
    expect(hook.topics[0].title).toBe('Rust 3')
    expect(showToast.mock.calls.map(([kind, key]: unknown[]) => [kind, key])).toEqual([['error', 'toast_error_permission']])
  })

  it('a base herdada vale também depois da fila esvaziar (o rascunho que voltou sai de novo), e não esconde conflito de verdade', async () => {
    await render('u1')
    db.override['study_cards:update'] = 'reject'
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { title: 'A2' }, { title: 'Card' }) })
    expect(ok).toBe('failed')
    expect(card('c1')?.title).toBe('Card')
    delete db.override['study_cards:update']
    // A pessoa tinha voltado ao campo com 'A2' na tela: base 'A2'.
    await act(async () => { ok = await hook.updateCard('c1', { title: 'A3' }, { title: 'A2' }) })
    expect(ok).toBe('saved')
    expect(dbCard('c1').title).toBe('A3')
    // Gravou: a herança some, e a mudança de outra aba volta a ser conflito.
    otherTab('study_cards', 'c1', row => { row.title = 'Deles' })
    await act(async () => { ok = await hook.updateCard('c1', { title: 'A4' }, { title: 'Card' }) })
    expect(ok).toBe('conflict')
    expect(dbCard('c1').title).toBe('Deles')
  })

  // Verificação da revisão do lote 06 (#1): a herança apagada depois de gravar.
  // Se ela ficasse, a outra aba que volta o campo ao valor de antes da falha
  // (o da base herdada) e o refetch que traz isso passariam pela pré-checagem,
  // e a gravação seguinte iria por cima do texto de lá, calada.
  const refetchNow = async () => {
    if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle()
  }

  it('card: depois que a herdeira grava, a outra aba que volta ao valor de antes da falha é conflito', async () => {
    await render('u1')
    db.override['study_cards:update'] = 'reject'
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { title: 'A2' }, { title: 'Card' }) })
    expect(ok).toBe('failed')
    delete db.override['study_cards:update']
    await act(async () => { ok = await hook.updateCard('c1', { title: 'A3' }, { title: 'A2' }) })
    expect(ok).toBe('saved')
    // A pessoa entra no campo com 'A3'; a outra aba volta para 'Card' e o refetch traz.
    otherTab('study_cards', 'c1', row => { row.title = 'Card' })
    await refetchNow()
    expect(card('c1')?.title).toBe('Card')
    showToast.mockClear()
    await act(async () => { ok = await hook.updateCard('c1', { title: 'A5' }, { title: 'A3' }) })
    expect(ok).toBe('conflict')
    expect(dbCard('c1').title).toBe('Card')
    expect(card('c1')?.title).toBe('Card')
    expect(db.writes.filter(w => w.key === 'study_cards:update').map(w => w.values)).toEqual([{ title: 'A3' }])
    expect(showToast).toHaveBeenCalledWith('warning', 'study_card_conflict', expect.objectContaining({ dedupeKey: 'study:study_card_conflict' }))
  })

  it('tópico: depois que a herdeira grava (a 1ª recusada pelo RLS), a outra aba que volta ao valor de antes é conflito', async () => {
    await render('u1')
    once('study_topics:update', { data: [], error: null })
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateTopic('t1', { title: 'Rust 2' }, { title: 'Rust' }) })
    expect(ok).toBe('failed')
    await act(async () => { ok = await hook.updateTopic('t1', { title: 'Rust 3' }, { title: 'Rust 2' }) })
    expect(ok).toBe('saved')
    otherTab('study_topics', 't1', row => { row.title = 'Rust' })
    await refetchNow()
    expect(hook.topics[0].title).toBe('Rust')
    showToast.mockClear()
    await act(async () => { ok = await hook.updateTopic('t1', { title: 'Rust 5' }, { title: 'Rust 3' }) })
    expect(ok).toBe('conflict')
    expect(db.tables.study_topics[0].title).toBe('Rust')
    expect(hook.topics[0].title).toBe('Rust')
    expect(db.writes.filter(w => w.key === 'study_topics:update').map(w => w.values)).toEqual([{ title: 'Rust 3' }])
    expect(showToast).toHaveBeenCalledWith('warning', 'study_topic_conflict', expect.objectContaining({ dedupeKey: 'study:study_topic_conflict' }))
  })

  // 2ª revisão do lote 06 (#3 e #4): o título do card e o do tópico, pelo mesmo caminho.
  const titleTargets = [
    {
      name: 'card', table: 'study_cards' as const, id: 'c1', start: 'Card', conflict: 'study_card_conflict',
      save: (title: string, base: string) => hook.updateCard('c1', { title }, { title: base }),
      server: () => dbCard('c1').title,
      screen: () => card('c1')?.title,
    },
    {
      name: 'tópico', table: 'study_topics' as const, id: 't1', start: 'Rust', conflict: 'study_topic_conflict',
      save: (title: string, base: string) => hook.updateTopic('t1', { title }, { title: base }),
      server: () => db.tables.study_topics.find(t => t.id === 't1')?.title,
      screen: () => hook.topics.find(t => t.id === 't1')?.title,
    },
  ]
  const titleWrites = (table: string) => db.writes.filter(w => w.key === `${table}:update`).map(w => w.values)

  // #3: a 1ª gravou e só a resposta se perdeu (o fetch rejeita depois do
  // commit). A herança trocava a base própria da 2ª ('A2', que é o que o
  // servidor tem) pela de antes, e a 2ª virava "mudou em outra aba" sem
  // outra aba nenhuma.
  it.each(titleTargets)('$name: a 1ª gravou e a resposta se perdeu; a 2ª, que partiu do texto dela, grava sem conflito falso', async target => {
    await render('u1')
    const net = failing()
    db.holdAfter[`${target.table}:update`] = net.promise
    let first: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => { first = target.save('A2', target.start) })
    // A pessoa voltou ao campo com a 1ª em voo (a tela mostra 'A2') e mudou de novo.
    await act(async () => { second = target.save('A3', 'A2') })
    delete db.holdAfter[`${target.table}:update`]
    await act(async () => { net.fail(); await first; await second })
    expect(await Promise.all([first, second])).toEqual(['failed', 'saved'])
    expect(target.server()).toBe('A3')
    expect(target.screen()).toBe('A3')
    expect(showToast.mock.calls.map(([kind, key]: unknown[]) => [kind, key])).toEqual([['error', 'toast_error_network']])
  })

  // A herança vale para o mesmo rascunho que volta e sai de novo, mesmo
  // depois de duas falhas seguidas (a 2ª tinha herdado da 1ª).
  it.each(titleTargets)('$name: duas falhas seguidas; o rascunho que voltou (base: o texto da 1ª) sai de novo e grava', async target => {
    await render('u1')
    db.override[`${target.table}:update`] = 'reject'
    let first: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => {
      first = target.save('A2', target.start)
      second = target.save('A3', 'A2')
      await first
      await second
    })
    expect(await Promise.all([first, second])).toEqual(['failed', 'failed'])
    delete db.override[`${target.table}:update`]
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await target.save('A3', 'A2') })
    expect(ok).toBe('saved')
    expect(target.server()).toBe('A3')
  })

  // #4: a herança não tinha fim. Sobrevivia ao conflito da pré-checagem e
  // valia para qualquer edição seguinte: a outra aba que volta o campo ao
  // valor de antes da falha era sobrescrita calada.
  it.each(titleTargets.flatMap(target => [{ ...target, resend: true }, { ...target, resend: false }]))(
    '$name: depois da falha, a edição que partiu de outro texto não herda; a outra aba de volta ao valor de antes é conflito (rascunho reenviado antes: $resend)',
    async target => {
      await render('u1')
      db.override[`${target.table}:update`] = 'reject'
      let ok: StudyFieldOutcome | undefined
      await act(async () => { ok = await target.save('A2', target.start) })
      expect(ok).toBe('failed')
      delete db.override[`${target.table}:update`]
      otherTab(target.table, target.id, row => { row.title = 'Deles' })
      await refetchNow()
      if (target.resend) {
        // O rascunho que voltou sai de novo: conflito na pré-checagem, sem ir à rede.
        await act(async () => { ok = await target.save('A2', target.start) })
        expect(ok).toBe('conflict')
      }
      // A pessoa entra no campo, que mostra 'Deles', e digita 'Meu'; a outra
      // aba volta o título ao de antes, e o refetch traz.
      otherTab(target.table, target.id, row => { row.title = target.start })
      await refetchNow()
      showToast.mockClear()
      await act(async () => { ok = await target.save('Meu', 'Deles') })
      expect(ok).toBe('conflict')
      expect(target.server()).toBe(target.start)
      expect(target.screen()).toBe(target.start)
      expect(titleWrites(target.table)).toEqual([])
      expect(showToast).toHaveBeenCalledWith('warning', target.conflict, expect.objectContaining({ dedupeKey: `study:${target.conflict}` }))
    },
  )

  // O conflito da pré-checagem também é fim de gravação e apaga a herança.
  // Se ela ficasse, a cadeia de duas falhas ('A3' partiu de 'A2', que falhou
  // antes) deixaria a base 'A2' herdando a de antes: a edição que parte de
  // 'A2' (que outra aba pôs lá depois) passaria calada por cima da outra aba
  // que voltou ao valor de antes.
  it.each(titleTargets)('$name: o conflito da pré-checagem apaga a herança', async target => {
    await render('u1')
    db.override[`${target.table}:update`] = 'reject'
    let first: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => {
      first = target.save('A2', target.start)
      second = target.save('A3', 'A2')
      await first
      await second
    })
    expect(await Promise.all([first, second])).toEqual(['failed', 'failed'])
    delete db.override[`${target.table}:update`]
    otherTab(target.table, target.id, row => { row.title = 'Deles' })
    await refetchNow()
    // O rascunho que voltou ('A3', base 'A2') sai de novo: conflito na pré-checagem.
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await target.save('A3', 'A2') })
    expect(ok).toBe('conflict')
    otherTab(target.table, target.id, row => { row.title = 'A2' })
    await refetchNow()
    expect(target.screen()).toBe('A2')
    otherTab(target.table, target.id, row => { row.title = target.start })
    await refetchNow()
    await act(async () => { ok = await target.save('Meu', 'A2') })
    expect(ok).toBe('conflict')
    expect(target.server()).toBe(target.start)
    expect(titleWrites(target.table)).toEqual([])
  })

  // O valor que falhou chegou ao servidor (a resposta se perdeu) e o refetch
  // o trouxe: a herança acaba. Se ficasse, a edição que parte dele herdaria a
  // base de antes, e a outra aba que volta a ela seria sobrescrita calada.
  it.each(titleTargets)('$name: o refetch que traz o valor que falhou encerra a herança', async target => {
    await render('u1')
    const net = failing()
    db.holdAfter[`${target.table}:update`] = net.promise
    let save: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => { save = target.save('A2', target.start) })
    delete db.holdAfter[`${target.table}:update`]
    await act(async () => { net.fail(); await save })
    expect(await save).toBe('failed')
    await refetchNow()
    expect(target.screen()).toBe('A2')
    // A pessoa entra no campo com 'A2' e digita 'Meu'; a outra aba volta ao de antes.
    otherTab(target.table, target.id, row => { row.title = target.start })
    await refetchNow()
    showToast.mockClear()
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await target.save('Meu', 'A2') })
    expect(ok).toBe('conflict')
    expect(target.server()).toBe(target.start)
    expect(titleWrites(target.table)).toEqual([{ title: 'A2' }])
  })

  // 3ª revisão do lote 06: as composições da resposta perdida com a herança.
  /** A n-ésima chamada de `key` rejeita (rede); as outras vão ao banco. */
  function rejectNth(key: string, nth: number) {
    let n = 0
    Object.defineProperty(db.override, key, {
      configurable: true, enumerable: true,
      get: () => { n++; return n === nth ? 'reject' : undefined },
    })
  }

  // A 1ª ('A2') grava e a resposta se perde; a 2ª ('A3', base 'A2') herda,
  // relê 'A2' e a nova tentativa falha na rede. A base que ela deixa é a da
  // linha relida ('A2'), não a de antes ('Card'): a outra aba que volta o
  // título a 'Card' é conflito para o rascunho dela que sai de novo.
  it.each(titleTargets)('$name: a 2ª falha depois de reler deixa a base da linha relida', async target => {
    await render('u1')
    const net = failing()
    db.holdAfter[`${target.table}:update`] = net.promise
    let first: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('saved')
    await act(async () => { first = target.save('A2', target.start) })
    await act(async () => { second = target.save('A3', 'A2') })
    delete db.holdAfter[`${target.table}:update`]
    // 1 = a 2ª na versão de antes (0 linhas), 2 = a 2ª refeita (rede).
    rejectNth(`${target.table}:update`, 2)
    await act(async () => { net.fail(); await first; await second })
    expect(await Promise.all([first, second])).toEqual(['failed', 'failed'])
    expect(target.server()).toBe('A2')
    delete db.override[`${target.table}:update`]
    otherTab(target.table, target.id, row => { row.title = target.start })
    await refetchNow()
    showToast.mockClear()
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await target.save('A3', 'A2') })
    expect(ok).toBe('conflict')
    expect(target.server()).toBe(target.start)
    expect(showToast).toHaveBeenCalledWith('warning', target.conflict, expect.anything())
  })

  // A resposta se perdeu e o rascunho voltou ('A2', base a de antes); a
  // pessoa o completa e sai. O servidor tem 'A2', o texto dela: grava, com ou
  // sem um refetch no meio.
  it.each(titleTargets.flatMap(t => [{ ...t, refetch: false }, { ...t, refetch: true }]))(
    '$name: o rascunho que voltou, editado, grava sobre o texto dele (refetch antes: $refetch)', async target => {
      await render('u1')
      const net = failing()
      db.holdAfter[`${target.table}:update`] = net.promise
      let save: Promise<StudyFieldOutcome> = Promise.resolve('saved')
      await act(async () => { save = target.save('A2', target.start) })
      delete db.holdAfter[`${target.table}:update`]
      await act(async () => { net.fail(); await save })
      expect(await save).toBe('failed')
      if (target.refetch) await refetchNow()
      showToast.mockClear()
      let ok: StudyFieldOutcome | undefined
      await act(async () => { ok = await target.save('A2 e mais', target.start) })
      expect(ok).toBe('saved')
      expect(target.server()).toBe('A2 e mais')
      expect(target.screen()).toBe('A2 e mais')
      expect(showToast).not.toHaveBeenCalled()
    })

  // A gravação que grava apaga a herança: depois do rascunho reenviado, a
  // edição que parte do texto dele e a outra aba de volta ao de antes é conflito.
  it.each(titleTargets)('$name: a gravação que grava apaga a herança', async target => {
    await render('u1')
    db.override[`${target.table}:update`] = 'reject'
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await target.save('A2', target.start) })
    expect(ok).toBe('failed')
    delete db.override[`${target.table}:update`]
    await act(async () => { ok = await target.save('A2', target.start) })
    expect(ok).toBe('saved')
    otherTab(target.table, target.id, row => { row.title = target.start })
    await refetchNow()
    showToast.mockClear()
    await act(async () => { ok = await target.save('A5', 'A2') })
    expect(ok).toBe('conflict')
    expect(target.server()).toBe(target.start)
    expect(titleWrites(target.table)).toEqual([{ title: 'A2' }])
  })

  it('updateTopic não manda datas nem versão no corpo e adota as que voltam', async () => {
    await render('u1')
    await act(async () => { await hook.updateTopic('t1', { status: 'studying' }) })
    const write = db.writes.find(w => w.key === 'study_topics:update')!
    expect(write.values).toEqual({ status: 'studying' })
    expect(write.filters.map(([col]) => col)).toEqual(['id', 'updated_at'])
    expect(hook.topics[0]).toMatchObject({ status: 'studying', started_at: db.tables.study_topics[0].started_at, updated_at: db.tables.study_topics[0].updated_at })
    expect(hook.topics[0].started_at).toBeTruthy()
  })

  it('a resposta atrasada da gravação antiga não apaga as datas da mais nova', async () => {
    await render('u1')
    const gate = deferred()
    db.holdBefore['study_topics:update'] = gate.promise
    let first: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    let second: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    await act(async () => { first = hook.updateTopic('t1', { status: 'studying' }) })
    await act(async () => { second = hook.updateTopic('t1', { status: 'completed' }) })
    await act(async () => { gate.release(); await first; await second })
    expect(hook.topics[0]).toMatchObject({ status: 'completed', completed_at: db.tables.study_topics[0].completed_at })
    expect(hook.topics[0].completed_at).toBeTruthy()
  })

  it('recusa do RLS (0 linhas na mesma versão): volta o valor e avisa de permissão', async () => {
    await render('u1')
    db.override['study_cards:update'] = { data: [], error: null }
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { due_date: '2026-11-01' }) })
    expect(ok).toBe('failed')
    expect(card('c1')?.due_date).toBeNull()
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_permission', { dedupeKey: 'study:card-save' })
  })

  it('card apagado em outra aba ao salvar: sai da tela', async () => {
    await render('u1')
    db.tables.study_cards = db.tables.study_cards.filter(c => c.id !== 'c2')
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c2', { title: 'x' }, { title: 'Dois' }) })
    expect(ok).toBe('conflict')
    expect(card('c2')).toBeUndefined()
    expect(await hook.updateCard('nao-existe', { title: 'x' })).toBe('conflict')
  })
})

describe('useStudyTopics: refetch ao voltar o foco', () => {
  const focus = async () => {
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle()
  }
  const reads = () => db.log.filter(key => key === 'study_cards:select').length

  it('traz o card criado na outra aba, no máximo um a cada intervalo, com uma rodada no fim do intervalo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    await settle()
    expect(reads()).toBe(1)
    db.tables.study_cards.push({ ...fake.clone(db.tables.study_cards[1]), id: 'c-outra', title: 'Da outra aba', sort_order: 2, updated_at: fake.version() })
    // Dentro do intervalo da carga: nada agora, uma rodada no fim.
    await focus()
    expect(reads()).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(STUDY_REFETCH_GAP_MS) })
    await settle()
    expect(reads()).toBe(2)
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2', 'c-outra'])
    expect(hook.loading).toBe(false)
    // Fora do intervalo: na hora.
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(reads()).toBe(3)
    // Aba escondida não relê.
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(reads()).toBe(3)
    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(reads()).toBe(4)
  })

  it('não pisa na gravação pendente: a versão de lá entra com o ponto marcado por cima', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    const gate = deferred()
    db.holdBefore['rpc:study_checkpoint_toggle'] = gate.promise
    let toggle: Promise<boolean> = Promise.resolve(false)
    await act(async () => { toggle = hook.toggleCheckpoint('c1', 'p1') })
    otherTab('study_cards', 'c1', row => { row.title = 'Deles' })
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(card('c1')).toMatchObject({ title: 'Deles', checkpoints: [{ id: 'p1', completed: true }] })
    await act(async () => { gate.release(); await toggle })
    expect(card('c1')).toMatchObject({ title: 'Deles', checkpoints: [{ id: 'p1', completed: true }] })
  })

  it('erro no refetch não avisa nem mostra carregando', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    db.override['study_logs:select'] = { data: null, error: { message: 'Failed to fetch' } }
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(showToast).not.toHaveBeenCalled()
    expect(hook.loading).toBe(false)
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  // Revisão do lote 06 (#2): o refetch só rodava depois de uma carga que deu
  // certo, e a tela ficava vazia até trocar de seção ou dar F5.
  it('carga inicial que falhou: o foco depois do intervalo traz os tópicos', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    db.override['study_cards:select'] = { data: null, error: { message: 'Failed to fetch' } }
    await render('u1')
    await settle()
    expect(hook.loading).toBe(false)
    expect(hook.topics).toEqual([])
    delete db.override['study_cards:select']
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(hook.topics.map(t => t.id)).toEqual(['t1', 't2'])
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(hook.logsByTopic.t1.map(l => l.id)).toEqual(['l1'])
    // As linhas entraram no livro: a gravação seguinte vai à rede.
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateCard('c1', { title: 'Meu' }, { title: 'Card' }) })
    expect(ok).toBe('saved')
  })

  // Revisão do lote 06 (#4): o .finally do refetch em voo reagendava depois da
  // limpeza, e uns 5 s depois relia tudo com o hook desmontado.
  it('desmontar com o refetch em voo e outro pedido na fila: nada reagenda nem relê depois', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    await settle()
    const gate = deferred()
    db.holdAfter['study_cards:select'] = gate.promise
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    // Outro pedido com o refetch em voo, já depois do mesmo retorno à aba.
    vi.setSystemTime(Date.now() + STUDY_REFETCH_SAME_RETURN_MS + 1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    const before = reads()
    expect(before).toBe(2)
    act(() => root.unmount())
    await act(async () => { gate.release() })
    await settle()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(STUDY_REFETCH_GAP_MS * 2) })
    await settle()
    expect(reads()).toBe(before)
  })

  it('troca de usuário com o refetch em voo: a resposta do anterior não entra na tela do novo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    db.tables.study_topics.push({ ...fake.clone(db.tables.study_topics[1]), id: 't-u2', user_id: 'u2', title: 'Do outro' })
    await render('u1')
    await settle()
    const gate = deferred()
    db.holdAfter['study_cards:select'] = gate.promise
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    // A carga do novo usuário não espera: ela termina antes do refetch velho.
    delete db.holdAfter['study_cards:select']
    await render('u2')
    await settle()
    expect(hook.topics.map(t => t.id)).toEqual(['t-u2'])
    await act(async () => { gate.release() })
    await settle()
    expect(hook.topics.map(t => t.id)).toEqual(['t-u2'])
    expect(hook.cardsByTopic.t1).toBeUndefined()
    expect(hook.goneTopicIds.size).toBe(0)
  })

  it('uma volta à aba (visibilitychange e focus juntos) relê uma vez só', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    await settle()
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await settle()
    expect(reads()).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(STUDY_REFETCH_GAP_MS * 2) })
    await settle()
    expect(reads()).toBe(2)
  })

  it('tópico excluído em outra aba: some e fica marcado para a tela avisar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    db.tables.study_topics = db.tables.study_topics.filter(t => t.id !== 't2')
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(hook.topics.map(t => t.id)).toEqual(['t1'])
    expect(hook.goneTopicIds.has('t2')).toBe(true)
  })

  // As três corridas da crítica, no hook: o refetch leu antes da gravação e a resposta chegou depois.
  it('card criado, card excluído e ponto marcado durante o refetch não são desfeitos por ele', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    const gate = deferred()
    db.holdAfter['study_cards:select'] = gate.promise
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle()
    await act(async () => { await hook.createCard('t1') })
    await act(async () => { await hook.deleteCard('c2') })
    await act(async () => { await hook.toggleCheckpoint('c1', 'p1') })
    const created = hook.cardsByTopic.t1.at(-1)!.id
    await act(async () => { gate.release() })
    await settle()
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', created])
    expect(card('c1')?.checkpoints[0].completed).toBe(true)
    // O refetch seguinte (já sem a gravação no meio) confirma o mesmo.
    delete db.holdAfter['study_cards:select']
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', created])
  })

  // 2ª revisão do lote 06 (#2): o P0002 tirava da tela o tópico (ou o card)
  // excluído em outra aba, mas o refetch em voo, que leu antes da exclusão, o
  // trazia de volta com os cards e o diário. A resposta dele fica presa no
  // diário (a última leitura), e as releituras dos cards saem na hora.
  const refetchInFlight = async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await render('u1')
    await settle()
    const gate = deferred()
    db.holdAfter['study_logs:select'] = gate.promise
    return {
      start: async () => {
        vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
        await act(async () => { window.dispatchEvent(new Event('focus')) })
        await settle()
      },
      finish: async () => {
        await act(async () => { gate.release() })
        await settle()
        delete db.holdAfter['study_logs:select']
      },
    }
  }

  it.each([
    ['criar card', () => hook.createCard('t1')],
    ['anexar .md', () => hook.appendCards('t1', [{ title: 'A', description: '', rationale: '', checkpoints: [], resources: [], quiz: [] }])],
    ['recalcular', () => hook.rescheduleCards('t1')],
    ['gravar o título', () => hook.updateTopic('t1', { title: 'Rust 2' }, { title: 'Rust' })],
  ] as const)('tópico excluído em outra aba com o refetch em voo (P0002 ao %s): a resposta dele não o traz de volta', async (_name, run) => {
    const refetch = await refetchInFlight()
    // Card e diário que a outra aba criou antes: o refetch os lê, esta aba nunca os viu.
    db.tables.study_cards.push({ ...fake.clone(db.tables.study_cards[1]), id: 'c-outra', sort_order: 2, updated_at: fake.version() })
    db.tables.study_logs.push({ id: 'l-outra', user_id: 'u1', topic_id: 't1', content: 'lá', created_at: fake.version() })
    await refetch.start()
    // A outra aba exclui t1 (a FK leva cards e diário), e esta aba esbarra no P0002.
    db.tables.study_topics = db.tables.study_topics.filter(t => t.id !== 't1')
    db.tables.study_cards = db.tables.study_cards.filter(c => c.topic_id !== 't1')
    db.tables.study_logs = db.tables.study_logs.filter(l => l.topic_id !== 't1')
    await act(async () => { await run() })
    expect(hook.topics.map(t => t.id)).toEqual(['t2'])
    await refetch.finish()
    expect(hook.topics.map(t => t.id)).toEqual(['t2'])
    expect(hook.cardsByTopic.t1).toBeUndefined()
    expect(hook.logsByTopic.t1).toBeUndefined()
    expect(hook.goneTopicIds.has('t1')).toBe(true)
    // O refetch seguinte, que saiu depois da exclusão, confirma.
    vi.setSystemTime(Date.now() + STUDY_REFETCH_GAP_MS + 1)
    await focus()
    expect(hook.topics.map(t => t.id)).toEqual(['t2'])
    expect(hook.cardsByTopic.t1).toBeUndefined()
  })

  it.each([
    ['somar um ponto: P0002 e a releitura', () => hook.addCheckpoint('c2', { id: 'p-novo', text: 'Novo' })],
    ['gravar o título: a linha sumiu', () => hook.updateCard('c2', { title: 'X' }, { title: 'Dois' })],
  ] as const)('card excluído em outra aba com o refetch em voo (%s): a resposta dele não o traz de volta', async (_name, run) => {
    const refetch = await refetchInFlight()
    await refetch.start()
    db.tables.study_cards = db.tables.study_cards.filter(c => c.id !== 'c2')
    await act(async () => { await run() })
    expect(card('c2')).toBeUndefined()
    await refetch.finish()
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1'])
    expect(showToast).toHaveBeenCalledWith('info', 'study_item_gone', { dedupeKey: 'study:study_item_gone' })
  })
})

describe('useStudyTopics: criar, importar e reagendar numa chamada', () => {
  const parsed = (titles: string[]): StudyParseResult => ({
    topic: { title: 'Do md', area: 'Área', level: null, objective: null },
    cards: titles.map(title => ({ title, description: '', rationale: '', checkpoints: [], resources: [], quiz: [] })),
    warnings: [],
    dropped: [],
  })

  it('createCard vai pelo append, sem sort_order: o servidor põe no fim', async () => {
    await render('u1')
    let ok: boolean | undefined
    await act(async () => { ok = await hook.createCard('t1') })
    expect(ok).toBe(true)
    expect(db.rpcArgs).toEqual([['study_cards_append', { p_topic: 't1', p_cards: [{ title: '' }] }]])
    expect(db.writes).toEqual([])
    const created = hook.cardsByTopic.t1.at(-1)!
    expect(created.sort_order).toBe(2)
  })

  it('importar é uma chamada só: tópico e cards juntos, sem datas do aparelho', async () => {
    await render('u1')
    let result: Awaited<ReturnType<typeof hook.createTopicFromImport>> | undefined
    await act(async () => { result = await hook.createTopicFromImport(parsed(['A', 'B']), { title: '', target_date: '2026-12-31' }) })
    expect(result?.ok).toBe(true)
    expect(db.log.filter(key => !key.endsWith(':select'))).toEqual(['rpc:study_import_topic'])
    const [, args] = db.rpcArgs[0]
    expect(args.p_payload).toEqual({
      topic: { title: 'Do md', area: 'Área', level: '', objective: '', target_date: '2026-12-31' },
      cards: [
        { title: 'A', description: '', rationale: '', checkpoints: [], resources: [], quiz: [] },
        { title: 'B', description: '', rationale: '', checkpoints: [], resources: [], quiz: [] },
      ],
    })
    expect(args.p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const topicId = result?.ok ? result.topic.id : ''
    expect(hook.topics[0].id).toBe(topicId)
    expect(hook.cardsByTopic[topicId].map(c => c.title)).toEqual(['A', 'B'])
  })

  it('card ruim na importação: nada é criado e a mensagem diz o número e o título do card', async () => {
    await render('u1')
    let result: Awaited<ReturnType<typeof hook.createTopicFromImport>> | undefined
    await act(async () => { result = await hook.createTopicFromImport(parsed(['A', 'RUIM']), { title: 'X' }) })
    expect(result).toEqual({ ok: false, message: 'study_error_import_card {"n":2,"title":"RUIM"}' })
    expect(db.tables.study_topics).toHaveLength(2)
    expect(hook.topics).toHaveLength(2)
    expect(showToast).not.toHaveBeenCalled()
    let append: { count: number; message?: string } | undefined
    await act(async () => { append = await hook.appendCards('t1', parsed(['RUIM']).cards) })
    expect(append).toEqual({ count: 0, message: 'study_error_import_card {"n":1,"title":"RUIM"}' })
    await act(async () => { append = await hook.appendCards('t1', parsed(['C', 'D']).cards) })
    expect(append).toEqual({ count: 2 })
    expect(hook.cardsByTopic.t1.map(c => c.title)).toEqual(['Card', 'Dois', 'C', 'D'])
  })

  it('título do tópico vazio, ou formulário que estoura os 4 MiB, nem chegam ao servidor', async () => {
    await render('u1')
    const empty = { ...parsed(['A']), topic: { title: null, area: null, level: null, objective: null } }
    let result: Awaited<ReturnType<typeof hook.createTopicFromImport>> | undefined
    await act(async () => { result = await hook.createTopicFromImport(empty, { title: '  ' }) })
    expect(result).toEqual({ ok: false, message: 'study_error_generic' })
    await act(async () => { result = await hook.createTopicFromImport(parsed(['A']), { title: 'X', objective: 'o'.repeat(4 * 1024 * 1024) }) })
    expect(result).toEqual({ ok: false, message: 'study_error_import_too_large' })
    expect(db.rpcArgs).toEqual([])
  })

  it('reagendar é uma chamada; no card com título pendente, o prazo novo entra e o título refaz com a versão nova', async () => {
    await render('u1')
    const gate = deferred()
    db.holdBefore['study_cards:update'] = gate.promise
    let save: Promise<StudyFieldOutcome> = Promise.resolve('failed')
    await act(async () => { save = hook.updateCard('c1', { title: 'Meu' }, { title: 'Card' }) })
    let ok: boolean | undefined
    await act(async () => { ok = await hook.rescheduleCards('t1') })
    expect(ok).toBe(true)
    expect(db.rpcArgs.map(([name, a]) => [name, a.p_topic, typeof a.p_today])).toEqual([['study_reschedule', 't1', 'string']])
    expect(card('c1')).toMatchObject({ title: 'Meu', due_date: '2026-11-01' })
    expect(card('c2')?.due_date).toBe('2026-12-31')
    await act(async () => { gate.release(); expect(await save).toBe('saved') })
    expect(card('c1')).toMatchObject({ title: 'Meu', due_date: '2026-11-01' })
    expect(dbCard('c1')).toMatchObject({ title: 'Meu', due_date: '2026-11-01' })
    expect(showToast).not.toHaveBeenCalled()
    // Tópico sem meta: nada sai.
    expect(await hook.rescheduleCards('t2')).toBe(false)
  })

  // Revisão do lote 06 (#3): o P0002 dessas RPCs virava aviso genérico, e o
  // tópico excluído ficava aberto.
  it.each([
    ['criar card', () => hook.createCard('t1'), false],
    ['anexar .md', () => hook.appendCards('t1', parsed(['A']).cards), { count: 0, message: 'study_topic_deleted_elsewhere' }],
    ['recalcular', () => hook.rescheduleCards('t1'), false],
  ] as const)('tópico excluído em outra aba (P0002) ao %s: sai da tela com cards e diário, marcado, com aviso', async (_name, run, expected) => {
    await render('u1')
    db.tables.study_topics = db.tables.study_topics.filter(t => t.id !== 't1')
    db.tables.study_cards = db.tables.study_cards.filter(c => c.topic_id !== 't1')
    let result: unknown
    await act(async () => { result = await run() })
    expect(result).toEqual(expected)
    expect(hook.topics.map(t => t.id)).toEqual(['t2'])
    expect(hook.goneTopicIds.has('t1')).toBe(true)
    expect(hook.cardsByTopic.t1).toBeUndefined()
    expect(hook.logsByTopic.t1).toBeUndefined()
    expect(showToast.mock.calls).toEqual([['info', 'study_topic_deleted_elsewhere', { dedupeKey: 'study:topic-gone' }]])
  })

  it('recalcular com a meta tirada em outra aba (P0001): relê o tópico, a meta some da tela e o aviso diz por quê', async () => {
    await render('u1')
    otherTab('study_topics', 't1', row => { row.target_date = null })
    let ok: boolean | undefined
    await act(async () => { ok = await hook.rescheduleCards('t1') })
    expect(ok).toBe(false)
    expect(hook.topics.find(t => t.id === 't1')?.target_date).toBeNull()
    expect(showToast.mock.calls).toEqual([['info', 'study_reschedule_no_target', { dedupeKey: 'study:reschedule-no-target' }]])
    expect(hook.goneTopicIds.size).toBe(0)
  })

  it('a gravação do tópico sem linha (excluído em outra aba) também o marca', async () => {
    await render('u1')
    db.tables.study_topics = db.tables.study_topics.filter(t => t.id !== 't2')
    let ok: StudyFieldOutcome | undefined
    await act(async () => { ok = await hook.updateTopic('t2', { status: 'studying' }) })
    expect(ok).toBe('conflict')
    expect(hook.topics.map(t => t.id)).toEqual(['t1'])
    expect(hook.goneTopicIds.has('t2')).toBe(true)
  })

  it('criar tópico à mão e o diário', async () => {
    await render('u1')
    let topic: Awaited<ReturnType<typeof hook.createTopicManual>> = null
    await act(async () => { topic = await hook.createTopicManual({ title: ' Novo ', target_date: null }) })
    expect(hook.topics[0]).toMatchObject({ title: 'Novo', status: 'planned' })
    expect(topic).not.toBeNull()
    await act(async () => { await hook.addLog('t1', 'estudei') })
    expect(hook.logsByTopic.t1.map(l => l.content)).toEqual(['estudei', 'oi'])
    await act(async () => { await hook.deleteLog('l1') })
    expect(hook.logsByTopic.t1.map(l => l.content)).toEqual(['estudei'])
  })
})

describe('useStudyTopics: excluir', () => {
  it('excluir tópico que falha devolve tópico, cards e diário no lugar', async () => {
    await render('u1')
    db.override['study_topics:delete'] = { data: null, error: { message: 'Failed to fetch' } }
    await act(async () => { await hook.deleteTopic('t1') })
    expect(hook.topics.map(t => t.id)).toEqual(['t1', 't2'])
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(hook.logsByTopic.t1.map(l => l.id)).toEqual(['l1'])
    expect(showToast).toHaveBeenCalledWith('error', 'toast_error_network', { dedupeKey: 'study:delete' })
  })

  it('excluir card e diário que falham devolve na mesma posição; que gravam, somem', async () => {
    await render('u1')
    db.override['study_cards:delete'] = { data: null, error: { message: 'Failed to fetch' } }
    db.override['study_logs:delete'] = { data: null, error: { message: 'Failed to fetch' } }
    await act(async () => { await hook.deleteCard('c1') })
    await act(async () => { await hook.deleteLog('l1') })
    expect(hook.cardsByTopic.t1.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(hook.logsByTopic.t1.map(l => l.id)).toEqual(['l1'])
    db.override = {}
    await act(async () => { await hook.deleteTopic('t1') })
    expect(hook.topics.map(t => t.id)).toEqual(['t2'])
    expect(hook.cardsByTopic.t1).toBeUndefined()
    expect(db.tables.study_cards).toEqual([])
  })
})

describe('useStudyTopics: servidor sem as RPCs (PGRST202)', () => {
  it('a primeira falha marca o módulo: aviso fixo, e listas, criar card, importar e reagendar param', async () => {
    await render('u1')
    db.override['rpc:study_checkpoint_toggle'] = {
      data: null, error: { message: 'Could not find the function public.study_checkpoint_toggle in the schema cache', code: 'PGRST202' },
    }
    let ok: boolean | undefined
    await act(async () => { ok = await hook.toggleCheckpoint('c1', 'p1') })
    expect(ok).toBe(false)
    expect(card('c1')?.checkpoints[0].completed).toBe(false)
    expect(hook.serverOutdated).toBe(true)
    expect(showToast).toHaveBeenCalledWith('error', 'study_error_server_outdated', { dedupeKey: 'study:outdated' })
    const before = db.rpcArgs.length
    await act(async () => {
      expect(await hook.addCheckpoint('c1', { id: 'p9', text: 'x' })).toBe(false)
      expect(await hook.createCard('t1')).toBe(false)
      expect(await hook.rescheduleCards('t1')).toBe(false)
      expect(await hook.appendCards('t1', [])).toEqual({ count: 0, message: 'study_error_server_outdated' })
      expect(await hook.createTopicFromImport({ topic: { title: 'X', area: null, level: null, objective: null }, cards: [], warnings: [], dropped: [] }, { title: 'X' }))
        .toEqual({ ok: false, message: 'study_error_server_outdated' })
    })
    expect(db.rpcArgs.length).toBe(before)
    // Os campos escalares continuam (UPDATE na tabela).
    await act(async () => { expect(await hook.updateCard('c1', { title: 'Ainda grava' }, { title: 'Card' })).toBe('saved') })
  })

  it('o import recusado por PGRST202 também marca o módulo', async () => {
    await render('u1')
    db.override['rpc:study_import_topic'] = { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } }
    let result: Awaited<ReturnType<typeof hook.createTopicFromImport>> | undefined
    await act(async () => { result = await hook.createTopicFromImport({ topic: { title: 'X', area: null, level: null, objective: null }, cards: [], warnings: [], dropped: [] }, { title: 'X' }) })
    expect(result).toEqual({ ok: false, message: 'study_error_server_outdated' })
    expect(hook.serverOutdated).toBe(true)
  })
})

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '../../test/rtl'
import type { StudyCard, StudyTopic } from '../../types'
import type { StudyStore } from './useStudyTopics'

// API-029: a tela sobre o store (mockado aqui; o hook tem o próprio teste).
// O aviso fixo de servidor desatualizado desliga listas, criar card, anexar e
// recalcular; o tópico aberto excluído em outra aba vira um aviso; título,
// área e objetivo gravam com a base do foco; o passo do roteiro com um campo
// em edição não fecha quando o refetch muda o passo atual; a recusa do anexar
// mostra a mensagem do hook.

const h = vi.hoisted(() => ({ store: null as unknown as StudyStore }))

vi.mock('./useStudyTopics', async importOriginal => ({
  ...await importOriginal<typeof import('./useStudyTopics')>(),
  useStudyTopics: () => h.store,
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useModuleTour', () => ({ useModuleTour: () => {} }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'pt-BR' }) }))

const StudySection = (await import('./StudySection')).default

const topic: StudyTopic = {
  id: 't1', user_id: 'u1', title: 'Rust', area: 'Programação', level: '', objective: 'Aprender', status: 'studying',
  target_date: '2026-12-31', started_at: null, completed_at: null, created_at: '', updated_at: 'v1',
}
const card = (completed = false): StudyCard => ({
  id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card', description: '', rationale: '',
  checkpoints: [{ id: 'p1', text: 'Ler', completed }], resources: [], quiz: [],
  sort_order: 0, due_date: null, created_at: '', updated_at: 'v1',
})

function makeStore(over: Partial<StudyStore> = {}): StudyStore {
  const done = () => Promise.resolve(true)
  const saved = () => Promise.resolve('saved' as const)
  return {
    topics: [topic], cardsByTopic: { t1: [card()] }, logsByTopic: {}, loading: false, goneTopicIds: new Set<string>(), serverOutdated: false,
    createTopicManual: vi.fn(() => Promise.resolve(null)),
    createTopicFromImport: vi.fn(() => Promise.resolve({ ok: false as const, message: 'MSG' })),
    updateTopic: vi.fn(saved), deleteTopic: vi.fn(() => Promise.resolve()), createCard: vi.fn(done), updateCard: vi.fn(saved),
    addCheckpoint: vi.fn(done), editCheckpoint: vi.fn(done), toggleCheckpoint: vi.fn(done), removeCheckpoint: vi.fn(done),
    addResource: vi.fn(done), removeResource: vi.fn(done), answerQuiz: vi.fn(done), resetQuiz: vi.fn(done),
    deleteCard: vi.fn(() => Promise.resolve()),
    appendCards: vi.fn(() => Promise.resolve({ count: 0, message: 'O card 1 ("X") não pôde ser importado' })),
    rescheduleCards: vi.fn(done), addLog: vi.fn(() => Promise.resolve()), deleteLog: vi.fn(() => Promise.resolve()),
    ...over,
  }
}

function openTopic(over: Partial<StudyStore> = {}) {
  h.store = makeStore(over)
  const view = render(<StudySection />)
  fireEvent.click(screen.getAllByText('Rust')[0])
  return view
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })

describe('StudySection e StudyTopicDetail (API-029)', () => {
  it('servidor desatualizado: aviso fixo, e listas, criar card, anexar e recalcular desligados', () => {
    openTopic({ serverOutdated: true })
    expect(screen.getByRole('alert').textContent).toBe('study_error_server_outdated')
    expect(button('study_add_card').disabled).toBe(true)
    expect(button('study_import_append').disabled).toBe(true)
    expect(button('study_reschedule').disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
  })

  it('servidor em dia: as operações saem pelo store, com o card certo', async () => {
    openTopic()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(h.store.toggleCheckpoint).toHaveBeenCalledWith('c1', 'p1')
    fireEvent.click(button('study_reschedule'))
    expect(h.store.rescheduleCards).toHaveBeenCalledWith('t1')
    fireEvent.click(button('study_add_card'))
    expect(h.store.createCard).toHaveBeenCalledWith('t1')
    // Remover ponto passa pela confirmação e vai pela RPC do item.
    fireEvent.click(button('common_remove'))
    await act(async () => { fireEvent.click(button('confirm_delete_confirm')) })
    expect(h.store.removeCheckpoint).toHaveBeenCalledWith('c1', 'p1')
  })

  it('título, área e objetivo gravam com a base do foco; status grava sem base', () => {
    openTopic()
    const title = screen.getByDisplayValue<HTMLInputElement>('Rust')
    fireEvent.focus(title)
    fireEvent.change(title, { target: { value: 'Rust 2' } })
    fireEvent.blur(title)
    expect(h.store.updateTopic).toHaveBeenCalledWith('t1', { title: 'Rust 2' }, { title: 'Rust' })
    const area = screen.getByDisplayValue<HTMLInputElement>('Programação')
    fireEvent.focus(area)
    fireEvent.change(area, { target: { value: 'Prog' } })
    fireEvent.blur(area)
    expect(h.store.updateTopic).toHaveBeenCalledWith('t1', { area: 'Prog' }, { area: 'Programação' })
    // Título em branco não grava; foco sem mudança também não.
    fireEvent.focus(title)
    fireEvent.change(title, { target: { value: '  ' } })
    fireEvent.blur(title)
    const objective = screen.getByDisplayValue<HTMLTextAreaElement>('Aprender')
    fireEvent.focus(objective)
    fireEvent.blur(objective)
    expect(h.store.updateTopic).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByDisplayValue('study_status_studying'), { target: { value: 'paused' } })
    expect(h.store.updateTopic).toHaveBeenLastCalledWith('t1', { status: 'paused' })
  })

  it('o título do card grava com a base, e o passo com o campo em edição não fecha quando o refetch o conclui', () => {
    const { rerender } = openTopic()
    const cardTitle = screen.getByDisplayValue<HTMLInputElement>('Card')
    fireEvent.focus(cardTitle)
    fireEvent.change(cardTitle, { target: { value: 'Card novo' } })
    // O refetch trouxe o ponto marcado em outra aba: o passo deixa de ser o atual.
    h.store = makeStore({ cardsByTopic: { t1: [card(true)] } })
    rerender(<StudySection />)
    expect(screen.getByDisplayValue('Card novo')).toBeTruthy()
    fireEvent.blur(screen.getByDisplayValue('Card novo'))
    expect(h.store.updateCard).toHaveBeenCalledWith('c1', { title: 'Card novo' }, { title: 'Card' })
    // Sem o campo em edição, o passo concluído fecha.
    expect(screen.queryByDisplayValue('Card')).toBeNull()
  })

  it('tópico aberto excluído em outra aba: aviso no lugar do detalhe, e voltar', () => {
    const { rerender } = openTopic()
    h.store = makeStore({ topics: [], cardsByTopic: {}, goneTopicIds: new Set(['t1']) })
    rerender(<StudySection />)
    expect(screen.getByRole('status').textContent).toContain('study_topic_deleted_elsewhere')
    fireEvent.click(button('study_back'))
    expect(screen.queryByText('study_topic_deleted_elsewhere')).toBeNull()
  })

  it('anexar .md recusado mostra a mensagem do hook (o card N)', async () => {
    openTopic()
    fireEvent.click(button('study_import_append'))
    fireEvent.change(screen.getByPlaceholderText('study_import_paste_placeholder'), {
      target: { value: '# Estudo: X\n## Card 1: X\n**Pontos de estudo:**\n- [ ] ponto' },
    })
    await act(async () => { fireEvent.click(button('study_append_confirm')) })
    expect(h.store.appendCards).toHaveBeenCalledWith('t1', [expect.objectContaining({ title: 'X' })])
    expect(screen.getByText('O card 1 ("X") não pôde ser importado')).toBeTruthy()
  })

  it('importar um tópico novo recusado mostra a mensagem do hook', async () => {
    h.store = makeStore()
    render(<StudySection />)
    fireEvent.click(screen.getAllByText('study_nav_new')[0])
    fireEvent.change(screen.getByPlaceholderText('study_form_title_placeholder'), { target: { value: 'Novo' } })
    fireEvent.click(button('study_new_generate'))
    fireEvent.change(screen.getByPlaceholderText('study_import_paste_placeholder'), {
      target: { value: '# Estudo: X\n## Card 1: X\n**Pontos de estudo:**\n- [ ] ponto' },
    })
    await act(async () => { fireEvent.click(button('study_import_confirm')) })
    expect(h.store.createTopicFromImport).toHaveBeenCalled()
    expect(screen.getByText('MSG')).toBeTruthy()
  })
})

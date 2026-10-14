// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '../../test/rtl'
import type { StudySave, StudyCardFieldPatch, StudyTopicFieldPatch } from '../../lib/data/study'
import type { StudyCard, StudyTopic } from '../../types'

// Revisão do lote 06 (#6): o rascunho controlado (useFieldDraft) com o hook
// de verdade (useStudyTopics + useStudySync); só a camada de dados é falsa. A
// gravação que falha na rede tirava o espelho, e o campo voltava ao valor
// velho: o texto digitado sumia, sem "Copiar meu texto" (que é só do
// conflito). Antes do API-029 o campo não era controlado e o texto ficava.
// Agora o texto fica no campo, sem foco, e a próxima saída dele grava, com a
// base de quando a edição começou.

const h = vi.hoisted(() => ({
  network: true,
  toasts: [] as unknown[][],
  topic: null as unknown as StudyTopic,
  card: null as unknown as StudyCard,
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useModuleTour', () => ({ useModuleTour: () => {} }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'pt-BR' }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: (...args: unknown[]) => { h.toasts.push(args) } }) }))

const saveTopicFields = vi.fn<(id: string, patch: StudyTopicFieldPatch, version: string) => Promise<StudySave<StudyTopic>>>((_id, patch) =>
  Promise.resolve(h.network
    ? { status: 'error', error: { message: 'Failed to fetch' } }
    : { status: 'saved', row: { ...h.topic, ...patch, updated_at: 'v2' } }))
const saveCardFields = vi.fn<(id: string, patch: StudyCardFieldPatch, version: string) => Promise<StudySave<StudyCard>>>((_id, patch) =>
  Promise.resolve(h.network
    ? { status: 'error', error: { message: 'Failed to fetch' } }
    : { status: 'saved', row: { ...h.card, ...patch, updated_at: 'v2' } }))

vi.mock('../../lib/data/study', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/data/study')>(),
  listStudy: () => Promise.resolve({ topics: [h.topic], cards: [h.card], logs: [], error: null }),
  saveTopicFields: (id: string, patch: StudyTopicFieldPatch, version: string) => saveTopicFields(id, patch, version),
  saveCardFields: (id: string, patch: StudyCardFieldPatch, version: string) => saveCardFields(id, patch, version),
}))

const StudySection = (await import('./StudySection')).default

const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })

beforeEach(() => {
  h.network = true
  h.toasts = []
  h.topic = {
    id: 't1', user_id: 'u1', title: 'Rust', area: 'Prog', level: '', objective: 'Aprender o básico', status: 'studying',
    target_date: null, started_at: null, completed_at: null, created_at: '2026-10-01T00:00:00+00:00', updated_at: 'v1',
  }
  h.card = {
    id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card 1', description: '', rationale: '',
    checkpoints: [{ id: 'p1', text: 'Ler', completed: false }], resources: [], quiz: [],
    sort_order: 0, due_date: null, created_at: '2026-10-01T00:00:00+00:00', updated_at: 'v1',
  }
  saveTopicFields.mockClear()
  saveCardFields.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function openTopic() {
  render(<StudySection />)
  await flush()
  fireEvent.click(screen.getAllByText('Rust')[0])
}

describe('rascunho controlado x gravação que falha na rede', () => {
  it('objetivo do tópico: o texto fica no campo, e a próxima saída grava com a base do início', async () => {
    await openTopic()
    const objective = screen.getByPlaceholderText<HTMLTextAreaElement>('study_objective_placeholder')
    const typed = 'Aprender o básico.\n\nMeta: ler o livro inteiro e escrever um CLI.'
    fireEvent.focus(objective)
    fireEvent.change(objective, { target: { value: typed } })
    fireEvent.blur(objective)
    await flush()
    expect(h.toasts).toContainEqual(['error', 'toast_error_network', { dedupeKey: 'study:topic-save' }])
    expect(objective.value).toBe(typed)
    // A rede voltou: entrar e sair do campo grava, com a base de antes da falha.
    h.network = false
    fireEvent.focus(objective)
    fireEvent.blur(objective)
    await flush()
    expect(saveTopicFields).toHaveBeenCalledTimes(2)
    expect(saveTopicFields).toHaveBeenLastCalledWith('t1', { objective: typed.trim() }, 'v1')
    expect(objective.value).toBe(typed.trim())
  })

  // 2ª revisão do lote 06 (#1): entrar e sair do campo sem mudar nada, com a
  // gravação em voo, contava como envio e o texto não voltava na falha.
  it('objetivo do tópico: entrar e sair sem mudar com a gravação em voo não impede o texto de voltar', async () => {
    let fail: () => void = () => {}
    saveTopicFields.mockImplementationOnce(() => new Promise(resolve => {
      fail = () => resolve({ status: 'error', error: { message: 'Failed to fetch' } })
    }))
    await openTopic()
    const objective = screen.getByPlaceholderText<HTMLTextAreaElement>('study_objective_placeholder')
    const typed = 'Aprender o básico.\n\nMeta: ler o livro inteiro e escrever um CLI.'
    fireEvent.focus(objective)
    fireEvent.change(objective, { target: { value: typed } })
    fireEvent.blur(objective)
    await flush()
    // A tela mostra o próprio texto (otimista); entrar e sair não grava nada.
    fireEvent.focus(objective)
    fireEvent.blur(objective)
    await flush()
    expect(saveTopicFields).toHaveBeenCalledTimes(1)
    await act(async () => { fail() })
    await flush()
    expect(h.toasts).toContainEqual(['error', 'toast_error_network', { dedupeKey: 'study:topic-save' }])
    expect(objective.value).toBe(typed)
  })

  it('título do card: o texto fica no campo, e a próxima saída grava', async () => {
    await openTopic()
    const title = screen.getByPlaceholderText<HTMLInputElement>('study_card_title_placeholder')
    fireEvent.focus(title)
    fireEvent.change(title, { target: { value: 'Ownership e borrowing' } })
    fireEvent.blur(title)
    await flush()
    expect(h.toasts).toContainEqual(['error', 'toast_error_network', { dedupeKey: 'study:card-save' }])
    expect(title.value).toBe('Ownership e borrowing')
    h.network = false
    fireEvent.focus(title)
    fireEvent.blur(title)
    await flush()
    expect(saveCardFields).toHaveBeenCalledTimes(2)
    expect(saveCardFields).toHaveBeenLastCalledWith('c1', { title: 'Ownership e borrowing' }, 'v1')
    expect(title.value).toBe('Ownership e borrowing')
  })
})

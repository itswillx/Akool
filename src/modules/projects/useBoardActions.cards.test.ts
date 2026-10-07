// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '../../test/rtl'
import type { ProjectCard } from '../../types'
import type { useBoardData } from './useBoardData'

// API-013: a edição do card mora no editor do modal (card/useCardEditor); o
// hook do quadro dá a ele a E/S (inserir, gravar com versão, imagens) e cuida
// do que muda o quadro (lista, modal, rascunho ao fechar, excluir, datas).

type Res = { data: unknown; error: unknown }
const api = vi.hoisted(() => {
  const reschedule: Res = { data: [{ id: 'c1', updated_at: 'v9' }], error: null }
  const insertResult: Res = { data: null, error: null }
  const deleteResult: Res = { data: [{ id: 'c1' }], error: null }
  return {
    insertResult,
    deleteResult,
    reschedule,
    calls: [] as string[],
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/data/projects', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/data/projects')>(),
  insertCard: () => Promise.resolve(api.insertResult),
  deleteCard: () => { api.calls.push('delete'); return Promise.resolve(api.deleteResult) },
  rescheduleCard: () => Promise.resolve(api.reschedule),
}))
vi.mock('../../contexts/PagesContext', () => ({ usePages: () => ({ pages: [], sharedPages: [], setActivePage: () => {} }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { useBoardActions } = await import('./useBoardActions')
const { draftKeyFor, loadCardDraft, saveCardDraft, cardFormFrom } = await import('./card/cardDraft')

const card = (extra: Partial<ProjectCard> = {}): ProjectCard => ({
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'Título', description: '', priority: 'medium',
  start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null, labels: [], linked_page_id: null,
  parent_card_id: null, depends_on: [], completed: false, checklist: [], attachments: [], links: [],
  sort_order: 0, created_at: '', updated_at: 'v1', ...extra,
})

type Modal = { open: boolean; card?: ProjectCard | null; columnId?: string }
type Confirm = { message: string; onConfirm: () => void | Promise<void> } | null
type State = { cards: ProjectCard[]; cardModal: Modal; persistError: string | null; confirm: Confirm }

function setup(initial: Modal, cards: ProjectCard[] = initial.card ? [initial.card] : []) {
  const state: State = { cards, cardModal: initial, persistError: null, confirm: null }
  const apply = <T,>(value: T | ((prev: T) => T), prev: T) => (typeof value === 'function' ? (value as (p: T) => T)(prev) : value)
  const loadBoards = vi.fn(() => Promise.resolve())
  const loadBoardData = vi.fn(() => Promise.resolve())
  const board = () => ({
    activeBoard: { id: 'b1' }, activeBoardId: 'b1', activeBoardIdRef: { current: 'b1' }, boardModal: { open: false }, canEdit: true,
    cardModal: state.cardModal, cards: state.cards, columnModal: { open: false },
    columns: [{ id: 'col1', sort_order: 0 }], isOwner: true, userId: 'u1',
    loadBoardData, loadBoards,
    setActiveBoardId: vi.fn(), setBoardModal: vi.fn(), setColumnModal: vi.fn(),
    setDeleteConfirm: (v: Confirm) => { state.confirm = v },
    setCards: (v: ProjectCard[] | ((p: ProjectCard[]) => ProjectCard[])) => { state.cards = apply(v, state.cards) },
    setCardModal: (v: Modal | ((p: Modal) => Modal)) => { state.cardModal = apply(v, state.cardModal) },
    setPersistError: (v: string | null) => { state.persistError = v },
  }) as unknown as ReturnType<typeof useBoardData>
  const hook = renderHook(() => useBoardActions({ board: board() }))
  // Fora do act: dentro dele o rerender só sai no fim, e o hook leria o estado velho.
  const actions = () => { hook.rerender(); return hook.result.current }
  return { state, actions, loadBoards, loadBoardData }
}

beforeEach(() => {
  api.insertResult = { data: null, error: null }
  api.deleteResult = { data: [{ id: 'c1' }], error: null }
  api.reschedule = { data: [{ id: 'c1', updated_at: 'v9' }], error: null }
  api.calls = []
  sessionStorage.clear()
})

describe('E/S do editor (cardIO)', () => {
  it('insert devolve o card normalizado; erro vira { error }', async () => {
    const { actions } = setup({ open: true, card: null, columnId: 'col1' })
    const io = actions().cardIO!
    api.insertResult = { data: { ...card({ id: 'novo' }), labels: null }, error: null }
    expect(await io.insert({ board_id: 'b1', column_id: 'col1', title: 'x' })).toMatchObject({ card: { id: 'novo', labels: [] } })
    api.insertResult = { data: null, error: { message: 'Sem permissão para editar este quadro', code: '42501' } }
    expect(await io.insert({ board_id: 'b1', column_id: 'col1', title: 'x' })).toEqual({ error: { message: 'Sem permissão para editar este quadro', code: '42501' } })
  })

  it('card criado entra na lista; com o modal ainda aberto no card novo, o modal passa a ser dele', () => {
    const { state, actions } = setup({ open: true, card: null, columnId: 'col1' })
    const io = actions().cardIO!
    act(() => io.onInserted(card({ id: 'novo' }), true))
    expect(state.cards.map(c => c.id)).toEqual(['novo'])
    expect(state.cardModal.card?.id).toBe('novo')
  })

  it('card criado depois de trocar de quadro não entra na lista do quadro novo', () => {
    const { state, actions } = setup({ open: false })
    const io = actions().cardIO!
    act(() => io.onInserted(card({ id: 'novo', board_id: 'outro' }), false))
    expect(state.cards).toEqual([])
  })

  it('card criado depois de fechar: entra na lista, e o modal não reabre', () => {
    const { state, actions } = setup({ open: false })
    const io = actions().cardIO!
    act(() => io.onInserted(card({ id: 'novo' }), false))
    expect(state.cards.map(c => c.id)).toEqual(['novo'])
    expect(state.cardModal.open).toBe(false)
  })

  it('versão gravada atualiza a lista; sem permissão relê os quadros', () => {
    const { state, actions, loadBoards } = setup({ open: true, card: card() })
    const io = actions().cardIO!
    act(() => io.onSaved('c1', { version: 'v2', fields: { ...card(), title: 'Novo' } }))
    expect(state.cards[0]).toMatchObject({ title: 'Novo', updated_at: 'v2' })
    io.onDenied()
    // Sem trocar o painel pelo "carregando": o modal aberto continua montado.
    expect(loadBoards).toHaveBeenCalledWith({ silent: true })
  })
})

describe('fechar e excluir', () => {
  it('fechar apaga o rascunho; com aviso pendente (keepDraft), o rascunho fica', () => {
    const draft = { form: cardFormFrom(null), savedAt: '', removedAttachmentIds: [] }
    saveCardDraft(draftKeyFor('b1', 'c1'), draft)
    const { state, actions } = setup({ open: true, card: card() })
    const keep = actions().closeCardModal
    act(() => keep({ keepDraft: true }))
    expect(loadCardDraft(draftKeyFor('b1', 'c1'))).not.toBeNull()
    expect(state.cardModal.open).toBe(false)

    state.cardModal = { open: true, card: card() }
    const close = actions().closeCardModal
    act(() => close())
    expect(loadCardDraft(draftKeyFor('b1', 'c1'))).toBeNull()
  })

  it('excluir para o editor antes do DELETE e o retoma se o DELETE falhar', async () => {
    const order: string[] = []
    const editor = { stop: vi.fn(async () => { order.push('stop') }), resume: vi.fn(() => { order.push('resume') }) }
    const { state, actions } = setup({ open: true, card: card() })
    const { deleteCard } = actions()
    act(() => deleteCard(editor))
    api.deleteResult = { data: [], error: null } // RLS: 0 linhas
    await act(async () => { await state.confirm!.onConfirm() })
    expect(order).toEqual(['stop', 'resume'])
    expect(api.calls).toEqual(['delete'])
    expect(state.cardModal.open).toBe(true)
  })
})

describe('datas na linha do tempo', () => {
  it('vão sem versão do cliente e guardam a versão do servidor', async () => {
    const { state, actions } = setup({ open: false }, [card()])
    const { handleRescheduleCard } = actions()
    await act(() => handleRescheduleCard('c1', { start_date: '2026-10-01', due_date: '2026-10-02' }))
    expect(state.cards[0]).toMatchObject({ start_date: '2026-10-01', due_date: '2026-10-02', updated_at: 'v9' })
  })

  it('zero linhas (sem permissão) é erro, não sucesso calado', async () => {
    const { state, actions } = setup({ open: false }, [card()])
    api.reschedule = { data: [], error: null }
    const { handleRescheduleCard } = actions()
    await act(() => handleRescheduleCard('c1', { start_date: null, due_date: null }))
    expect(state.persistError).toBe('projects_persist_error')
  })
})

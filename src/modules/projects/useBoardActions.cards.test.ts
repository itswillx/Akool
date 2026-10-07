// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '../../test/rtl'
import type { CardPatch, CardSave } from '../../lib/data/projects'
import type { ProjectCard } from '../../types'
import type { CardConflict, CardForm } from './card/cardDraft'
import type { useBoardData } from './useBoardData'

// API-013: o card aberto grava só o que mudou, sobre a versão de onde a edição
// partiu. Se outra pessoa gravou outros campos no meio, a gravação é refeita
// por cima da versão dela; se gravou os mesmos, nada é gravado até a pessoa
// escolher no aviso.

type Res = { data: unknown; error: unknown }
const api = vi.hoisted(() => {
  const reschedule: Res = { data: [{ id: 'c1', updated_at: 'v9' }], error: null }
  return {
    saves: [] as [string, CardPatch, string][],
    saveResults: [] as CardSave[],
    inserts: [] as Record<string, unknown>[],
    insertResult: null as Res | null,
    reschedule,
    toasts: [] as [string, string][],
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/data/projects', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/data/projects')>(),
  saveCardVersioned: (id: string, patch: CardPatch, expected: string) => {
    api.saves.push([id, patch, expected])
    return Promise.resolve(api.saveResults.shift() ?? { status: 'saved', at: `${expected}+` })
  },
  insertCard: (values: Record<string, unknown>) => {
    api.inserts.push(values)
    return Promise.resolve(api.insertResult)
  },
  rescheduleCard: () => Promise.resolve(api.reschedule),
}))
vi.mock('../../contexts/PagesContext', () => ({ usePages: () => ({ pages: [], sharedPages: [], setActivePage: () => {} }) }))
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: (kind: string, message: string) => { api.toasts.push([kind, message]) } }),
}))
vi.mock('../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'projects_card_rule_error' ? 'recusado: {message}' : k) }),
}))

const { useBoardActions } = await import('./useBoardActions')
const { cardFormFrom } = await import('./card/cardDraft')

const card = (extra: Partial<ProjectCard> = {}): ProjectCard => ({
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'Título', description: '', priority: 'medium',
  start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null, labels: [], linked_page_id: null,
  parent_card_id: null, depends_on: [], completed: false, checklist: [], attachments: [], links: [],
  sort_order: 0, created_at: '', updated_at: 'v1', ...extra,
})

type Modal = { open: boolean; card?: ProjectCard | null; columnId?: string }
type State = { cards: ProjectCard[]; cardModal: Modal; conflict: CardConflict | null; status: string; persistError: string | null }

function setup(initial: Modal, cards: ProjectCard[] = initial.card ? [initial.card] : []) {
  const state: State = { cards, cardModal: initial, conflict: null, status: 'idle', persistError: null }
  const apply = <T,>(value: T | ((prev: T) => T), prev: T) => (typeof value === 'function' ? (value as (p: T) => T)(prev) : value)
  const board = () => ({
    activeBoard: { id: 'b1' }, activeBoardId: 'b1', boardModal: { open: false }, canEdit: true,
    cardModal: state.cardModal, cardSaveStatusTimerRef: { current: null }, cards: state.cards,
    columnModal: { open: false }, columns: [{ id: 'col1', sort_order: 0 }], isOwner: true, userId: 'u1',
    loadBoardData: vi.fn(() => Promise.resolve()), loadBoards: vi.fn(),
    setActiveBoardId: vi.fn(), setBoardModal: vi.fn(), setColumnModal: vi.fn(), setDeleteConfirm: vi.fn(),
    setCards: (v: ProjectCard[] | ((p: ProjectCard[]) => ProjectCard[])) => { state.cards = apply(v, state.cards) },
    setCardModal: (v: Modal | ((p: Modal) => Modal)) => { state.cardModal = apply(v, state.cardModal) },
    setCardConflict: (v: CardConflict | null) => { state.conflict = v },
    setCardSaveStatus: (v: string) => { state.status = v },
    setCardSaveErrorKind: vi.fn(),
    setPersistError: (v: string | null) => { state.persistError = v },
  }) as unknown as ReturnType<typeof useBoardData>
  const hook = renderHook(() => useBoardActions({ board: board() }))
  // Fora do act: dentro dele o rerender só sai no fim, e o hook leria o estado velho.
  const actions = () => { hook.rerender(); return hook.result.current }
  const save = (form: CardForm) => { const a = actions(); return act(() => a.autoSaveCard(form, NO_EXTRAS)) }
  return { state, actions, save }
}

const NO_EXTRAS = { pendingFiles: [], removedAttachmentIds: [] }
const formOf = (c: ProjectCard, patch: Partial<CardForm> = {}): CardForm => ({ ...cardFormFrom(c), ...patch })

beforeEach(() => {
  api.saves = []
  api.saveResults = []
  api.inserts = []
  api.insertResult = null
  api.toasts = []
  api.reschedule = { data: [{ id: 'c1', updated_at: 'v9' }], error: null }
  sessionStorage.clear()
})

describe('gravação versionada do card aberto', () => {
  it('manda só o que mudou, e a próxima parte da versão que o servidor devolveu', async () => {
    const open = card()
    const { state, save } = setup({ open: true, card: open })
    api.saveResults = [{ status: 'saved', at: 'v2' }, { status: 'saved', at: 'v3' }]

    await save(formOf(open, { title: 'Novo título' }))
    await save(formOf(open, { title: 'Novo título', priority: 'high' }))

    expect(api.saves).toEqual([['c1', { title: 'Novo título' }, 'v1'], ['c1', { priority: 'high' }, 'v2']])
    expect(state.cards[0]).toMatchObject({ title: 'Novo título', priority: 'high', updated_at: 'v3' })
    expect(state.status).toBe('saved')
  })

  it('sem mudança, não grava', async () => {
    const open = card()
    const { save } = setup({ open: true, card: open })
    await save(formOf(open))
    expect(api.saves).toEqual([])
  })

  it('outra pessoa mudou outro campo: refaz por cima da versão dela e traz o que ela mudou', async () => {
    const open = card()
    const { state, save } = setup({ open: true, card: open })
    api.saveResults = [{ status: 'conflict', current: card({ description: 'escrita por outra pessoa', updated_at: 'v3' }) }, { status: 'saved', at: 'v4' }]

    const result = await save(formOf(open, { title: 'Meu título' }))

    expect(api.saves.map(([, patch, version]) => [patch, version])).toEqual([[{ title: 'Meu título' }, 'v1'], [{ title: 'Meu título' }, 'v3']])
    expect(result?.merged).toEqual({ description: 'escrita por outra pessoa' })
    expect(state.conflict).toBeNull()
    expect(state.cards[0]).toMatchObject({ title: 'Meu título', description: 'escrita por outra pessoa', updated_at: 'v4' })
  })

  it('outra pessoa mudou o mesmo campo: para, avisa e só grava depois da escolha (manter a minha)', async () => {
    const open = card()
    const { state, actions, save } = setup({ open: true, card: open })
    const theirs = card({ title: 'Título dela', description: 'nota dela', updated_at: 'v3' })
    api.saveResults = [{ status: 'conflict', current: theirs }]
    const mine = formOf(open, { title: 'Meu título' })

    await save(mine)
    expect(state.conflict).toMatchObject({ cardId: 'c1', fields: ['title'] })

    // Enquanto o aviso está na tela, nada é gravado.
    await save(formOf(open, { title: 'Meu título 2' }))
    expect(api.saves).toHaveLength(1)

    const next = actions().resolveCardConflict('mine', mine)
    expect(next).toMatchObject({ title: 'Meu título', description: 'nota dela' })
    expect(state.conflict).toBeNull()
    await save(next!)
    expect(api.saves[1]).toEqual(['c1', { title: 'Meu título' }, 'v3'])
  })

  it('carregar a versão salva: o formulário vira o do servidor e não há o que gravar', async () => {
    const open = card()
    const { state, actions, save } = setup({ open: true, card: open })
    const theirs = card({ title: 'Título dela', updated_at: 'v3' })
    api.saveResults = [{ status: 'conflict', current: theirs }]

    await save(formOf(open, { title: 'Meu título' }))
    const next = actions().resolveCardConflict('theirs', formOf(open, { title: 'Meu título' }))
    expect(next).toEqual(cardFormFrom(theirs))
    expect(state.cards[0]).toMatchObject({ title: 'Título dela', updated_at: 'v3' })
    await save(next!)
    expect(api.saves).toHaveLength(1)
  })

  it('card apagado por outra pessoa: aviso e status de erro', async () => {
    const open = card()
    const { state, save } = setup({ open: true, card: open })
    api.saveResults = [{ status: 'gone' }]
    expect(await save(formOf(open, { title: 'x' }))).toBeNull()
    expect(api.toasts).toEqual([['error', 'projects_card_gone']])
    expect(state.status).toBe('error')
  })

  it('recusa de regra do servidor mostra o motivo; outro erro, o aviso genérico', async () => {
    const open = card()
    const { save } = setup({ open: true, card: open })
    api.saveResults = [
      { status: 'error', error: { message: 'Essa dependência criaria um ciclo', code: '23514', hint: 'akool' } },
      { status: 'error', error: { message: 'Failed to fetch' } },
    ]
    await save(formOf(open, { depends_on: ['c2'] }))
    await save(formOf(open, { depends_on: ['c2'] }))
    expect(api.toasts).toEqual([['error', 'recusado: Essa dependência criaria um ciclo'], ['error', 'projects_autosave_error']])
  })

  it('card novo: nasce sem posição nem versão do cliente, uma vez só, e a gravação seguinte vai sobre a versão do servidor', async () => {
    const { state, actions } = setup({ open: true, card: null, columnId: 'col1' })
    api.insertResult = { data: { ...card({ id: 'novo', title: 'Novo', updated_at: 'v1', sort_order: 7 }), labels: null }, error: null }
    const empty = cardFormFrom(null)

    // Duas gravações seguidas, antes de o modal saber do card criado.
    const first = actions().autoSaveCard({ ...empty, title: 'Novo' }, NO_EXTRAS)
    const second = actions().autoSaveCard({ ...empty, title: 'Novo', priority: 'urgent' }, NO_EXTRAS)
    await act(async () => { await first; await second })

    expect(api.inserts).toHaveLength(1)
    expect(api.inserts[0]).toMatchObject({ board_id: 'b1', column_id: 'col1', title: 'Novo' })
    expect(api.inserts[0]).not.toHaveProperty('sort_order')
    expect(api.inserts[0]).not.toHaveProperty('updated_at')
    expect(api.saves).toEqual([['novo', { priority: 'urgent' }, 'v1']])
    expect(state.cards.map(c => [c.id, c.sort_order, c.labels])).toEqual([['novo', 7, []]])
    expect(state.cardModal.card?.id).toBe('novo')
  })

  it('fechar o modal encerra a sessão: a próxima abertura parte do card como está', async () => {
    const open = card()
    const { state, actions, save } = setup({ open: true, card: open })
    api.saveResults = [{ status: 'saved', at: 'v2' }]
    await save(formOf(open, { title: 'A' }))
    const { closeCardModal } = actions()
    act(() => closeCardModal())
    expect(state.cardModal.open).toBe(false)

    const reloaded = card({ title: 'A', description: 'outra pessoa', updated_at: 'v5' })
    state.cards = [reloaded]
    state.cardModal = { open: true, card: reloaded }
    await save(formOf(reloaded, { title: 'B' }))
    expect(api.saves[1]).toEqual(['c1', { title: 'B' }, 'v5'])
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

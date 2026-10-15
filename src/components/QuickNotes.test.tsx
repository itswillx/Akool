// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '../test/rtl'
import type { Page, QuickNote, QuickNoteLinkedItem } from '../types'
import type { QuickNoteChange, QuickNoteConflict } from '../hooks/useQuickNotes'
import { LOCAL_KEYS } from '../lib/localKeys'

// REL-004/API-003: o mural de notas rápidas. O hook (dados e gravação) é
// simulado; aqui vale a tela: compor com cor, autosave com espera de 600 ms,
// excluir com confirmação (que descarta a edição pendente), cor, vínculos e o
// aviso de conflito.

const hook = vi.hoisted(() => {
  const conflicts: Record<string, QuickNoteConflict> = {}
  return { notes: [] as QuickNote[], conflicts, createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn(), resolveConflict: vi.fn() }
})
const nav = vi.hoisted(() => ({
  pages: [] as Page[],
  sharedPages: [] as Page[],
  setActivePage: vi.fn(),
  setActivePanel: vi.fn(),
  setDocsSelection: vi.fn(),
}))

vi.mock('../hooks/useQuickNotes', () => ({ useQuickNotes: () => hook }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../contexts/PagesContext', () => ({ usePages: () => nav }))
vi.mock('../lib/docsNavigation', () => ({ setDocsSelection: nav.setDocsSelection }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
// O seletor de itens tem a própria busca; aqui ele só devolve um item escolhido.
vi.mock('./ItemPicker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (item: unknown) => void; onClose: () => void }) => (
    <div>
      <button type="button" onClick={() => onSelect({ type: 'page', targetId: 'p9', title: 'Página nova' })}>escolher</button>
      <button type="button" onClick={onClose}>fechar seletor</button>
    </div>
  ),
}))

import QuickNotes from './QuickNotes'

const note = (id: string, content: string, extra: Partial<QuickNote> = {}): QuickNote =>
  ({ id, user_id: 'u1', content, color: 'yellow', linked_items: [], created_at: '', updated_at: '', ...extra })
const link = (id: string, extra: Partial<QuickNoteLinkedItem>): QuickNoteLinkedItem => ({ id, type: 'page', targetId: 't', title: id, ...extra })

beforeEach(() => {
  vi.useRealTimers()
  hook.notes = []
  hook.conflicts = {}
  hook.createNote.mockReset().mockResolvedValue(true)
  hook.updateNote.mockReset().mockResolvedValue(undefined)
  hook.deleteNote.mockReset()
  hook.resolveConflict.mockReset().mockResolvedValue(undefined)
  nav.pages = []
  nav.sharedPages = []
  nav.setActivePage.mockReset()
  nav.setActivePanel.mockReset()
  nav.setDocsSelection.mockReset()
  localStorage.clear()
})

const composer = () => screen.getByPlaceholderText<HTMLTextAreaElement>('quick_notes_placeholder')
/** O cartão da nota (a caixa com a borda colorida), pelo texto do campo. */
const card = (content: string) => screen.getByDisplayValue(content).parentElement as HTMLElement

describe('QuickNotes: compor', () => {
  it('sem notas mostra o vazio; o botão só liga com texto', () => {
    render(<QuickNotes />)
    expect(screen.getByText('quick_notes_empty')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'quick_notes_add' }).disabled).toBe(true)
    fireEvent.change(composer(), { target: { value: 'oi' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'quick_notes_add' }).disabled).toBe(false)
  })

  it('Ctrl+Enter cria com o texto aparado e a cor escolhida, e limpa o campo', async () => {
    render(<QuickNotes />)
    fireEvent.click(screen.getByTitle('quick_notes_color_pink'))
    fireEvent.change(composer(), { target: { value: '  ligar para o banco  ' } })
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(hook.createNote).toHaveBeenCalledWith({ content: 'ligar para o banco', color: 'pink' }))
    expect(composer().value).toBe('')
  })

  it('Enter sozinho não cria (quebra a linha); só espaços não criam', async () => {
    render(<QuickNotes />)
    fireEvent.change(composer(), { target: { value: 'texto' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })
    fireEvent.change(composer(), { target: { value: '   ' } })
    fireEvent.keyDown(composer(), { key: 'Enter', metaKey: true })
    await act(async () => {})
    expect(hook.createNote).not.toHaveBeenCalled()
  })

  it('falha ao criar devolve o texto ao campo', async () => {
    hook.createNote.mockResolvedValue(false)
    render(<QuickNotes />)
    fireEvent.change(composer(), { target: { value: 'não perde' } })
    fireEvent.click(screen.getByRole('button', { name: 'quick_notes_add' }))
    await waitFor(() => expect(composer().value).toBe('não perde'))
  })

  it('no celular, o compositor empilha e a grade usa colunas menores', () => {
    hook.notes = [note('n1', 'a')]
    const { container } = render(<QuickNotes isMobile />)
    expect((composer().parentElement as HTMLElement).style.flexDirection).toBe('column')
    expect((container.querySelector('div[style*="grid-template-columns"]') as HTMLElement).style.gridTemplateColumns).toContain('150px')
  })
})

describe('QuickNotes: editar e excluir', () => {
  it('autosave 600 ms depois da última tecla, só com o conteúdo', () => {
    vi.useFakeTimers()
    hook.notes = [note('n1', 'rascunho')]
    render(<QuickNotes />)
    const field = screen.getByDisplayValue('rascunho')
    fireEvent.change(field, { target: { value: 'rascunho 2' } })
    act(() => { vi.advanceTimersByTime(400) })
    fireEvent.change(field, { target: { value: 'rascunho 3' } })
    act(() => { vi.advanceTimersByTime(599) })
    expect(hook.updateNote).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(hook.updateNote).toHaveBeenCalledTimes(1)
    expect(hook.updateNote).toHaveBeenCalledWith('n1', { content: 'rascunho 3' })
  })

  it('sair do campo grava na hora; sem mudança não grava', () => {
    hook.notes = [note('n1', 'a'), note('n2', 'b')]
    render(<QuickNotes />)
    const a = screen.getByDisplayValue('a')
    fireEvent.focus(a)
    fireEvent.change(a, { target: { value: 'a!' } })
    fireEvent.blur(a)
    expect(hook.updateNote).toHaveBeenCalledWith('n1', { content: 'a!' })
    const b = screen.getByDisplayValue('b')
    fireEvent.focus(b)
    fireEvent.blur(b)
    expect(hook.updateNote).toHaveBeenCalledTimes(1)
  })

  it('desmontar grava a edição pendente', () => {
    hook.notes = [note('n1', 'a')]
    const view = render(<QuickNotes />)
    fireEvent.change(screen.getByDisplayValue('a'), { target: { value: 'a pendente' } })
    view.unmount()
    expect(hook.updateNote).toHaveBeenCalledWith('n1', { content: 'a pendente' })
  })

  it('fora de foco, o campo acompanha a nota; em foco, vale o que está sendo digitado', () => {
    hook.notes = [note('n1', 'versão 1')]
    const view = render(<QuickNotes />)
    hook.notes = [note('n1', 'versão do servidor')]
    view.rerender(<QuickNotes />)
    const field = screen.getByDisplayValue('versão do servidor')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'minha versão' } })
    hook.notes = [note('n1', 'outra do servidor')]
    view.rerender(<QuickNotes />)
    expect(screen.getByDisplayValue('minha versão')).toBeTruthy()
  })

  it('excluir pede confirmação; confirmar apaga e descarta o autosave pendente', () => {
    vi.useFakeTimers()
    hook.notes = [note('n1', 'apagar')]
    render(<QuickNotes />)
    fireEvent.change(screen.getByDisplayValue('apagar'), { target: { value: 'apagar já' } })
    fireEvent.click(within(card('apagar já')).getByTitle('quick_notes_delete'))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('quick_notes_delete_message')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'confirm_delete_confirm' }))
    expect(hook.deleteNote).toHaveBeenCalledWith('n1')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(hook.updateNote).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cancelar a exclusão mantém a nota e a edição pendente', () => {
    vi.useFakeTimers()
    hook.notes = [note('n1', 'fica')]
    render(<QuickNotes />)
    fireEvent.change(screen.getByDisplayValue('fica'), { target: { value: 'fica mesmo' } })
    fireEvent.click(within(card('fica mesmo')).getByTitle('quick_notes_delete'))
    fireEvent.click(screen.getByRole('button', { name: 'confirm_delete_cancel' }))
    expect(hook.deleteNote).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(600) })
    expect(hook.updateNote).toHaveBeenCalledWith('n1', { content: 'fica mesmo' })
  })

  it('trocar a cor grava só a cor; a cor atual não aparece entre as opções', () => {
    hook.notes = [note('n1', 'colorida', { color: 'green' })]
    render(<QuickNotes />)
    const box = card('colorida')
    fireEvent.mouseEnter(box)
    expect(within(box).queryByTitle('quick_notes_color_green')).toBeNull()
    fireEvent.click(within(box).getByTitle('quick_notes_color_blue'))
    expect(hook.updateNote).toHaveBeenCalledWith('n1', { color: 'blue' })
    fireEvent.mouseLeave(box)
  })

  it('conflito: aviso no cartão com carregar a salva ou manter a minha', () => {
    hook.notes = [note('n1', 'disputada')]
    hook.conflicts = { n1: { mine: { content: 'x' }, theirs: note('n1', 'y') } }
    render(<QuickNotes />)
    const banner = within(card('disputada')).getByRole('alert')
    expect(within(banner).getByText('quick_notes_conflict')).toBeTruthy()
    fireEvent.click(within(banner).getByRole('button', { name: 'editor_conflict_load' }))
    fireEvent.click(within(banner).getByRole('button', { name: 'editor_conflict_keep' }))
    expect(hook.resolveConflict.mock.calls).toEqual([['n1', 'load'], ['n1', 'keep']])
  })
})

describe('QuickNotes: vínculos', () => {
  const current = (items: QuickNoteLinkedItem[]) => note('n1', 'x', { linked_items: items })
  const lastChange = () => hook.updateNote.mock.calls.at(-1)![1] as QuickNoteChange

  it('vincular soma o item à lista mais recente da nota e fecha o seletor', () => {
    hook.notes = [note('n1', 'com link')]
    render(<QuickNotes />)
    fireEvent.click(within(card('com link')).getByTitle('quick_notes_add_link'))
    fireEvent.click(screen.getByRole('button', { name: 'escolher' }))
    expect(screen.queryByRole('button', { name: 'escolher' })).toBeNull()
    const change = lastChange()
    expect(typeof change).toBe('function')
    const old = link('l0', {})
    const next = (change as (n: QuickNote) => { linked_items: QuickNoteLinkedItem[] })(current([old])).linked_items
    expect(next).toHaveLength(2)
    expect(next[0]).toBe(old)
    expect(next[1]).toMatchObject({ type: 'page', targetId: 'p9', title: 'Página nova' })
    expect(next[1].id).toEqual(expect.any(String))
  })

  it('o seletor fecha sem vincular', () => {
    hook.notes = [note('n1', 'sem link')]
    render(<QuickNotes />)
    fireEvent.click(within(card('sem link')).getByTitle('quick_notes_add_link'))
    fireEvent.click(screen.getByRole('button', { name: 'fechar seletor' }))
    expect(screen.queryByRole('button', { name: 'escolher' })).toBeNull()
    expect(hook.updateNote).not.toHaveBeenCalled()
  })

  it('remover tira só aquele item da lista mais recente, sem abrir o vínculo', () => {
    const a = link('la', { title: 'A' })
    const b = link('lb', { title: 'B' })
    hook.notes = [note('n1', 'dois links', { linked_items: [a, b] })]
    render(<QuickNotes />)
    fireEvent.click(within(screen.getByText('A').parentElement as HTMLElement).getByRole('button', { name: 'common_remove' }))
    expect(nav.setActivePage).not.toHaveBeenCalled()
    const change = lastChange() as (n: QuickNote) => { linked_items: QuickNoteLinkedItem[] }
    const extra = link('lc', { title: 'C' }) // entrou em outra aba
    expect(change(current([a, b, extra])).linked_items).toEqual([b, extra])
  })

  it('abrir vínculo de página procura também nas subpáginas e nas compartilhadas', () => {
    const child = { id: 'p-filha', title: 'Filha', children: [] } as unknown as Page
    nav.pages = [{ id: 'p-mae', title: 'Mãe', children: [child] } as unknown as Page]
    nav.sharedPages = [{ id: 'p-comp', title: 'Comp', children: [] } as unknown as Page]
    hook.notes = [note('n1', 'links', { linked_items: [link('l1', { targetId: 'p-filha', title: 'Filha' }), link('l2', { targetId: 'p-comp', title: 'Comp' }), link('l3', { targetId: 'sumiu', title: 'Sumiu' })] })]
    render(<QuickNotes />)
    fireEvent.click(screen.getByText('Filha'))
    expect(nav.setActivePage).toHaveBeenLastCalledWith(child)
    fireEvent.keyDown(screen.getByText('Comp').parentElement as HTMLElement, { key: 'Enter' })
    expect(nav.setActivePage).toHaveBeenLastCalledWith(nav.sharedPages[0])
    fireEvent.click(screen.getByText('Sumiu'))
    expect(nav.setActivePage).toHaveBeenCalledTimes(2) // página que não existe mais: nada
  })

  it('abrir vínculo de card grava quadro e card antes de trocar para Projetos', () => {
    hook.notes = [note('n1', 'card', { linked_items: [link('l1', { type: 'card', targetId: 'c7', boardId: 'b3', title: 'Card 7' }), link('l2', { type: 'card', targetId: 'c8', title: 'Sem quadro' })] })]
    render(<QuickNotes />)
    fireEvent.click(screen.getByText('Card 7'))
    expect(localStorage.getItem(LOCAL_KEYS.projectsActiveBoard)).toBe('b3')
    expect(localStorage.getItem(LOCAL_KEYS.projectsOpenCard)).toBe('c7')
    expect(nav.setDocsSelection).toHaveBeenCalledWith({ kind: 'projects' })
    expect(nav.setActivePanel).toHaveBeenCalledWith('documents')
    fireEvent.click(screen.getByText('Sem quadro'))
    expect(nav.setActivePanel).toHaveBeenCalledTimes(1)
  })
})

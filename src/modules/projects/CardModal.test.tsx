// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor, within } from '../../test/rtl'
import type { CardPatch, CardSave } from '../../lib/data/projects'
import type { ProjectCard } from '../../types'
import type { CardIO } from './card/useCardEditor'

// QA-003: o modal de card do quadro — criar exige título, etiquetas não
// repetem, leitura sem edição não salva, e editar parte do card salvo.
// API-013: a gravação vai pelo editor (versão e aviso de conflito).

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'projects_conflict_fields' ? 'campos: {fields}' : k) }),
}))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

import { CardModal } from './card/CardModal'

const existing: ProjectCard = {
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'Card salvo', description: '', priority: 'high',
  start_date: null, due_date: null, estimated_days: 2, assignee_user_id: null, labels: ['bug'],
  linked_page_id: null, parent_card_id: null, depends_on: [], completed: false, checklist: [],
  attachments: [], links: [], sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: 'v1',
}

function fakeIO(steps: CardSave[] = []) {
  const saves: [CardPatch, string][] = []
  const io: CardIO = {
    userId: 'u1',
    insert: vi.fn(async values => ({ card: { ...existing, ...values, id: 'novo', updated_at: 'n1' } as ProjectCard })),
    save: vi.fn(async (_id: string, patch: CardPatch, version: string): Promise<CardSave> => {
      saves.push([patch, version])
      return steps.shift() ?? { status: 'saved', at: `${version}+` }
    }),
    upload: vi.fn(async () => null),
    removeUploads: vi.fn(async () => {}),
    onInserted: vi.fn(),
    onSaved: vi.fn(),
    onDenied: vi.fn(),
  }
  return { io, saves }
}

function setup(props: { card?: ProjectCard | null; canEdit?: boolean; allCards?: ProjectCard[]; steps?: CardSave[] } = {}) {
  const { io, saves } = fakeIO(props.steps)
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <CardModal
      card={props.card ?? null} boardId="b1" columnId="col1" columnName="A fazer" members={[]} allCards={props.allCards ?? []}
      canEdit={props.canEdit ?? true} io={io} onClose={onClose} onSaved={onSaved} onOpenPage={() => {}}
    />,
  )
  return { io, saves, onSaved, onClose, user: userEvent.setup() }
}

const title = () => screen.getByPlaceholderText<HTMLInputElement>('projects_card_title_placeholder')
const saveButton = () => screen.getByRole('button', { name: 'projects_save' })

beforeEach(() => sessionStorage.clear())

describe('CardModal', () => {
  it('card novo só salva com título, e salva o título digitado', async () => {
    const { io, onSaved, user } = setup()
    expect(saveButton()).toHaveProperty('disabled', true)
    await user.type(title(), '   ')
    expect(saveButton()).toHaveProperty('disabled', true)
    await user.type(title(), 'Revisar contrato')
    await user.click(saveButton())
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(io.insert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(io.insert).mock.calls[0][0]).toMatchObject({ title: 'Revisar contrato', priority: 'medium', labels: [], completed: false })
  })

  it('etiqueta entra com Enter, sem espaços e sem repetir (nem mudando só a caixa)', async () => {
    const { io, user } = setup()
    await user.type(title(), 'Com etiquetas')
    await user.click(screen.getByRole('button', { name: 'projects_section_organization' }))
    const labelInput = screen.getByPlaceholderText<HTMLInputElement>('projects_labels_placeholder')
    expect(labelInput.maxLength).toBe(50)
    await user.type(labelInput, '  Urgente  {Enter}')
    await user.type(labelInput, 'urgente{Enter}')
    await user.type(labelInput, 'cliente{Enter}')
    await user.click(saveButton())
    await waitFor(() => expect(io.insert).toHaveBeenCalled())
    // A primeira gravação pode ter saído só com o título; as etiquetas chegam em seguida.
    await waitFor(() => {
      const sent = [...vi.mocked(io.insert).mock.calls.map(c => c[0].labels), ...vi.mocked(io.save).mock.calls.map(c => c[1].labels)]
      expect(sent.filter(Boolean).at(-1)).toEqual(['Urgente', 'cliente'])
    })
  })

  // API-013: o servidor recusa dependência em ciclo.
  it('quem já depende deste card não aparece como dependência possível', async () => {
    const other = (id: string, depends_on: string[]) => ({ ...existing, id, title: `Card ${id}`, depends_on })
    const { user } = setup({ card: existing, allCards: [existing, other('c2', ['c1']), other('c3', ['c2']), other('c4', [])] })
    await user.click(screen.getByRole('button', { name: 'projects_section_organization' }))
    const select = screen.getByRole('option', { name: 'projects_dependencies_add' }).closest('select') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['projects_dependencies_add', 'Card c4'])
  })

  it('editar parte do card salvo grava só o campo mudado, sobre a versão do card', async () => {
    const { saves, onSaved, user } = setup({ card: existing })
    expect(title().value).toBe('Card salvo')
    await user.clear(title())
    await user.type(title(), 'Card renomeado')
    await user.click(saveButton())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(saves.at(-1)?.[0]).toEqual({ title: 'Card renomeado' })
  })

  it('sem permissão de edição: título travado e sem botão de salvar', () => {
    setup({ card: existing, canEdit: false })
    expect(title().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'projects_save' })).toBeNull()
  })

  it('a seção recolhida informa o estado para o leitor de tela', async () => {
    const { user } = setup()
    const section = screen.getByRole('button', { name: 'projects_section_organization' })
    expect(section.getAttribute('aria-expanded')).toBe('false')
    await user.click(section)
    expect(section.getAttribute('aria-expanded')).toBe('true')
  })
})

// API-013: outra pessoa gravou os mesmos campos.
describe('CardModal: aviso de conflito', () => {
  const theirs = { ...existing, title: 'Título dela', priority: 'urgent' as const, updated_at: 'v3' }

  it('o aviso diz os campos em disputa, recebe o foco e trava o Salvar', async () => {
    const { onSaved, user } = setup({ card: existing, steps: [{ status: 'conflict', current: theirs }] })
    await user.click(screen.getByRole('button', { name: 'projects_priority_low' })) // grava na hora
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('campos: projects_priority')
    expect(document.activeElement?.textContent).toBe('projects_conflict_title')
    await user.click(title())
    await user.click(saveButton())
    expect(onSaved).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('projects_conflict_title'))
  })

  it('"Manter a minha" grava sobre a versão dela e devolve o foco ao título', async () => {
    const { saves, user } = setup({ card: existing, steps: [{ status: 'conflict', current: theirs }] })
    await user.click(screen.getByRole('button', { name: 'projects_priority_low' }))
    const banner = await screen.findByRole('alert')
    await user.click(within(banner).getByRole('button', { name: 'projects_conflict_keep' }))
    await waitFor(() => expect(saves.at(-1)).toEqual([{ priority: 'low' }, 'v3']))
    expect(document.activeElement).toBe(title())
    // O que ela mudou nos outros campos fica.
    expect(title().value).toBe('Título dela')
  })

  it('"Carregar a versão salva" mostra o valor salvo no campo em disputa', async () => {
    const { user } = setup({ card: existing, steps: [{ status: 'conflict', current: theirs }] })
    await user.click(screen.getByRole('button', { name: 'projects_priority_low' }))
    await user.click(await screen.findByRole('button', { name: 'projects_conflict_load' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: 'projects_priority_urgent' }).style.fontWeight).toBe('700')
  })

  it('refazer por cima da outra pessoa: o campo que ela mudou entra no formulário', async () => {
    const { user } = setup({ card: existing, steps: [{ status: 'conflict', current: { ...existing, title: 'Título dela', updated_at: 'v2' } }] })
    await user.click(screen.getByRole('button', { name: 'projects_priority_low' }))
    await waitFor(() => expect(title().value).toBe('Título dela'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Segunda revisão: o editor de texto só lê o markdown ao montar.
  it('com o editor da descrição aberto, a descrição que veio de outra pessoa aparece nele', async () => {
    const { user } = setup({ card: existing, steps: [{ status: 'conflict', current: { ...existing, description: 'texto da outra pessoa', updated_at: 'v2' } }] })
    // O título grava pelo debounce enquanto a pessoa já abriu a descrição; o refazer traz a descrição dela.
    await user.type(title(), '!')
    await user.click(screen.getByRole('button', { name: 'a11y_edit_description' }))
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[contenteditable="true"]')?.textContent).toContain('texto da outra pessoa'), { timeout: 3000 })
  })
})


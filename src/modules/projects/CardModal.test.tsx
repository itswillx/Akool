// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor, within } from '../../test/rtl'
import type { ProjectCard } from '../../types'
import type { AutoSaveResult, CardConflict, CardForm } from './card/cardDraft'

// QA-003: o modal de card do quadro — criar exige título, etiquetas não
// repetem, leitura sem edição não salva, e editar parte do card salvo.

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

import { CardModal } from './card/CardModal'
import { cardFormFrom } from './card/cardDraft'

const existing: ProjectCard = {
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'Card salvo', description: '', priority: 'high',
  start_date: null, due_date: null, estimated_days: 2, assignee_user_id: null, labels: ['bug'],
  linked_page_id: null, parent_card_id: null, depends_on: [], completed: false, checklist: [],
  attachments: [], links: [], sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
}

function setup(props: {
  card?: ProjectCard | null; canEdit?: boolean; onDelete?: () => void; allCards?: ProjectCard[]
  conflict?: CardConflict | null
  onAutoSave?: (form: CardForm) => AutoSaveResult | null
  onResolveConflict?: (choice: 'theirs' | 'mine', form: CardForm) => CardForm | null
} = {}) {
  const onSave = vi.fn<(form: { title: string; labels: string[] }, extras: unknown) => void>()
  const onClose = vi.fn()
  const view = (conflict: CardConflict | null | undefined) => (
    <CardModal
      card={props.card ?? null} boardId="b1" columnId="col1" columnName="A fazer" members={[]} allCards={props.allCards ?? []}
      canEdit={props.canEdit ?? true} onClose={onClose} onSave={onSave} onDelete={props.onDelete} onOpenPage={() => {}}
      onAutoSave={props.onAutoSave} conflict={conflict} onResolveConflict={props.onResolveConflict}
    />
  )
  const { rerender } = render(view(props.conflict))
  return { onSave, onClose, user: userEvent.setup(), setConflict: (c: CardConflict | null) => rerender(view(c)) }
}

const title = () => screen.getByPlaceholderText<HTMLInputElement>('projects_card_title_placeholder')
const saveButton = () => screen.getByRole('button', { name: 'projects_save' })

describe('CardModal', () => {
  it('card novo só salva com título, e salva o título digitado', async () => {
    const { onSave, user } = setup()
    expect(saveButton()).toHaveProperty('disabled', true)
    await user.type(title(), '   ')
    expect(saveButton()).toHaveProperty('disabled', true)
    await user.type(title(), 'Revisar contrato')
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledTimes(1)
    const [form, extras] = onSave.mock.calls[0]
    expect(form).toMatchObject({ title: '   Revisar contrato', priority: 'medium', labels: [], completed: false })
    expect(extras).toEqual({ pendingFiles: [], removedAttachmentIds: [] })
  })

  it('etiqueta entra com Enter, sem espaços e sem repetir (nem mudando só a caixa)', async () => {
    const { onSave, user } = setup()
    await user.type(title(), 'Com etiquetas')
    await user.click(screen.getByRole('button', { name: 'projects_section_organization' }))
    const labelInput = screen.getByPlaceholderText<HTMLInputElement>('projects_labels_placeholder')
    expect(labelInput.maxLength).toBe(50)
    await user.type(labelInput, '  Urgente  {Enter}')
    await user.type(labelInput, 'urgente{Enter}')
    await user.type(labelInput, 'cliente{Enter}')
    await user.click(saveButton())
    expect(onSave.mock.calls[0][0].labels).toEqual(['Urgente', 'cliente'])
  })

  // API-013: o servidor recusa dependência em ciclo.
  it('quem já depende deste card não aparece como dependência possível', async () => {
    const other = (id: string, depends_on: string[]) => ({ ...existing, id, title: `Card ${id}`, depends_on })
    const { user } = setup({ card: existing, allCards: [existing, other('c2', ['c1']), other('c3', ['c2']), other('c4', [])] })
    await user.click(screen.getByRole('button', { name: 'projects_section_organization' }))
    const select = screen.getByRole('option', { name: 'projects_dependencies_add' }).closest('select') as HTMLSelectElement
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['projects_dependencies_add', 'Card c4'])
  })

  it('editar parte do card salvo', async () => {
    const { onSave, user } = setup({ card: existing })
    expect(title().value).toBe('Card salvo')
    await user.clear(title())
    await user.type(title(), 'Card renomeado')
    await user.click(saveButton())
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Card renomeado', priority: 'high', labels: ['bug'], estimated_days: 2 })
  })

  // API-013: outra pessoa gravou os mesmos campos.
  it('conflito: o aviso diz os campos, e manter a minha grava o formulário que o hook devolve', async () => {
    const onAutoSave = vi.fn<(form: CardForm) => AutoSaveResult>(() => ({ attachments: [], uploadedPendingIds: [] }))
    const onResolveConflict = vi.fn((_choice: 'theirs' | 'mine', form: CardForm) => ({ ...form, description: 'nota dela' }))
    const { user, setConflict } = setup({ card: existing, onAutoSave, onResolveConflict })
    setConflict({ cardId: 'c1', theirs: { ...existing, title: 'Título dela', updated_at: 'v3' }, fields: ['title', 'priority'] })

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('projects_conflict_title')
    expect(banner.textContent).toContain('projects_conflict_fields')
    expect(document.activeElement?.textContent).toBe('projects_conflict_title')

    await user.click(within(banner).getByRole('button', { name: 'projects_conflict_keep' }))
    expect(onResolveConflict).toHaveBeenCalledWith('mine', expect.objectContaining({ title: 'Card salvo' }))
    await waitFor(() => expect(onAutoSave).toHaveBeenCalled())
    expect(onAutoSave.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Card salvo', description: 'nota dela' })
  })

  it('conflito: carregar a versão salva troca o formulário pelo do servidor', async () => {
    const theirs = { ...existing, title: 'Título dela', updated_at: 'v3' }
    const onResolveConflict = vi.fn((): CardForm => ({ ...cardFormFrom(theirs) }))
    const { user, setConflict } = setup({ card: existing, onAutoSave: () => null, onResolveConflict })
    setConflict({ cardId: 'c1', theirs, fields: ['title'] })
    await user.click(screen.getByRole('button', { name: 'projects_conflict_load' }))
    expect(onResolveConflict).toHaveBeenCalledWith('theirs', expect.anything())
    expect(title().value).toBe('Título dela')
  })

  it('gravação refeita por cima de outra pessoa: o campo que ela mudou entra no formulário', async () => {
    const onAutoSave = vi.fn((): AutoSaveResult => ({ attachments: [], uploadedPendingIds: [], merged: { title: 'Título dela' } }))
    const { user } = setup({ card: existing, onAutoSave })
    await user.click(screen.getByRole('button', { name: 'projects_priority_low' }))
    await waitFor(() => expect(title().value).toBe('Título dela'))
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

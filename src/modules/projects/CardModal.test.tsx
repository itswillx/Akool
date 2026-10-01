// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '../../test/rtl'
import type { ProjectCard } from '../../types'

// QA-003: o modal de card do quadro — criar exige título, etiquetas não
// repetem, leitura sem edição não salva, e editar parte do card salvo.

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

import { CardModal } from './card/CardModal'

const existing: ProjectCard = {
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'Card salvo', description: '', priority: 'high',
  start_date: null, due_date: null, estimated_days: 2, assignee_user_id: null, labels: ['bug'],
  linked_page_id: null, parent_card_id: null, depends_on: [], completed: false, checklist: [],
  attachments: [], links: [], sort_order: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
}

function setup(props: { card?: ProjectCard | null; canEdit?: boolean; onDelete?: () => void } = {}) {
  const onSave = vi.fn<(form: { title: string; labels: string[] }, extras: unknown) => void>()
  const onClose = vi.fn()
  render(
    <CardModal
      card={props.card ?? null} boardId="b1" columnId="col1" columnName="A fazer" members={[]} allCards={[]}
      canEdit={props.canEdit ?? true} onClose={onClose} onSave={onSave} onDelete={props.onDelete} onOpenPage={() => {}}
    />,
  )
  return { onSave, onClose, user: userEvent.setup() }
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

  it('etiqueta entra com Enter, sem espaços e sem repetir', async () => {
    const { onSave, user } = setup()
    await user.type(title(), 'Com etiquetas')
    await user.click(screen.getByRole('button', { name: 'projects_section_organization' }))
    const labelInput = screen.getByPlaceholderText('projects_labels_placeholder')
    await user.type(labelInput, '  urgente  {Enter}')
    await user.type(labelInput, 'urgente{Enter}')
    await user.type(labelInput, 'cliente{Enter}')
    await user.click(saveButton())
    expect(onSave.mock.calls[0][0].labels).toEqual(['urgente', 'cliente'])
  })

  it('editar parte do card salvo', async () => {
    const { onSave, user } = setup({ card: existing })
    expect(title().value).toBe('Card salvo')
    await user.clear(title())
    await user.type(title(), 'Card renomeado')
    await user.click(saveButton())
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Card renomeado', priority: 'high', labels: ['bug'], estimated_days: 2 })
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

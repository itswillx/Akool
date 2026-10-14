// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent } from '../../../test/rtl'
import type { ProjectCardAttachment, ProjectCardChecklistItem } from '../../../types'
import type { PendingFile } from './cardDraft'

// API-013 (achado 1g): o modal do card segue os limites do gatilho
// project_cards_integrity, para o servidor não recusar no meio da edição.

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../lib/storageUrl', () => ({ resolveSignedUrl: async (_bucket: string, stored: string) => stored }))
vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

import { ATTACHMENTS_MAX, CHECKLIST_MAX_ITEMS, CHECKLIST_MAX_TEXT } from '../../../lib/cardLimits'
import { CardAttachmentsSection, CardChecklistSection } from './CardSections'

const checklist = (n: number): ProjectCardChecklistItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, text: `Item ${i}`, completed: false }))

const attachments = (n: number): ProjectCardAttachment[] =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}`, url: `cards/a${i}.jpg`, name: `a${i}.jpg` }))

const pending = (n: number): PendingFile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, file: new File(['x'], `p${i}.png`, { type: 'image/png' }), preview: `blob:p${i}` }))

function setupChecklist(items: ProjectCardChecklistItem[]) {
  const onUpdate = vi.fn<(items: ProjectCardChecklistItem[], immediate: boolean) => void>()
  render(<CardChecklistSection items={items} canEdit onUpdate={onUpdate} />)
  return { onUpdate, user: userEvent.setup() }
}

function setupAttachments(props: { attachments?: ProjectCardAttachment[]; pendingFiles?: PendingFile[]; removedIds?: string[] }) {
  const onAddPending = vi.fn<(file: File) => void>()
  render(
    <CardAttachmentsSection
      attachments={props.attachments ?? []} pendingFiles={props.pendingFiles ?? []} removedIds={props.removedIds ?? []}
      canEdit onAddPending={onAddPending} onRemoveExisting={() => {}} onRemovePending={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /projects_attachments/ }))
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!fileInput) throw new Error('sem input de arquivo')
  const addButton = screen.getByRole<HTMLButtonElement>('button', { name: 'projects_attachments_add' })
  const pick = () => fireEvent.change(fileInput, { target: { files: [new File(['x'], 'nova.png', { type: 'image/png' })] } })
  return { onAddPending, fileInput, addButton, pick }
}

const addInput = () => screen.getByPlaceholderText<HTMLInputElement>('projects_checklist_placeholder')

describe('CardChecklistSection: limites do servidor', () => {
  it(`com ${CHECKLIST_MAX_ITEMS} itens não deixa adicionar outro`, async () => {
    const { onUpdate, user } = setupChecklist(checklist(CHECKLIST_MAX_ITEMS))
    await user.click(screen.getByRole('button', { name: /projects_checklist/ }))
    expect(addInput().disabled).toBe(true)
    fireEvent.change(addInput(), { target: { value: 'Mais um' } })
    fireEvent.keyDown(addInput(), { key: 'Enter' })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('um abaixo do limite ainda adiciona, e o item novo é o último', async () => {
    const { onUpdate, user } = setupChecklist(checklist(CHECKLIST_MAX_ITEMS - 1))
    await user.click(screen.getByRole('button', { name: /projects_checklist/ }))
    expect(addInput().disabled).toBe(false)
    await user.type(addInput(), 'Último{Enter}')
    expect(onUpdate).toHaveBeenCalledTimes(1)
    const [next, immediate] = onUpdate.mock.calls[0]
    expect(next).toHaveLength(CHECKLIST_MAX_ITEMS)
    expect(next.at(-1)).toMatchObject({ text: 'Último', completed: false })
    expect(immediate).toBe(true)
  })

  it(`texto do item novo e dos existentes vai até ${CHECKLIST_MAX_TEXT} caracteres`, async () => {
    const { user } = setupChecklist(checklist(2))
    await user.click(screen.getByRole('button', { name: /projects_checklist/ }))
    expect(addInput().maxLength).toBe(CHECKLIST_MAX_TEXT)
    for (const text of ['Item 0', 'Item 1']) {
      expect(screen.getByDisplayValue<HTMLInputElement>(text).maxLength).toBe(CHECKLIST_MAX_TEXT)
    }
  })
})

describe('CardAttachmentsSection: limites do servidor', () => {
  it(`com ${ATTACHMENTS_MAX} anexos, contando os pendentes, adicionar fica desabilitado`, () => {
    const { onAddPending, fileInput, addButton, pick } = setupAttachments({
      attachments: attachments(ATTACHMENTS_MAX - 2), pendingFiles: pending(2),
    })
    expect(addButton.disabled).toBe(true)
    expect(fileInput.disabled).toBe(true)
    expect(screen.queryByText('projects_attachments_paste_hint')).toBeNull()
    pick()
    expect(onAddPending).not.toHaveBeenCalled()
  })

  it('anexo removido não conta: abaixo do limite volta a deixar adicionar', () => {
    const { onAddPending, fileInput, addButton, pick } = setupAttachments({
      attachments: attachments(ATTACHMENTS_MAX), removedIds: ['a0'],
    })
    expect(addButton.disabled).toBe(false)
    expect(fileInput.disabled).toBe(false)
    expect(screen.getByText('projects_attachments_paste_hint')).toBeTruthy()
    pick()
    expect(onAddPending).toHaveBeenCalledTimes(1)
    expect(onAddPending.mock.calls[0][0].name).toBe('nova.png')
  })
})

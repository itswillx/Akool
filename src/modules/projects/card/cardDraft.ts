// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { supabase } from '../../../lib/supabase'
import { uploadContextBucket, validateUpload } from '../../../lib/uploadValidation'
import type { TranslationKey } from '../../../i18n/translations'
import type { ProjectCard, ProjectCardAttachment, ProjectCardChecklistItem, ProjectCardLink, ProjectCardPriority } from '../../../types'
import { CARD_MODAL_STATE_KEY } from '../projectsShared'
import { sessionKey } from '../../../lib/localKeys'
import type { CardField, CardFields, CardPatch } from '../../../lib/data/projects'

// ─── Card modal ───────────────────────────────────────────────────────────────

export interface CardForm {
  title: string; description: string; priority: ProjectCardPriority; start_date: string; due_date: string;
  estimated_days: number;
  assignee_user_id: string | null; labels: string[]; linked_page_id: string | null;
  parent_card_id: string | null; depends_on: string[];
  completed: boolean; checklist: ProjectCardChecklistItem[]; attachments: ProjectCardAttachment[]; links: ProjectCardLink[];
}

export interface PendingFile { id: string; file: File; preview: string }

export interface CardSaveExtras { pendingFiles: PendingFile[]; removedAttachmentIds: string[] }

export interface AutoSaveResult {
  attachments: ProjectCardAttachment[]
  uploadedPendingIds: string[]
  /**
   * API-013: o que outra pessoa gravou em campos que esta edição não mexeu
   * (a gravação foi refeita por cima da versão dela). O modal adota esses
   * valores nos campos que a pessoa não mudou desde então.
   */
  merged?: Partial<CardForm>
}

/** API-013: a gravação parou porque outra pessoa mudou os mesmos campos. */
export interface CardConflict {
  cardId: string
  theirs: ProjectCard
  fields: CardField[]
}

export const CARD_FIELD_LABELS: Record<CardField, TranslationKey> = {
  title: 'projects_card_title', description: 'projects_card_description', priority: 'projects_priority',
  start_date: 'projects_start_date', due_date: 'projects_due_date', estimated_days: 'projects_estimated_days',
  assignee_user_id: 'projects_assignee', labels: 'projects_labels', linked_page_id: 'projects_linked_page',
  parent_card_id: 'projects_parent_task', depends_on: 'projects_dependencies', completed: 'projects_overview_completed',
  checklist: 'projects_checklist', links: 'projects_links', attachments: 'projects_attachments',
}

interface UploadCardImagesResult {
  uploaded: ProjectCardAttachment[]
  uploadedPendingIds: string[]
  failedCount: number
}

export interface CardDraftStored {
  form: CardForm
  savedAt: string
  removedAttachmentIds: string[]
}

interface CardModalStored {
  open: boolean
  boardId: string
  cardId: string | null
  columnId?: string
}

/** O formulário de um card (ou o vazio, de card novo). */
export function cardFormFrom(card: CardFields | null): CardForm {
  return {
    title: card?.title ?? '', description: card?.description ?? '', priority: card?.priority ?? 'medium',
    start_date: card?.start_date ?? '', due_date: card?.due_date ?? '', estimated_days: card?.estimated_days ?? 1,
    assignee_user_id: card?.assignee_user_id ?? null,
    labels: card?.labels ?? [], linked_page_id: card?.linked_page_id ?? null,
    parent_card_id: card?.parent_card_id ?? null, depends_on: card?.depends_on ?? [], completed: card?.completed ?? false,
    checklist: card?.checklist ?? [], attachments: card?.attachments ?? [], links: card?.links ?? [],
  }
}

/** Campos do banco no formato do formulário (data null vira vazia). */
export function formPatchFrom(patch: CardPatch): Partial<CardForm> {
  const out: Partial<CardForm> = { ...patch } as Partial<CardForm>
  if ('start_date' in patch) out.start_date = patch.start_date ?? ''
  if ('due_date' in patch) out.due_date = patch.due_date ?? ''
  return out
}

/** Os campos como o banco guarda: título sem espaço nas pontas e data vazia como null. */
export function formFields(form: CardForm, attachments: ProjectCardAttachment[] = form.attachments): CardFields {
  return {
    title: form.title.trim(), description: form.description, priority: form.priority,
    start_date: form.start_date || null, due_date: form.due_date || null, estimated_days: form.estimated_days,
    assignee_user_id: form.assignee_user_id, labels: form.labels,
    linked_page_id: form.linked_page_id, parent_card_id: form.parent_card_id, depends_on: form.depends_on,
    completed: form.completed, checklist: form.checklist, links: form.links, attachments,
  }
}

export function getDraftKey(boardId: string, cardId: string | null, columnId?: string) {
  return sessionKey.cardDraft(boardId, cardId, columnId)
}

export function saveCardDraft(key: string, draft: CardDraftStored) {
  try { sessionStorage.setItem(key, JSON.stringify(draft)) } catch { /* quota */ }
}

export function loadCardDraft(key: string): CardDraftStored | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as CardDraftStored : null
  } catch { return null }
}

export function clearCardDraft(key: string) {
  try { sessionStorage.removeItem(key) } catch { /* ignore */ }
}

export function saveCardModalState(state: CardModalStored) {
  try { sessionStorage.setItem(CARD_MODAL_STATE_KEY, JSON.stringify(state)) } catch { /* quota */ }
}

export function loadCardModalState(): CardModalStored | null {
  try {
    const raw = sessionStorage.getItem(CARD_MODAL_STATE_KEY)
    return raw ? JSON.parse(raw) as CardModalStored : null
  } catch { return null }
}

export function clearCardModalState() {
  try { sessionStorage.removeItem(CARD_MODAL_STATE_KEY) } catch { /* ignore */ }
}

async function uploadCardImages(
  userId: string, boardId: string, cardId: string, pending: PendingFile[],
): Promise<UploadCardImagesResult> {
  const uploaded: ProjectCardAttachment[] = []
  const uploadedPendingIds: string[] = []
  let failedCount = 0
  for (const p of pending) {
    // Defesa em profundidade: revalida mesmo que o arquivo já tenha passado
    // pela checagem em addPendingFile (caso um caminho futuro alimente
    // pendingFiles sem passar por lá).
    const result = validateUpload('card-image', p.file)
    if (!result.ok) {
      failedCount++
      continue
    }
    const path = `${userId}/${boardId}/${cardId}/${Date.now()}-${p.id}.${result.ext}`
    const { error } = await supabase.storage
      .from(uploadContextBucket('card-image'))
      .upload(path, result.file, { contentType: result.file.type, upsert: false })
    if (error) {
      failedCount++
      continue
    }
    // Bucket privado: persiste o path; a URL assinada e' gerada no render.
    uploaded.push({ id: crypto.randomUUID(), url: path, name: p.file.name || `image.${result.ext}` })
    uploadedPendingIds.push(p.id)
  }
  return { uploaded, uploadedPendingIds, failedCount }
}

export async function persistCardAttachments(
  userId: string, boardId: string, cardId: string,
  form: CardForm, extras: CardSaveExtras,
): Promise<AutoSaveResult> {
  let attachments = (form.attachments ?? []).filter(a => !extras.removedAttachmentIds.includes(a.id))
  let uploadedPendingIds: string[] = []
  if (extras.pendingFiles.length > 0) {
    const { uploaded, uploadedPendingIds: ids, failedCount } = await uploadCardImages(userId, boardId, cardId, extras.pendingFiles)
    if (failedCount > 0 && uploaded.length === 0) throw new Error('upload_failed')
    attachments = [...attachments, ...uploaded]
    uploadedPendingIds = ids
  }
  return { attachments, uploadedPendingIds }
}

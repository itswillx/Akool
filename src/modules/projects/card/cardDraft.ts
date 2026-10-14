// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica. API-013: o
// rascunho guarda a base (versão e campos) de onde partiu, e as imagens sobem
// uma a uma (o editor guarda o que já subiu, para não subir de novo).
import { supabase } from '../../../lib/supabase'
import { uploadContextBucket, validateUpload } from '../../../lib/uploadValidation'
import type { TranslationKey } from '../../../i18n/translations'
import type { ProjectCardAttachment, ProjectCardChecklistItem, ProjectCardLink, ProjectCardPriority } from '../../../types'
import { CARD_MODAL_STATE_KEY } from '../projectsShared'
import { sessionKey } from '../../../lib/localKeys'
import type { CardBase, CardField, CardFields, CardPatch } from '../../../lib/data/projects'

// ─── Card modal ───────────────────────────────────────────────────────────────

export interface CardForm {
  title: string; description: string; priority: ProjectCardPriority; start_date: string; due_date: string;
  estimated_days: number;
  assignee_user_id: string | null; labels: string[]; linked_page_id: string | null;
  parent_card_id: string | null; depends_on: string[];
  completed: boolean; checklist: ProjectCardChecklistItem[]; attachments: ProjectCardAttachment[]; links: ProjectCardLink[];
}

export interface PendingFile { id: string; file: File; preview: string }

export const CARD_FIELD_LABELS: Record<CardField, TranslationKey> = {
  title: 'projects_card_title', description: 'projects_card_description', priority: 'projects_priority',
  start_date: 'projects_start_date', due_date: 'projects_due_date', estimated_days: 'projects_estimated_days',
  assignee_user_id: 'projects_assignee', labels: 'projects_labels', linked_page_id: 'projects_linked_page',
  parent_card_id: 'projects_parent_task', depends_on: 'projects_dependencies', completed: 'projects_overview_completed',
  checklist: 'projects_checklist', links: 'projects_links', attachments: 'projects_attachments',
}

export interface CardDraftStored {
  form: CardForm
  savedAt: string
  removedAttachmentIds: string[]
  /**
   * API-013: a versão e os campos de onde o formulário partiu. Ao restaurar,
   * a primeira gravação vai sobre essa versão: se outra pessoa gravou no meio,
   * vira refazer ou aviso, e não passa por cima. Rascunho sem base é de antes
   * do API-013.
   */
  base?: CardBase
  /** Imagens que já subiram e ainda não entraram no card (a gravação final falhou ou ficou no aviso). */
  uploaded?: ProjectCardAttachment[]
  /** O que estava sendo gravado quando o rascunho foi escrito: na volta, o servidor ter isso não é conflito. */
  sentPatch?: CardPatch
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

/**
 * A chave do rascunho: card existente pelo id (a coluna não entra: o mesmo card
 * aberto pela coluna ou pelo quadro é o mesmo rascunho); card novo pela coluna.
 */
export function draftKeyFor(boardId: string, cardId: string | null, columnId?: string) {
  return cardId ? sessionKey.cardDraft(boardId, cardId) : sessionKey.cardDraft(boardId, null, columnId)
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

/**
 * Sobe uma imagem pendente para <quem envia>/<quadro>/<card>/ (a pasta que o
 * gatilho exige para anexo novo). Devolve o anexo, ou null se não subiu.
 */
export async function uploadCardImage(
  userId: string, boardId: string, cardId: string, pending: PendingFile,
): Promise<ProjectCardAttachment | null> {
  // Defesa em profundidade: revalida mesmo que o arquivo já tenha passado pela
  // checagem ao entrar na lista de pendentes.
  const result = validateUpload('card-image', pending.file)
  if (!result.ok) return null
  const path = `${userId}/${boardId}/${cardId}/${Date.now()}-${pending.id}.${result.ext}`
  const { error } = await supabase.storage
    .from(uploadContextBucket('card-image'))
    .upload(path, result.file, { contentType: result.file.type, upsert: false })
  if (error) return null
  // Bucket privado: persiste o path; a URL assinada é gerada no render.
  return { id: crypto.randomUUID(), url: path, name: pending.file.name || `image.${result.ext}` }
}

/** Apaga imagens que subiram e nunca entraram no card (a pasta é de quem enviou). */
export async function removeCardImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await supabase.storage.from(uploadContextBucket('card-image')).remove(paths)
}

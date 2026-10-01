// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { supabase } from '../../../lib/supabase'
import { uploadContextBucket, validateUpload } from '../../../lib/uploadValidation'
import type { ProjectCardAttachment, ProjectCardChecklistItem, ProjectCardLink, ProjectCardPriority } from '../../../types'
import { CARD_MODAL_STATE_KEY } from '../projectsShared'
import { sessionKey } from '../../../lib/localKeys'

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

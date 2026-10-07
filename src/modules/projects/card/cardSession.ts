// API-013: as decisões da edição de um card, sem React e sem rede (o editor,
// useCardEditor, faz a E/S e guarda o estado). Uma edição parte de uma base
// (versão + campos); cada gravação manda o que difere da base; quando outra
// pessoa gravou no meio, estas funções dizem o que adotar dela e o que está em
// disputa.
import { baseOf, diffCardFields, sameCardValue, type CardBase, type CardField, type CardFields, type CardPatch } from '../../../lib/data/projects'
import type { ProjectCard, ProjectCardAttachment } from '../../../types'
import { cardFormFrom, formFields, formPatchFrom, type CardDraftStored, type CardForm, type PendingFile } from './cardDraft'

/** A gravação parou: outra pessoa mudou os mesmos campos. */
export interface CardConflict {
  /** A versão salva. */
  theirs: CardBase
  /** Os campos em disputa. */
  fields: CardField[]
  /** De onde as mudanças da pessoa são medidas (a base que o formulário tinha). */
  editsBase: CardBase
}

/** De onde o editor parte ao abrir o modal. */
export interface EditorStart {
  form: CardForm
  base: CardBase | null
  removedAttachmentIds: string[]
  /** Rascunho com mudança não gravada (a página recarregou no meio): grava ao montar. */
  pending: boolean
  /** Imagens que já subiram numa edição anterior e ainda não entraram no card. */
  uploaded: ProjectCardAttachment[]
  /** O que a edição anterior estava gravando quando o rascunho foi escrito. */
  sentPatch: CardPatch | null
}

/** O que a pessoa mudou em relação à base. Anexos ficam de fora: vão por intenção (attachmentsFor). */
export function userEdits(base: CardBase, form: CardForm): CardPatch {
  return diffCardFields(base.fields, formFields(form, base.fields.attachments))
}

/**
 * A abertura do modal:
 * - card novo: o rascunho dele, se houver, sem base;
 * - rascunho com base e sem mudança pendente: o card como está no servidor;
 * - rascunho com mudança pendente: o rascunho e a base dele (grava ao montar);
 * - rascunho de antes do API-013 (sem base): descartado, porque não dá para
 *   saber de que versão ele partiu, e gravar por cima desfaria a outra pessoa.
 */
export function openEditor(card: ProjectCard | null, draft: CardDraftStored | null, canEdit = true): EditorStart {
  const empty = { uploaded: [], sentPatch: null }
  if (!card) {
    return { form: draft?.form ?? cardFormFrom(null), base: null, removedAttachmentIds: draft?.removedAttachmentIds ?? [], pending: false, ...empty }
  }
  const fresh: EditorStart = { form: cardFormFrom(card), base: baseOf(card), removedAttachmentIds: [], pending: false, ...empty }
  // Sem permissão de editar (ou rascunho de antes do API-013): o card como está.
  if (!canEdit || !draft?.base) return fresh
  const removed = draft.removedAttachmentIds ?? []
  const uploaded = draft.uploaded ?? []
  if (Object.keys(userEdits(draft.base, draft.form)).length === 0 && removed.length === 0 && uploaded.length === 0) return fresh
  return { form: draft.form, base: draft.base, removedAttachmentIds: removed, pending: true, uploaded, sentPatch: draft.sentPatch ?? null }
}

/**
 * Anexos pela intenção, sobre a base atual: os dela menos os que a pessoa
 * removeu, mais os que subiram nesta edição e ainda não estão nela. Assim
 * anexo que outra pessoa pôs ou tirou nunca vira disputa.
 */
export function attachmentsFor(
  base: readonly ProjectCardAttachment[], removedIds: readonly string[], uploaded: readonly ProjectCardAttachment[],
): ProjectCardAttachment[] {
  const kept = base.filter(a => !removedIds.includes(a.id))
  const added = uploaded.filter(u => !removedIds.includes(u.id) && !base.some(a => a.id === u.id))
  return [...kept, ...added]
}

/**
 * O que a gravação manda sobre a versão `current`: só o que a pessoa mudou
 * (medido da base de onde o formulário partiu, `editsBase`) e que ainda difere
 * de `current`, mais os anexos por intenção. Campo que a pessoa não mexeu
 * nunca vai, nem com o valor velho do formulário: depois de um refazer, a
 * `current` tem o que outra pessoa gravou, e mandar o valor velho desfaria.
 */
export function planPatch(
  editsBase: CardBase, current: CardBase, form: CardForm, removedIds: readonly string[], uploaded: readonly ProjectCardAttachment[],
): CardPatch {
  const patch: CardPatch = diffCardFields(current.fields, userEdits(editsBase, form))
  const attachments = attachmentsFor(current.fields.attachments, removedIds, uploaded)
  if (!sameCardValue(current.fields.attachments, attachments)) patch.attachments = attachments
  return patch
}

/**
 * Campos em disputa: mudaram no servidor em relação à base e, lá, estão
 * diferentes do que esta gravação manda (os dois lados com o mesmo valor não
 * é disputa).
 */
export function contestedKeys(base: CardFields, current: CardFields, patch: CardPatch): CardField[] {
  return (Object.keys(patch) as CardField[]).filter(key =>
    key !== 'attachments' && !sameCardValue(base[key], current[key]) && !sameCardValue(current[key], patch[key]))
}

/** O que outra pessoa mudou em relação à base, fora dos campos desta gravação e dos anexos. */
export function foreignChanges(base: CardFields, current: CardFields, own: CardPatch): CardPatch {
  const changed: CardPatch = diffCardFields(base, current)
  for (const key of Object.keys(changed) as CardField[]) {
    if (key === 'attachments' || key in own) delete changed[key]
  }
  return changed
}

/**
 * Leva para o formulário o que outra pessoa gravou (`merged`) enquanto `sent`
 * era gravado. Campo que a pessoa não mexeu desde o envio recebe o valor dela;
 * campo que a pessoa mexeu no meio, e que ficou diferente do dela, fica como a
 * pessoa deixou e volta como disputa (o aviso pergunta).
 */
export function absorbForeign(form: CardForm, sent: CardForm, merged: CardPatch): { form: CardForm; contested: CardField[] } {
  const theirs = formPatchFrom(merged)
  const next: Record<string, unknown> = { ...form }
  const contested: CardField[] = []
  for (const key of Object.keys(theirs) as (keyof CardForm)[]) {
    if (sameCardValue(form[key], sent[key])) next[key] = theirs[key]
    else if (!sameCardValue(form[key], theirs[key])) contested.push(key)
  }
  return { form: next as unknown as CardForm, contested }
}

/**
 * Depois de gravar: o formulário mostra os anexos da base; a remoção e a
 * imagem pendente saem só quando a base as confirma (as feitas no meio da
 * gravação continuam valendo).
 */
export function confirmAttachments(
  base: CardFields, removedIds: readonly string[], pending: readonly PendingFile[], uploads: ReadonlyMap<string, ProjectCardAttachment>,
): { attachments: ProjectCardAttachment[]; removedIds: string[]; pending: PendingFile[]; confirmed: string[] } {
  const inBase = (id: string) => base.attachments.some(a => a.id === id)
  const confirmed = pending.filter(p => { const up = uploads.get(p.id); return !!up && inBase(up.id) }).map(p => p.id)
  return {
    attachments: base.attachments,
    removedIds: removedIds.filter(inBase),
    pending: pending.filter(p => !confirmed.includes(p.id)),
    confirmed,
  }
}

/**
 * A escolha no aviso. As mudanças da pessoa são medidas da base que o
 * formulário tinha; o resultado parte da versão salva.
 * - "Manter a minha": a versão salva com tudo o que a pessoa mudou.
 * - "Carregar a versão salva": a versão salva nos campos em disputa, e as
 *   outras mudanças da pessoa continuam.
 */
export function resolveChoice(choice: 'theirs' | 'mine', conflict: CardConflict, form: CardForm): { form: CardForm; base: CardBase } {
  const edits = userEdits(conflict.editsBase, form)
  if (choice === 'theirs') {
    for (const key of conflict.fields) delete edits[key]
  }
  return { form: { ...cardFormFrom(conflict.theirs.fields), ...formPatchFrom(edits) }, base: conflict.theirs }
}

// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
Check,
CheckSquare,
Copy,
ExternalLink,
ListOrdered, ListPlus,
Trash2,
X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText } from '@/shared/ui/MarkdownText'
import { RichTextEditor } from '../../../components/RichTextEditor'
import { useToast } from '../../../contexts/ToastContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { activateProps } from '../../../lib/a11y'
import { formatCardAsMarkdown } from '../../../lib/cardMarkdown'
import { type QueueBadge } from '../../../lib/cardQueue'
import { copyToClipboard } from '../../../lib/clipboard'
import { prepareUpload } from '../../../lib/uploadValidation'
import type { ProjectCard, ProjectCardChecklistItem, ProjectCardPriority } from '../../../types'
import type { Member } from '../projectsShared'
import { inputStyle, labelStyle, PRIORITY_COLORS, queueBadgeLabel } from '../projectsShared'
import QueueReviewBanner from '../QueueReviewBanner'
import { GhostBtn, Modal, PrimaryBtn } from '../ui'
import { addCardLabel, CARD_LABEL_MAX_LENGTH, CARD_LABELS_MAX } from '../../../lib/cardLabels'
import { ATTACHMENTS_MAX, DEPENDS_ON_MAX } from '../../../lib/cardLimits'
import type { PendingFile } from './cardDraft'
import { CardConflictBanner } from './CardConflictBanner'
import { useCardEditor, type CardIO } from './useCardEditor'
import { dependentIds, descendantIds } from './cardRelations'
import { CardAttachmentsSection, CardChecklistSection, CardLinksSection, CollapsibleSection } from './CardSections'
import { PagePicker } from './PagePicker'

// QA-003: exportado para o teste de componente (CardModal.test.tsx).
export function CardModal({ card, boardId, columnId, columnName, members, allCards, canEdit, isMobile, queueBadge, io, onClose, onSaved, onDelete, onOpenPage, onEnqueue, onValidate }: {
  card: ProjectCard | null; boardId: string; columnId?: string; columnName?: string; members: Member[]; allCards: ProjectCard[]; canEdit: boolean; isMobile?: boolean;
  queueBadge?: QueueBadge; onEnqueue?: () => void;
  /** API-013: a E/S do quadro; versão, conflito e rascunho ficam no editor (useCardEditor). */
  io: CardIO;
  onValidate?: (approve: boolean, note?: string) => Promise<boolean>;
  /** Fecha o modal. `keepDraft`: há um aviso de conflito pendente, e o rascunho fica para a próxima abertura. */
  onClose: (opts?: { keepDraft?: boolean }) => void;
  /** Salvar gravou tudo: o quadro fecha e recarrega. */
  onSaved: () => void;
  /** Excluir: o editor para de gravar antes do DELETE e volta se ele falhar. */
  onDelete?: (editor: { stop: () => Promise<void>; resume: () => void }) => void;
  onOpenPage: (id: string) => void;
}) {
  const { t } = useLanguage()
  const { showToast } = useToast()
  const editor = useCardEditor({ card, boardId, columnId, canEdit, io })
  const { form, patchForm, conflict } = editor

  const [labelInput, setLabelInput] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [copied, setCopied] = useState(false)
  // Cada clique em Salvar (ou Aprovar) com o aviso na tela devolve o foco a ele.
  const [conflictFocus, setConflictFocus] = useState(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const priorities: ProjectCardPriority[] = ['low', 'medium', 'high', 'urgent']
  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}`)

  // PERF-010: a foto é comprimida já ao entrar na lista de pendentes, então a
  // prévia e o upload usam o arquivo reduzido (e uma foto de 12 MB é aceita).
  // Se o modal fechar antes de a compressão acabar, a foto não entra (API-013).
  const addPendingFile = (file: File) => {
    void prepareUpload('card-image', file).then(result => {
      if (!result.ok) {
        showToast('error', t(result.reason === 'too_large' ? 'upload_error_too_large' : 'upload_error_invalid_type'))
        return
      }
      const pending: PendingFile = { id: crypto.randomUUID(), file: result.file, preview: URL.createObjectURL(result.file) }
      const added = editor.addPending(pending)
      if (added === 'added') return
      URL.revokeObjectURL(pending.preview)
      if (added === 'full') showToast('error', t('projects_attachments_limit').replace('{max}', String(ATTACHMENTS_MAX)), { dedupeKey: 'card-attachments-limit' })
    })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canEdit) return
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addPendingFile(file)
      }
    }
  }

  const handleClose = () => {
    const keepDraft = !!editor.conflict
    editor.finish()
    onClose({ keepDraft })
  }

  const handleSave = async () => {
    if (editor.conflict) { setConflictFocus(n => n + 1); return }
    if (await editor.flush()) {
      editor.finish()
      onSaved()
    }
  }

  // Validação (fluxo v2): grava o que falta antes; com aviso pendente, não valida.
  const handleValidate = onValidate ? async (approve: boolean, note?: string) => {
    if (editor.conflict) { setConflictFocus(n => n + 1); return false }
    if (!await editor.flush()) return false
    const ok = await onValidate(approve, note)
    // O quadro fechou o modal: o editor termina (grava o que mudou durante a
    // validação e apaga imagens que não entraram no card).
    if (ok) editor.finish()
    return ok
  } : undefined

  const handleDelete = onDelete ? () => onDelete({ stop: editor.stop, resume: editor.resume }) : undefined

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

  const updateChecklist = (checklist: ProjectCardChecklistItem[], immediate: boolean) => {
    patchForm(f => ({ ...f, checklist }), immediate)
  }

  // API-013: "Segurança" e "segurança" são o mesmo rótulo (o servidor recusa os dois juntos).
  const addLabel = () => {
    const next = addCardLabel(form.labels, labelInput)
    if (next !== form.labels) patchForm(f => ({ ...f, labels: next }), true)
    setLabelInput('')
  }

  // Depois da escolha o aviso some: o foco vai para o título, e não para o nada.
  const resolveConflict = (choice: 'theirs' | 'mine') => {
    editor.resolve(choice)
    titleInputRef.current?.focus()
  }

  const saveStatusLabel = editor.status === 'saving'
    ? t('projects_saving')
    : editor.status === 'saved'
      ? t('projects_saved')
      : editor.status === 'error'
        ? (editor.errorKind === 'upload' ? t('projects_attachments_upload_error') : t('projects_autosave_error'))
        : null

  const priorityButtons = (
    <div>
      <label style={labelStyle}>{t('projects_priority')}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {priorities.map(p => (
          <button key={p} disabled={!canEdit} onClick={() => patchForm(f => ({ ...f, priority: p }), true)}
            style={{ flex: 1, padding: isMobile ? '10px 0' : '7px 0', minHeight: isMobile ? 40 : undefined, borderRadius: 8, border: '1.5px solid', borderColor: form.priority === p ? PRIORITY_COLORS[p] : 'var(--color-border)', backgroundColor: form.priority === p ? `${PRIORITY_COLORS[p]}1f` : 'var(--color-bg)', color: form.priority === p ? PRIORITY_COLORS[p] : 'var(--color-text-muted)', fontSize: 12, fontWeight: form.priority === p ? 700 : 500, cursor: canEdit ? 'pointer' : 'default' }}>
            {pLabel(p)}
          </button>
        ))}
      </div>
    </div>
  )

  const dueAssigneeFields = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('projects_start_date')}</label>
          <input disabled={!canEdit} type="date" max={form.due_date || undefined} value={form.start_date} onChange={e => patchForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('projects_due_date')}</label>
          <input disabled={!canEdit} type="date" min={form.start_date || undefined} value={form.due_date} onChange={e => patchForm(f => ({ ...f, due_date: e.target.value }))} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t('projects_estimated_days')}</label>
          <input
            disabled={!canEdit}
            type="number"
            min={1}
            step={1}
            value={form.estimated_days}
            onChange={e => patchForm(f => ({ ...f, estimated_days: Math.max(1, Number(e.target.value) || 1) }), true)}
            style={inputStyle}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle}>{t('projects_assignee')}</label>
        <select disabled={!canEdit} value={form.assignee_user_id ?? ''} onChange={e => patchForm(f => ({ ...f, assignee_user_id: e.target.value || null }), true)} style={inputStyle}>
          <option value="">{t('projects_unassigned')}</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
        </select>
      </div>
    </div>
  )

  // Pai e dependência possíveis: nem o próprio card, nem quem fecharia um ciclo
  // (descendente, como pai; quem já depende dele, como dependência).
  const parentOptions = useMemo(() => {
    const blocked = card ? descendantIds(card.id, allCards) : new Set<string>()
    return allCards.filter(c => c.id !== card?.id && !blocked.has(c.id))
  }, [allCards, card])
  const dependencyOptions = useMemo(() => {
    const blocked = card ? dependentIds(card.id, allCards) : new Set<string>()
    return allCards.filter(c => c.id !== card?.id && !form.depends_on.includes(c.id) && !blocked.has(c.id))
  }, [allCards, card, form.depends_on])
  const cardTitleById = useCallback(
    (id: string) => allCards.find(c => c.id === id)?.title || t('projects_new_card'),
    [allCards, t],
  )

  const parentField = (
    <div>
      <label style={labelStyle}>{t('projects_parent_task')}</label>
      <select disabled={!canEdit} value={form.parent_card_id ?? ''} onChange={e => patchForm(f => ({ ...f, parent_card_id: e.target.value || null }), true)} style={inputStyle}>
        <option value="">{t('projects_no_parent')}</option>
        {parentOptions.map(c => <option key={c.id} value={c.id}>{c.title || t('projects_new_card')}</option>)}
      </select>
    </div>
  )

  const dependenciesField = (
    <div>
      <label style={labelStyle}>{t('projects_dependencies')}</label>
      {form.depends_on.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {form.depends_on.map(id => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text)', backgroundColor: 'var(--color-hover)', padding: '3px 8px', borderRadius: 6 }}>
              {cardTitleById(id)}
              {canEdit && <button aria-label={t('common_remove')} onClick={() => patchForm(f => ({ ...f, depends_on: f.depends_on.filter(d => d !== id) }), true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0 }}><X size={11} /></button>}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <select value="" disabled={dependencyOptions.length === 0 || form.depends_on.length >= DEPENDS_ON_MAX} onChange={e => { const id = e.target.value; if (id) patchForm(f => ({ ...f, depends_on: [...f.depends_on, id] }), true) }} style={inputStyle}>
          <option value="">{t('projects_dependencies_add')}</option>
          {dependencyOptions.map(c => <option key={c.id} value={c.id}>{c.title || t('projects_new_card')}</option>)}
        </select>
      )}
    </div>
  )

  const labelsField = (
    <div>
      <label style={labelStyle}>{t('projects_labels')}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {form.labels.map((l, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text)', backgroundColor: 'var(--color-hover)', padding: '3px 8px', borderRadius: 6 }}>
            {l}{canEdit && <button aria-label={t('common_remove')} onClick={() => patchForm(f => ({ ...f, labels: f.labels.filter((_, j) => j !== i) }), true)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0 }}><X size={11} /></button>}
          </span>
        ))}
      </div>
      {canEdit && <input value={labelInput} maxLength={CARD_LABEL_MAX_LENGTH} disabled={form.labels.length >= CARD_LABELS_MAX} onChange={e => setLabelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }} placeholder={t('projects_labels_placeholder')} style={inputStyle} />}
    </div>
  )

  const linkedPageField = (
    <div>
      <label style={labelStyle}>{t('projects_linked_page')}</label>
      <PagePicker value={form.linked_page_id} onChange={(id) => patchForm(f => ({ ...f, linked_page_id: id }), true)} />
      {form.linked_page_id && (
        <button onClick={() => onOpenPage(form.linked_page_id!)} style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: 'var(--color-accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          <ExternalLink size={13} />{t('projects_open_page')}
        </button>
      )}
    </div>
  )

  const linksField = (
    <CardLinksSection
      links={form.links}
      canEdit={canEdit}
      onUpdate={(links, immediate) => patchForm(f => ({ ...f, links }), immediate)}
    />
  )

  const completedField = canEdit ? (
    <button type="button" onClick={() => patchForm(f => ({ ...f, completed: !f.completed }), true)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid', borderColor: form.completed ? '#22c55e' : 'var(--color-border)', backgroundColor: form.completed ? '#22c55e1f' : 'var(--color-bg)', color: form.completed ? '#22c55e' : 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid', borderColor: form.completed ? '#22c55e' : 'var(--color-border)', backgroundColor: form.completed ? '#22c55e' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {form.completed && <Check size={12} color="#fff" />}
      </span>
      {t('projects_overview_completed')}
    </button>
  ) : null

  const planningSection = (
    <CollapsibleSection title={t('projects_section_planning')} defaultOpen>
      {priorityButtons}
      {dueAssigneeFields}
      {completedField}
    </CollapsibleSection>
  )
  const organizationSection = (
    <CollapsibleSection title={t('projects_section_organization')}>
      {parentField}
      {dependenciesField}
      {labelsField}
    </CollapsibleSection>
  )
  const linksSection = (
    <CollapsibleSection title={t('projects_section_links')}>
      {linksField}
      {linkedPageField}
    </CollapsibleSection>
  )

  // Copia o card inteiro como Markdown para colar em outra ferramenta. Sai do
  // `form` (não do `card`), então edições ainda não salvas entram na cópia.
  const handleCopy = async () => {
    const assignee = members.find(m => m.id === form.assignee_user_id)
    const md = formatCardAsMarkdown(form, {
      columnName,
      assigneeName: assignee ? (assignee.display_name || assignee.email) : null,
      parentTitle: form.parent_card_id ? cardTitleById(form.parent_card_id) : null,
      dependencyTitles: form.depends_on.map(cardTitleById),
    }, t)
    if (!await copyToClipboard(md)) {
      showToast('error', t('projects_copy_error'))
      return
    }
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const footer = (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4,
      ...(isMobile ? { position: 'sticky', bottom: 0, backgroundColor: 'var(--color-bg)', paddingTop: 12, borderTop: '1px solid var(--color-border)', marginTop: 16 } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {canEdit && handleDelete && (
          <button onClick={handleDelete} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Trash2 size={14} />{t('projects_delete')}
          </button>
        )}
        {/* Também para viewer: copiar é leitura. */}
        <button onClick={() => { void handleCopy() }} title={t('projects_copy_card')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: copied ? '#22c55e' : 'var(--color-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t('projects_copied') : t('projects_copy_card')}
        </button>
        {canEdit && card && !card.completed && onEnqueue && (queueBadge ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            <ListOrdered size={14} />
            {queueBadgeLabel(t, queueBadge)}
          </span>
        ) : (
          <button onClick={onEnqueue} title={t('projects_queue_add_card')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <ListPlus size={14} />{t('projects_queue_add_card')}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {saveStatusLabel && (
          <span style={{ fontSize: 12, fontWeight: 600, color: editor.status === 'error' ? '#ef4444' : 'var(--color-text-muted)' }}>
            {saveStatusLabel}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={handleClose}>{t('projects_cancel')}</GhostBtn>
          {canEdit && <PrimaryBtn onClick={() => { void handleSave() }} disabled={!form.title.trim()}>{t('projects_save')}</PrimaryBtn>}
        </div>
      </div>
    </div>
  )

  const attachmentsField = (
    <CardAttachmentsSection
      attachments={form.attachments}
      pendingFiles={editor.pendingFiles}
      removedIds={editor.removedAttachmentIds}
      canEdit={canEdit}
      onAddPending={addPendingFile}
      onRemoveExisting={editor.removeAttachment}
      onRemovePending={editor.removePending}
    />
  )

  const titleField = (
    <div>
      <label style={labelStyle}>{t('projects_card_title')}</label>
      <input ref={titleInputRef} disabled={!canEdit} value={form.title} onChange={e => patchForm(f => ({ ...f, title: e.target.value }))} placeholder={t('projects_card_title_placeholder')} style={{ ...inputStyle, fontSize: isMobile ? 14 : 16, fontWeight: 600 }} autoFocus={!isMobile} />
    </div>
  )

  // Trello-style description: rendered preview by default, click to edit (visual editor).
  const descriptionField = (
    <div>
      <label style={labelStyle}>{t('projects_card_description')}</label>
      {canEdit && editingDesc ? (
        <div>
          {/* O editor de texto só lê o markdown ao montar: quando a descrição
              muda por fora (o que outra pessoa gravou, ou a escolha no aviso),
              ele remonta, senão a próxima tecla desfaria a mudança. */}
          <RichTextEditor
            key={editor.descRev}
            markdown={form.description}
            onChange={md => patchForm(f => ({ ...f, description: md }))}
            onBlur={() => setEditingDesc(false)}
            autoFocus
            minHeight={isMobile ? 200 : 440}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setEditingDesc(false)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <CheckSquare size={14} />{t('projects_desc_done')}
            </button>
          </div>
        </div>
      ) : (
        <div
          {...(canEdit ? activateProps(() => setEditingDesc(true), { label: t('a11y_edit_description') }) : {})}
          onClick={() => { if (canEdit) setEditingDesc(true) }}
          style={{ ...inputStyle, minHeight: 64, height: 'auto', padding: '10px 12px', cursor: canEdit ? 'text' : 'default' }}>
          {form.description.trim()
            ? <MarkdownText text={form.description} style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5 }} />
            : <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{canEdit ? t('projects_card_description_placeholder') : ''}</span>}
        </div>
      )}
    </div>
  )

  const mainColumn = (
    <>
      {descriptionField}
      {attachmentsField}
      <CardChecklistSection items={form.checklist} canEdit={canEdit} onUpdate={updateChecklist} />
    </>
  )

  const leftColumn = (
    <>
      {titleField}
      {mainColumn}
    </>
  )

  // Fila (fluxo v2): card em Validação esperando o usuário aprovar ou reprovar.
  const reviewBanner = card && canEdit && handleValidate && queueBadge?.kind === 'review'
    ? <QueueReviewBanner onApprove={() => handleValidate(true)} onReject={reason => handleValidate(false, reason)} />
    : null
  const conflictBanner = conflict && canEdit
    ? <CardConflictBanner fields={conflict.fields} focusSignal={conflictFocus} onLoadSaved={() => resolveConflict('theirs')} onKeepMine={() => resolveConflict('mine')} />
    : null

  return (
    <Modal
      title={card ? t('projects_edit_card') : t('projects_new_card')}
      onClose={handleClose}
      closeOnBackdrop={false}
      isMobile={isMobile}
      width={1040}
      maxHeight="92vh"
    >
      {isMobile ? (
        <div onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {conflictBanner}
          {reviewBanner}
          {leftColumn}
          {planningSection}
          {organizationSection}
          {linksSection}
          {footer}
        </div>
      ) : (
        <div onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {conflictBanner}
          {reviewBanner}
          {titleField}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(240px, 1fr)', gap: 20, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {mainColumn}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, backgroundColor: 'var(--color-bg-secondary)', borderRadius: 10 }}>
              {planningSection}
              {organizationSection}
              {linksSection}
            </div>
          </div>
          {footer}
        </div>
      )}
    </Modal>
  )
}

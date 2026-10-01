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
import { MarkdownText } from '../../../components/MarkdownText'
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
import { AUTOSAVE_DEBOUNCE_MS, inputStyle, labelStyle, PRIORITY_COLORS, queueBadgeLabel } from '../projectsShared'
import QueueReviewBanner from '../QueueReviewBanner'
import { GhostBtn, Modal, PrimaryBtn } from '../ui'
import type { AutoSaveResult, CardDraftStored, CardForm, CardSaveExtras, PendingFile } from './cardDraft'
import { CardAttachmentsSection, CardChecklistSection, CardLinksSection, CollapsibleSection } from './CardSections'
import { PagePicker } from './PagePicker'

// QA-003: exportado para o teste de componente (CardModal.test.tsx).
export function CardModal({ card, boardId: _boardId, columnId: _columnId, columnName, members, allCards, canEdit, isMobile, initialDraft, saveStatus, saveErrorKind, queueBadge, onClose, onSave, onDelete, onOpenPage, onAutoSave, onDraftChange, onEnqueue, onValidate }: {
  card: ProjectCard | null; boardId: string; columnId?: string; columnName?: string; members: Member[]; allCards: ProjectCard[]; canEdit: boolean; isMobile?: boolean;
  initialDraft?: CardDraftStored | null; saveStatus?: 'idle' | 'saving' | 'saved' | 'error'; saveErrorKind?: 'upload' | 'general';
  queueBadge?: QueueBadge; onEnqueue?: () => void;
  onValidate?: (approve: boolean, note?: string) => Promise<boolean>;
  onClose: () => void; onSave: (f: CardForm, extras: CardSaveExtras) => void; onDelete?: () => void; onOpenPage: (id: string) => void;
  onAutoSave?: (form: CardForm, extras: CardSaveExtras) => Promise<AutoSaveResult | null> | AutoSaveResult | null;
  onDraftChange?: (form: CardForm, removedAttachmentIds: string[]) => void;
}) {
  const { t } = useLanguage()
  const { showToast } = useToast()

  const resolveInitialForm = (): CardForm => {
    if (initialDraft?.form) {
      const cardUpdated = card?.updated_at ? new Date(card.updated_at).getTime() : 0
      const draftSaved = new Date(initialDraft.savedAt).getTime()
      if (!card || draftSaved >= cardUpdated) return initialDraft.form
    }
    return {
      title: card?.title ?? '', description: card?.description ?? '', priority: card?.priority ?? 'medium',
      start_date: card?.start_date ?? '', due_date: card?.due_date ?? '', estimated_days: card?.estimated_days ?? 1,
      assignee_user_id: card?.assignee_user_id ?? null,
      labels: card?.labels ?? [], linked_page_id: card?.linked_page_id ?? null,
      parent_card_id: card?.parent_card_id ?? null, depends_on: card?.depends_on ?? [], completed: card?.completed ?? false,
      checklist: card?.checklist ?? [], attachments: card?.attachments ?? [], links: card?.links ?? [],
    }
  }

  const [form, setForm] = useState<CardForm>(resolveInitialForm)
  const [labelInput, setLabelInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>(initialDraft?.removedAttachmentIds ?? [])
  const [editingDesc, setEditingDesc] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef(form)
  const removedIdsRef = useRef(removedAttachmentIds)
  const pendingFilesRef = useRef<PendingFile[]>([])
  formRef.current = form
  removedIdsRef.current = removedAttachmentIds
  pendingFilesRef.current = pendingFiles

  const priorities: ProjectCardPriority[] = ['low', 'medium', 'high', 'urgent']
  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}`)

  const getExtras = useCallback((): CardSaveExtras => ({
    pendingFiles: pendingFilesRef.current,
    removedAttachmentIds: removedIdsRef.current,
  }), [])

  const applyAutoSaveResult = useCallback((result: AutoSaveResult) => {
    setForm(f => {
      const next = { ...f, attachments: result.attachments }
      formRef.current = next
      return next
    })
    setRemovedAttachmentIds([])
    removedIdsRef.current = []
    if (result.uploadedPendingIds.length > 0) {
      setPendingFiles(prev => {
        const next = prev.filter(p => {
          if (result.uploadedPendingIds.includes(p.id)) URL.revokeObjectURL(p.preview)
          return !result.uploadedPendingIds.includes(p.id)
        })
        pendingFilesRef.current = next
        return next
      })
    }
  }, [])

  const runAutoSave = useCallback(async (nextForm: CardForm, immediate: boolean) => {
    if (!onAutoSave || !canEdit) return
    if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current)
    const execute = async () => {
      const result = await onAutoSave(nextForm, getExtras())
      if (result) applyAutoSaveResult(result)
    }
    if (immediate) await execute()
    else autoSaveDebounceRef.current = setTimeout(() => { void execute() }, AUTOSAVE_DEBOUNCE_MS)
  }, [onAutoSave, canEdit, getExtras, applyAutoSaveResult])

  const scheduleAutoSave = useCallback((nextForm: CardForm, immediate: boolean) => {
    void runAutoSave(nextForm, immediate)
  }, [runAutoSave])

  const patchForm = useCallback((updater: (f: CardForm) => CardForm, immediate = false) => {
    let nextForm: CardForm | null = null
    setForm(prev => {
      nextForm = updater(prev)
      formRef.current = nextForm
      return nextForm
    })
    if (nextForm) {
      onDraftChange?.(nextForm, removedIdsRef.current)
      scheduleAutoSave(nextForm, immediate)
    }
  }, [onDraftChange, scheduleAutoSave])

  // PERF-010: a foto é comprimida já ao entrar na lista de pendentes, então a
  // prévia e o upload usam o arquivo reduzido (e uma foto de 12 MB é aceita).
  const addPendingFile = (file: File) => {
    void prepareUpload('card-image', file).then(result => {
      if (!result.ok) {
        showToast('error', t(result.reason === 'too_large' ? 'upload_error_too_large' : 'upload_error_invalid_type'))
        return
      }
      const id = crypto.randomUUID()
      const pending: PendingFile = { id, file: result.file, preview: URL.createObjectURL(result.file) }
      setPendingFiles(prev => {
        const next = [...prev, pending]
        pendingFilesRef.current = next
        return next
      })
      void runAutoSave(formRef.current, true)
    })
  }

  const removePendingFile = (id: string) => {
    setPendingFiles(prev => {
      const item = prev.find(p => p.id === id)
      if (item) URL.revokeObjectURL(item.preview)
      const next = prev.filter(p => p.id !== id)
      pendingFilesRef.current = next
      return next
    })
  }

  const removeExistingAttachment = (id: string) => {
    const next = [...removedIdsRef.current, id]
    removedIdsRef.current = next
    setRemovedAttachmentIds(next)
    onDraftChange?.(formRef.current, next)
    void runAutoSave(formRef.current, true)
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

  const handleSave = () => {
    onSave(form, { pendingFiles, removedAttachmentIds })
  }

  useEffect(() => () => {
    if (autoSaveDebounceRef.current) clearTimeout(autoSaveDebounceRef.current)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
  }, [])

  useEffect(() => {
    const flushDraft = () => {
      if (onDraftChange) onDraftChange(formRef.current, removedIdsRef.current)
    }
    document.addEventListener('visibilitychange', flushDraft)
    window.addEventListener('pagehide', flushDraft)
    return () => {
      document.removeEventListener('visibilitychange', flushDraft)
      window.removeEventListener('pagehide', flushDraft)
    }
  }, [onDraftChange])

  const updateChecklist = (checklist: ProjectCardChecklistItem[], immediate: boolean) => {
    patchForm(f => ({ ...f, checklist }), immediate)
  }

  const addLabel = () => {
    const v = labelInput.trim()
    if (v && !form.labels.includes(v)) patchForm(f => ({ ...f, labels: [...f.labels, v] }), true)
    setLabelInput('')
  }

  const saveStatusLabel = saveStatus === 'saving'
    ? t('projects_saving')
    : saveStatus === 'saved'
      ? t('projects_saved')
      : saveStatus === 'error'
        ? (saveErrorKind === 'upload' ? t('projects_attachments_upload_error') : t('projects_autosave_error'))
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

  // Cards selectable as parent / dependency: exclude self and (for parent) own descendants to avoid cycles.
  const descendantIds = useMemo(() => {
    if (!card) return new Set<string>()
    const childrenOf = new Map<string, string[]>()
    allCards.forEach(c => {
      if (c.parent_card_id) {
        const arr = childrenOf.get(c.parent_card_id) ?? []
        arr.push(c.id)
        childrenOf.set(c.parent_card_id, arr)
      }
    })
    const out = new Set<string>()
    const stack = [card.id]
    while (stack.length) {
      const id = stack.pop()!
      for (const childId of childrenOf.get(id) ?? []) {
        if (!out.has(childId)) { out.add(childId); stack.push(childId) }
      }
    }
    return out
  }, [card, allCards])

  const parentOptions = useMemo(
    () => allCards.filter(c => c.id !== card?.id && !descendantIds.has(c.id)),
    [allCards, card, descendantIds],
  )
  const dependencyOptions = useMemo(
    () => allCards.filter(c => c.id !== card?.id && !form.depends_on.includes(c.id)),
    [allCards, card, form.depends_on],
  )
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
        <select value="" disabled={dependencyOptions.length === 0} onChange={e => { const id = e.target.value; if (id) patchForm(f => ({ ...f, depends_on: [...f.depends_on, id] }), true) }} style={inputStyle}>
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
      {canEdit && <input value={labelInput} onChange={e => setLabelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }} placeholder={t('projects_labels_placeholder')} style={inputStyle} />}
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
        {canEdit && onDelete && (
          <button onClick={onDelete} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', color: '#ef4444', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
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
          <span style={{ fontSize: 12, fontWeight: 600, color: saveStatus === 'error' ? '#ef4444' : 'var(--color-text-muted)' }}>
            {saveStatusLabel}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
          {canEdit && <PrimaryBtn onClick={handleSave} disabled={!form.title.trim()}>{t('projects_save')}</PrimaryBtn>}
        </div>
      </div>
    </div>
  )

  const attachmentsField = (
    <CardAttachmentsSection
      attachments={form.attachments}
      pendingFiles={pendingFiles}
      removedIds={removedAttachmentIds}
      canEdit={canEdit}
      onAddPending={addPendingFile}
      onRemoveExisting={removeExistingAttachment}
      onRemovePending={removePendingFile}
    />
  )

  const titleField = (
    <div>
      <label style={labelStyle}>{t('projects_card_title')}</label>
      <input disabled={!canEdit} value={form.title} onChange={e => patchForm(f => ({ ...f, title: e.target.value }))} placeholder={t('projects_card_title_placeholder')} style={{ ...inputStyle, fontSize: isMobile ? 14 : 16, fontWeight: 600 }} autoFocus={!isMobile} />
    </div>
  )

  // Trello-style description: rendered preview by default, click to edit (visual editor).
  const descriptionField = (
    <div>
      <label style={labelStyle}>{t('projects_card_description')}</label>
      {canEdit && editingDesc ? (
        <div>
          <RichTextEditor
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
  const reviewBanner = card && canEdit && onValidate && queueBadge?.kind === 'review'
    ? <QueueReviewBanner onApprove={() => onValidate(true)} onReject={reason => onValidate(false, reason)} />
    : null

  return (
    <Modal
      title={card ? t('projects_edit_card') : t('projects_new_card')}
      onClose={onClose}
      closeOnBackdrop={false}
      isMobile={isMobile}
      width={1040}
      maxHeight="92vh"
    >
      {isMobile ? (
        <div onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {reviewBanner}
          {leftColumn}
          {planningSection}
          {organizationSection}
          {linksSection}
          {footer}
        </div>
      ) : (
        <div onPaste={handlePaste} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

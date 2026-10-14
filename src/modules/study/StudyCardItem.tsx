import { useId, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp, Link2, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react'
import type { StudyCard, StudyCheckpoint } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { MarkdownText } from '@/shared/ui/MarkdownText'
import { cardProgress } from '../../lib/studyProgress'
import { isCardOverdue } from '../../lib/studySchedule'
import { STUDY_CHECKPOINT_NOTE_MAX, STUDY_CHECKPOINT_TEXT_MAX, STUDY_RESOURCE_TITLE_MAX, STUDY_URL_MAX } from '../../lib/studyLimits'
import type { StudyCardOps, StudyCardPatch } from './useStudyTopics'
import type { StudyFieldOutcome } from './studyMutations'
import { ProgressBar, SectionLabel } from './StudyBits'
import StudyCardQuiz from './StudyCardQuiz'
import {
  createDraftIds, createSaveGate, createSentField, formatDateISO, isUrlTooLong, normalizeUrl, resourceDraftAfterSave,
  resourceFromInput, useFieldDraft, type ResourceDraft,
} from './studyUi'

// One study card: inline-editable title/description, tappable checkpoints,
// resource link chips and per-card progress. Scalar fields go through
// onUpdate(patch, base), with `base` = the field when the edit started, so
// the hook can tell a change made in another tab (API-029). List items go
// through `ops`, one RPC per item: a point added in another tab survives a
// toggle here. Each op resolves to false when the server refused, and the
// "add" fields only clear after a save (API-021): what was saved leaves the
// start of the field, and whatever was typed meanwhile stays. A field edited
// over the saved text during the save (select all + paste "Capítulo 10" over
// "Capítulo 1") stays as the person left it (createSentField). The new
// item's id is stable per draft (createDraftIds): resending after a failure
// does not duplicate it. With `embedded` the outer chrome
// (border/background/padding) is dropped so the card fits a roadmap step body.

interface StudyCardItemProps {
  card: StudyCard
  // The promise tells the title draft how the save ended (kept on failure).
  onUpdate: (patch: StudyCardPatch, base?: StudyCardPatch) => Promise<StudyFieldOutcome> | void
  ops: StudyCardOps
  onRequestDelete: () => void
  // Checkpoint removal is confirmed by the caller (ConfirmDeleteModal in
  // StudySection), same flow as card/log deletion.
  onRequestRemoveCheckpoint: (checkpoint: StudyCheckpoint) => void
  // Server without the API-024 RPCs: the lists are read-only.
  listsDisabled?: boolean
  isMobile?: boolean
  embedded?: boolean
}

export default function StudyCardItem({
  card, onUpdate, ops, onRequestDelete, onRequestRemoveCheckpoint, listsDisabled = false, isMobile = false, embedded = false,
}: StudyCardItemProps) {
  const { t, lang } = useLanguage()
  // null = closed; otherwise the description when the edit started.
  const [descriptionBase, setDescriptionBase] = useState<string | null>(null)
  const [editingDue, setEditingDue] = useState(false)
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [pointsExpanded, setPointsExpanded] = useState(true)
  const [newPoint, setNewPoint] = useState('')
  // Formulário de novo recurso: null quando fechado. Sem maxLength na URL: a
  // colada maior que o teto ganha aviso (isUrlTooLong) em vez de ser cortada.
  const [resourceDraft, setResourceDraft] = useState<ResourceDraft | null>(null)
  const [saveThenClear] = useState(createSaveGate)
  const [draftIds] = useState(() => createDraftIds())
  const [fields] = useState(() => ({ point: createSentField(), title: createSentField(), url: createSentField() }))
  const urlErrorId = useId()
  const title = useFieldDraft(card.title, (draft, base) => {
    const value = draft.trim()
    if (value !== base) return onUpdate({ title: value }, { title: base })
  })

  const progress = cardProgress(card)
  const overdue = isCardOverdue(card)
  const startEdit = (id: string) => { if (!listsDisabled) setEditingCheckpointId(id) }
  const startNote = (id: string) => { if (!listsDisabled) setEditingNoteId(id) }

  const addCheckpoint = () => {
    const text = newPoint.trim()
    if (!text || listsDisabled) return
    const key = `point:${text}`
    const sent = fields.point.track(newPoint)
    void saveThenClear(key, () => ops.addCheckpoint(text, draftIds.idFor(key)),
      () => { setNewPoint(sent.after); draftIds.release(key) }).finally(sent.end)
  }

  const updateCheckpointText = (id: string, text: string) => {
    const trimmed = text.trim()
    const current = card.checkpoints.find(p => p.id === id)
    if (!current || current.text === trimmed) return
    if (!trimmed) {
      // Blanking the text is a removal — goes through the same confirmation
      // as the X button (cancelling keeps the point with its old text).
      onRequestRemoveCheckpoint(current)
      return
    }
    void ops.editCheckpoint(id, { text: trimmed })
  }

  // Empty note removes the field (study_checkpoint_edit drops the key).
  const updateCheckpointNote = (id: string, raw: string) => {
    const note = raw.trim()
    const current = card.checkpoints.find(p => p.id === id)
    if (!current || (current.note ?? '') === note) return
    void ops.editCheckpoint(id, { note })
  }

  const addResource = () => {
    const sent = resourceDraft
    const resource = sent && resourceFromInput(sent.title, sent.url)
    if (!sent || !resource || listsDisabled) return
    const key = `resource:${resource.title}\n${resource.url}`
    const marks = { title: fields.title.track(sent.title), url: fields.url.track(sent.url) }
    void saveThenClear(key, () => ops.addResource({ id: draftIds.idFor(key), ...resource }),
      () => { setResourceDraft(prev => resourceDraftAfterSave(prev, marks)); draftIds.release(key) })
      .finally(() => { marks.title.end(); marks.url.end() })
  }
  const resourceUrlOk = resourceDraft ? normalizeUrl(resourceDraft.url) !== null : false
  const resourceUrlTooLong = resourceDraft ? isUrlTooLong(resourceDraft.url) : false

  return (
    <div style={embedded
      ? { padding: 0, marginTop: 8 }
      : { border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: isMobile ? 12 : 16, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          {...title}
          placeholder={t('study_card_title_placeholder')}
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'inherit', padding: 0 }}
        />
        {editingDue ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <input
              type="date"
              autoFocus
              defaultValue={card.due_date ?? ''}
              onChange={e => { void onUpdate({ due_date: e.target.value || null }) }}
              onBlur={() => setEditingDue(false)}
              style={{ width: 132, boxSizing: 'border-box', padding: '4px 7px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12, fontFamily: 'inherit', colorScheme: 'light dark' }}
            />
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { void onUpdate({ due_date: null }); setEditingDue(false) }}
              title={t('study_card_due_clear')}
              type="button"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          </span>
        ) : card.due_date ? (
          <button
            onClick={() => setEditingDue(true)}
            title={t('study_card_due')}
            type="button"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
              border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
              color: overdue ? '#ef4444' : 'var(--color-text-muted)',
              backgroundColor: overdue ? '#ef44441c' : 'var(--color-hover)',
            }}
          >
            <CalendarClock size={11} />
            {formatDateISO(card.due_date, lang)}
          </button>
        ) : (
          <button
            onClick={() => setEditingDue(true)}
            title={t('study_card_due_set')}
            type="button"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 3, flexShrink: 0 }}
          >
            <CalendarClock size={14} />
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {progress.done}/{progress.total}
        </span>
        <button
          onClick={onRequestDelete}
          title={t('study_delete_card_title')}
          type="button"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 3, flexShrink: 0 }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div style={{ margin: '8px 0 12px' }}>
        <ProgressBar pct={progress.pct} height={4} />
      </div>

      {descriptionBase !== null ? (
        <textarea
          defaultValue={descriptionBase}
          autoFocus
          rows={4}
          placeholder={t('study_card_description_placeholder')}
          onBlur={e => {
            const value = e.target.value.trim()
            if (value !== descriptionBase) void onUpdate({ description: value }, { description: descriptionBase })
            setDescriptionBase(null)
          }}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 12 }}
        />
      ) : (
        <div style={{ marginBottom: 12 }}>
          {card.description ? (
            <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
              <MarkdownText text={card.description} />
              <button
                onClick={() => setDescriptionBase(card.description)}
                type="button"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 11.5, fontWeight: 600, padding: 0 }}
              >
                <Pencil size={11} />
                {t('study_card_edit_description')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDescriptionBase(card.description)}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, padding: 0 }}
            >
              <Pencil size={12} />
              {t('study_card_add_description')}
            </button>
          )}
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => setPointsExpanded(prev => !prev)}
        onKeyDown={e => { if (e.key === 'Enter') setPointsExpanded(prev => !prev) }}
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
      >
        <SectionLabel>{t('study_checkpoints')}</SectionLabel>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', marginBottom: 8 }}>
          {progress.done}/{progress.total}
          {pointsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </div>
      {pointsExpanded && (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {card.checkpoints.map(point => (
          <div
            key={point.id}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '5px 2px', minHeight: isMobile ? 34 : undefined, opacity: point.completed ? 0.55 : 1 }}
          >
            <input
              type="checkbox"
              checked={point.completed}
              disabled={listsDisabled}
              onChange={() => { void ops.toggleCheckpoint(point.id) }}
              style={{ marginTop: 3, width: 15, height: 15, accentColor: 'var(--color-accent)', cursor: 'pointer', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {editingCheckpointId === point.id ? (
                // Auto-growing borderless textarea styled like the display text
                // (no layout jump); Enter commits, Shift+Enter breaks the line.
                <textarea
                  autoFocus
                  rows={1}
                  defaultValue={point.text} maxLength={STUDY_CHECKPOINT_TEXT_MAX}
                  ref={el => {
                    if (el) {
                      el.style.height = 'auto'
                      el.style.height = `${el.scrollHeight}px`
                    }
                  }}
                  onInput={e => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  onBlur={e => {
                    updateCheckpointText(point.id, e.target.value)
                    setEditingCheckpointId(null)
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent',
                    resize: 'none', overflow: 'hidden', fontSize: 13, lineHeight: 1.45,
                    fontFamily: 'inherit', padding: 0, color: 'var(--color-text)', display: 'block',
                  }}
                />
              ) : (
                // Wrapping display so long checkpoint texts stay fully readable
                // (the old single-line input truncated them on mobile).
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => startEdit(point.id)}
                  onKeyDown={e => { if (e.key === 'Enter') startEdit(point.id) }}
                  style={{
                    fontSize: 13, lineHeight: 1.45, cursor: 'text',
                    overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
                    color: point.completed ? 'var(--color-text-muted)' : 'var(--color-text)',
                    textDecoration: point.completed ? 'line-through' : 'none',
                  }}
                >
                  {point.text}
                </div>
              )}
              {editingNoteId === point.id ? (
                <textarea
                  autoFocus
                  rows={1}
                  defaultValue={point.note ?? ''} maxLength={STUDY_CHECKPOINT_NOTE_MAX}
                  placeholder={t('study_checkpoint_note_placeholder')}
                  ref={el => {
                    if (el) {
                      el.style.height = 'auto'
                      el.style.height = `${el.scrollHeight}px`
                    }
                  }}
                  onInput={e => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  onBlur={e => {
                    updateCheckpointNote(point.id, e.target.value)
                    setEditingNoteId(null)
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent',
                    resize: 'none', overflow: 'hidden', fontSize: 12, lineHeight: 1.45, fontStyle: 'italic',
                    fontFamily: 'inherit', padding: 0, marginTop: 2, color: 'var(--color-text-muted)', display: 'block',
                  }}
                />
              ) : point.note ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => startNote(point.id)}
                  onKeyDown={e => { if (e.key === 'Enter') startNote(point.id) }}
                  style={{
                    fontSize: 12, lineHeight: 1.45, cursor: 'text', marginTop: 2, fontStyle: 'italic',
                    overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', color: 'var(--color-text-muted)',
                  }}
                >
                  {point.note}
                </div>
              ) : null}
            </div>
            {!point.note && editingNoteId !== point.id && !listsDisabled && (
              <button
                onClick={() => startNote(point.id)}
                title={t('study_checkpoint_note_add')}
                type="button"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, marginTop: 2, flexShrink: 0 }}
              >
                <StickyNote size={12} />
              </button>
            )}
            <button aria-label={t('common_remove')}
              onClick={() => onRequestRemoveCheckpoint(point)}
              disabled={listsDisabled}
              type="button"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, marginTop: 2, flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 2px' }}>
          <Plus size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            value={newPoint} maxLength={STUDY_CHECKPOINT_TEXT_MAX} disabled={listsDisabled} {...fields.point.watch(newPoint, setNewPoint, addCheckpoint)}
            onBlur={() => { if (newPoint.trim()) addCheckpoint() }}
            placeholder={t('study_add_checkpoint_placeholder')}
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', padding: 0 }}
          />
        </div>
      </div>
      )}

      <div style={{ marginTop: 12 }}>
        <SectionLabel>{t('study_resources')}</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {card.resources.map(resource => (
            // O chip é o link + um botão de remover ao lado (botão dentro de
            // <a> não é permitido e não recebia foco).
            <span
              key={resource.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', padding: '3px 9px',
                borderRadius: 999, fontSize: 12,
                backgroundColor: 'var(--color-hover)', border: '1px solid var(--color-border)',
              }}
            >
              <a
                href={/^https?:\/\//i.test(resource.url) ? resource.url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                <Link2 size={11} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{resource.title}</span>
              </a>
              <button
                type="button"
                aria-label={t('a11y_remove_resource')}
                title={t('a11y_remove_resource')}
                onClick={() => { void ops.removeResource(resource.id) }}
                disabled={listsDisabled}
                style={{ display: 'flex', padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {!resourceDraft && !listsDisabled && (
            <button
              onClick={() => setResourceDraft({ title: '', url: '' })}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 500, border: '1px dashed var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
            >
              <Plus size={11} />
              {t('study_add_resource')}
            </button>
          )}
        </div>
        {resourceDraft && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              value={resourceDraft.title} maxLength={STUDY_RESOURCE_TITLE_MAX}
              {...fields.title.watch(resourceDraft.title, title => setResourceDraft(prev => prev && { ...prev, title }))}
              placeholder={t('study_resource_title_placeholder')}
              style={{ flex: '1 1 130px', minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, fontFamily: 'inherit' }}
            />
            <input
              value={resourceDraft.url} {...fields.url.watch(resourceDraft.url, url => setResourceDraft(prev => prev && { ...prev, url }), addResource)}
              placeholder={t('study_resource_url_placeholder')}
              aria-invalid={resourceUrlTooLong || undefined}
              aria-describedby={resourceUrlTooLong ? urlErrorId : undefined}
              style={{ flex: '2 1 180px', minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: `1px solid ${resourceUrlTooLong ? 'var(--color-error)' : 'var(--color-border)'}`, background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, fontFamily: 'inherit' }}
            />
            <button
              onClick={addResource}
              type="button"
              disabled={!resourceUrlOk}
              style={{ padding: '7px 13px', borderRadius: 8, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: resourceUrlOk ? 'pointer' : 'default', opacity: resourceUrlOk ? 1 : 0.5 }}
            >
              {t('study_add_resource')}
            </button>
            <button
              onClick={() => setResourceDraft(null)}
              type="button"
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', fontSize: 12.5, cursor: 'pointer' }}
            >
              {t('study_cancel')}
            </button>
            {resourceUrlTooLong && (
              <div id={urlErrorId} role="alert" style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--color-error-text)' }}>
                {t('study_resource_url_too_long', { max: STUDY_URL_MAX })}
              </div>
            )}
          </div>
        )}
      </div>

      {card.quiz.length > 0 && (
        <StudyCardQuiz
          quiz={card.quiz}
          disabled={listsDisabled}
          onAnswer={(questionId, answer) => { void ops.answerQuiz(questionId, answer) }}
          onReset={onlyWrong => { void ops.resetQuiz(onlyWrong) }}
        />
      )}
    </div>
  )
}

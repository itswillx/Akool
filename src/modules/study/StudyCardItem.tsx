import { useState } from 'react'
import { CalendarClock, Check, ChevronDown, ChevronUp, Link2, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { StudyCard, StudyQuizAnswer } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { MarkdownText } from '../../components/MarkdownText'
import { cardProgress } from '../../lib/studyProgress'
import { isCardOverdue } from '../../lib/studySchedule'
import type { StudyCardPatch } from './useStudyTopics'
import { ProgressBar, SectionLabel } from './StudyBits'
import { formatDateISO } from './studyUi'

// One study card: inline-editable title/description, tappable checkpoints,
// resource link chips and per-card progress. All edits go through
// onUpdate(patch) so the hook keeps optimistic state + persistence in one
// place. With `embedded` the outer chrome (border/background/padding) is
// dropped so the card can live inside a roadmap step body.

interface StudyCardItemProps {
  card: StudyCard
  onUpdate: (patch: StudyCardPatch) => void
  onToggleCheckpoint: (checkpointId: string) => void
  onRequestDelete: () => void
  isMobile?: boolean
  embedded?: boolean
}

function normalizeUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  if (/^https?:\/\//i.test(url)) return url
  if (/^[\w-]+(\.[\w-]+)+/.test(url)) return `https://${url}`
  return null
}

export default function StudyCardItem({ card, onUpdate, onToggleCheckpoint, onRequestDelete, isMobile = false, embedded = false }: StudyCardItemProps) {
  const { t, lang } = useLanguage()
  const [editingDescription, setEditingDescription] = useState(false)
  const [editingDue, setEditingDue] = useState(false)
  const [editingCheckpointId, setEditingCheckpointId] = useState<string | null>(null)
  const [newPoint, setNewPoint] = useState('')
  const [addingResource, setAddingResource] = useState(false)
  // Collapsed by default: 5-15 questions per card would dominate the layout.
  const [quizExpanded, setQuizExpanded] = useState(false)
  const [resourceTitle, setResourceTitle] = useState('')
  const [resourceUrl, setResourceUrl] = useState('')

  const progress = cardProgress(card)
  const overdue = isCardOverdue(card)

  const addCheckpoint = () => {
    const text = newPoint.trim()
    if (!text) return
    setNewPoint('')
    onUpdate({ checkpoints: [...card.checkpoints, { id: crypto.randomUUID(), text, completed: false }] })
  }

  const updateCheckpointText = (id: string, text: string) => {
    const trimmed = text.trim()
    const current = card.checkpoints.find(p => p.id === id)
    if (!current || current.text === trimmed) return
    if (!trimmed) {
      onUpdate({ checkpoints: card.checkpoints.filter(p => p.id !== id) })
      return
    }
    onUpdate({ checkpoints: card.checkpoints.map(p => (p.id === id ? { ...p, text: trimmed } : p)) })
  }

  const removeCheckpoint = (id: string) => {
    onUpdate({ checkpoints: card.checkpoints.filter(p => p.id !== id) })
  }

  const addResource = () => {
    const url = normalizeUrl(resourceUrl)
    if (!url) return
    const title = resourceTitle.trim() || url.replace(/^https?:\/\//i, '')
    onUpdate({ resources: [...card.resources, { id: crypto.randomUUID(), title, url }] })
    setResourceTitle('')
    setResourceUrl('')
    setAddingResource(false)
  }

  const removeResource = (id: string) => {
    onUpdate({ resources: card.resources.filter(r => r.id !== id) })
  }

  // Answers lock after the first pick (retry = clear all), so the score can't
  // be gamed by flipping until it turns green.
  const answerQuiz = (id: string, answer: StudyQuizAnswer) => {
    const question = card.quiz.find(q => q.id === id)
    if (!question || question.userAnswer !== null) return
    onUpdate({ quiz: card.quiz.map(q => (q.id === id ? { ...q, userAnswer: answer } : q)) })
  }

  const resetQuiz = () => {
    onUpdate({ quiz: card.quiz.map(q => ({ ...q, userAnswer: null })) })
  }

  const quizAnswered = card.quiz.filter(q => q.userAnswer !== null).length
  const quizRight = card.quiz.filter(q => q.userAnswer !== null && q.userAnswer === q.answer).length

  return (
    <div style={embedded
      ? { padding: 0, marginTop: 8 }
      : { border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: isMobile ? 12 : 16, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          key={`title-${card.id}`}
          defaultValue={card.title}
          placeholder={t('study_card_title_placeholder')}
          onBlur={e => {
            const value = e.target.value.trim()
            if (value !== card.title) onUpdate({ title: value })
          }}
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'inherit', padding: 0 }}
        />
        {editingDue ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <input
              type="date"
              autoFocus
              defaultValue={card.due_date ?? ''}
              onChange={e => onUpdate({ due_date: e.target.value || null })}
              onBlur={() => setEditingDue(false)}
              style={{ width: 132, boxSizing: 'border-box', padding: '4px 7px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12, outline: 'none', fontFamily: 'inherit', colorScheme: 'light dark' }}
            />
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onUpdate({ due_date: null }); setEditingDue(false) }}
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

      {editingDescription ? (
        <textarea
          defaultValue={card.description}
          autoFocus
          rows={4}
          placeholder={t('study_card_description_placeholder')}
          onBlur={e => {
            const value = e.target.value.trim()
            if (value !== card.description) onUpdate({ description: value })
            setEditingDescription(false)
          }}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 12 }}
        />
      ) : (
        <div style={{ marginBottom: 12 }}>
          {card.description ? (
            <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
              <MarkdownText text={card.description} />
              <button
                onClick={() => setEditingDescription(true)}
                type="button"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 11.5, fontWeight: 600, padding: 0 }}
              >
                <Pencil size={11} />
                {t('study_card_edit_description')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingDescription(true)}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, padding: 0 }}
            >
              <Pencil size={12} />
              {t('study_card_add_description')}
            </button>
          )}
        </div>
      )}

      <SectionLabel>{t('study_checkpoints')}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {card.checkpoints.map(point => (
          <div
            key={point.id}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '5px 2px', minHeight: isMobile ? 34 : undefined }}
          >
            <input
              type="checkbox"
              checked={point.completed}
              onChange={() => onToggleCheckpoint(point.id)}
              style={{ marginTop: 3, width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }}
            />
            {editingCheckpointId === point.id ? (
              // Auto-growing borderless textarea styled like the display text
              // (no layout jump); Enter commits, Shift+Enter breaks the line.
              <textarea
                autoFocus
                rows={1}
                defaultValue={point.text}
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
                  flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                  resize: 'none', overflow: 'hidden', fontSize: 13, lineHeight: 1.45,
                  fontFamily: 'inherit', padding: 0, color: 'var(--color-text)',
                }}
              />
            ) : (
              // Wrapping display so long checkpoint texts stay fully readable
              // (the old single-line input truncated them on mobile).
              <div
                role="button"
                tabIndex={0}
                onClick={() => setEditingCheckpointId(point.id)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingCheckpointId(point.id) }}
                style={{
                  flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45, cursor: 'text',
                  overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
                  color: point.completed ? 'var(--color-text-muted)' : 'var(--color-text)',
                  textDecoration: point.completed ? 'line-through' : 'none',
                }}
              >
                {point.text}
              </div>
            )}
            <button
              onClick={() => removeCheckpoint(point.id)}
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
            value={newPoint}
            onChange={e => setNewPoint(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCheckpoint() } }}
            onBlur={() => { if (newPoint.trim()) addCheckpoint() }}
            placeholder={t('study_add_checkpoint_placeholder')}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', padding: 0 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <SectionLabel>{t('study_resources')}</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {card.resources.map(resource => (
            <a
              key={resource.id}
              href={/^https?:\/\//i.test(resource.url) ? resource.url : undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', padding: '3px 9px',
                borderRadius: 999, fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none',
                backgroundColor: 'var(--color-hover)', border: '1px solid var(--color-border)',
              }}
            >
              <Link2 size={11} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{resource.title}</span>
              <span
                onClick={e => { e.preventDefault(); e.stopPropagation(); removeResource(resource.id) }}
                style={{ display: 'flex', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                <X size={11} />
              </span>
            </a>
          ))}
          {!addingResource && (
            <button
              onClick={() => setAddingResource(true)}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 500, border: '1px dashed var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
            >
              <Plus size={11} />
              {t('study_add_resource')}
            </button>
          )}
        </div>
        {addingResource && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              value={resourceTitle}
              onChange={e => setResourceTitle(e.target.value)}
              placeholder={t('study_resource_title_placeholder')}
              style={{ flex: '1 1 130px', minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }}
            />
            <input
              value={resourceUrl}
              onChange={e => setResourceUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addResource() } }}
              placeholder={t('study_resource_url_placeholder')}
              style={{ flex: '2 1 180px', minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }}
            />
            <button
              onClick={addResource}
              type="button"
              disabled={!normalizeUrl(resourceUrl)}
              style={{ padding: '7px 13px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: normalizeUrl(resourceUrl) ? 'pointer' : 'default', opacity: normalizeUrl(resourceUrl) ? 1 : 0.5 }}
            >
              {t('study_add_resource')}
            </button>
            <button
              onClick={() => { setAddingResource(false); setResourceTitle(''); setResourceUrl('') }}
              type="button"
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', fontSize: 12.5, cursor: 'pointer' }}
            >
              {t('study_cancel')}
            </button>
          </div>
        )}
      </div>

      {card.quiz.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setQuizExpanded(prev => !prev)}
            onKeyDown={e => { if (e.key === 'Enter') setQuizExpanded(prev => !prev) }}
            style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
          >
            <SectionLabel>{t('study_quiz')}</SectionLabel>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', marginBottom: 8 }}>
              <span>
                {quizAnswered > 0 && (
                  <span style={{ color: quizRight === quizAnswered ? '#22c55e' : 'var(--color-text)' }}>
                    {t('study_quiz_score', { right: quizRight, answered: quizAnswered })}
                  </span>
                )}
                {quizAnswered > 0 && ' • '}
                {t('study_quiz_answered', { answered: quizAnswered, total: card.quiz.length })}
              </span>
              {quizExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </div>
          {quizExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {card.quiz.map((question, index) => {
              const answered = question.userAnswer !== null
              const gotIt = answered && question.userAnswer === question.answer
              const pill = (option: StudyQuizAnswer) => {
                const chosen = question.userAnswer === option
                const isCorrectOption = question.answer === option
                const highlightCorrect = answered && !gotIt && isCorrectOption
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={answered}
                    onClick={() => answerQuiz(question.id, option)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 11px', borderRadius: 999,
                      fontSize: 11.5, fontWeight: 600, cursor: answered ? 'default' : 'pointer',
                      border: chosen
                        ? `1px solid ${gotIt ? '#22c55e' : '#ef4444'}`
                        : highlightCorrect ? '1px solid #22c55e' : '1px solid var(--color-border)',
                      backgroundColor: chosen ? (gotIt ? '#22c55e1c' : '#ef44441c') : 'transparent',
                      color: chosen
                        ? (gotIt ? '#22c55e' : '#ef4444')
                        : highlightCorrect ? '#22c55e' : answered ? 'var(--color-text-muted)' : 'var(--color-text)',
                      opacity: answered && !chosen && !highlightCorrect ? 0.55 : 1,
                    }}
                  >
                    {option === 'certo' ? <Check size={11} /> : <X size={11} />}
                    {option === 'certo' ? t('study_quiz_true') : t('study_quiz_false')}
                  </button>
                )
              }
              return (
                <div key={question.id} style={{ padding: '5px 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 1, flexShrink: 0, minWidth: 18, textAlign: 'right' }}>
                      {index + 1}.
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
                        {question.statement}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                        {pill('certo')}
                        {pill('errado')}
                        {answered && (
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: gotIt ? '#22c55e' : '#ef4444' }}>
                            {gotIt
                              ? t('study_quiz_feedback_right')
                              : t('study_quiz_feedback_wrong', { answer: question.answer === 'certo' ? t('study_quiz_true') : t('study_quiz_false') })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )}
          {quizExpanded && quizAnswered > 0 && (
            <button
              onClick={resetQuiz}
              type="button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 11.5, fontWeight: 600, padding: 0 }}
            >
              <RotateCcw size={11} />
              {t('study_quiz_retry')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import { ArrowLeft, FileUp, Plus, RefreshCw, Trash2, Trophy } from 'lucide-react'
import type { StudyCard, StudyLog, StudyTopic, StudyTopicStatus } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { currentStepIndex, isTopicOverdue, stepState, topicProgress } from '../../lib/studyProgress'
import { STUDY_LEVELS } from '../../lib/studyPrompt'
import type { StudyStore } from './useStudyTopics'
import StudyRoadmapStep from './StudyRoadmapStep'
import StudyDiary from './StudyDiary'
import ImportStudyAppendModal from './ImportStudyAppendModal'
import { ProgressBar, SectionLabel, StatusPill } from './StudyBits'
import { STATUS_LABEL_KEY, STATUS_ORDER, formatTimestamp } from './studyUi'

// Focus view of a single study topic: editable metadata, status with
// started/completed side effects (handled by the hook), target date with
// overdue highlight, the study cards with tappable checkpoints and the
// per-topic diary.

interface StudyTopicDetailProps {
  topic: StudyTopic
  cards: StudyCard[]
  logs: StudyLog[]
  store: StudyStore
  requestDelete: (title: string, message: string, onConfirm: () => void) => void
  onBack: () => void
  isMobile?: boolean
}

const fieldInput = {
  width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

export default function StudyTopicDetail({ topic, cards, logs, store, requestDelete, onBack, isMobile = false }: StudyTopicDetailProps) {
  const { t, lang } = useLanguage()
  const [appendOpen, setAppendOpen] = useState(false)

  const progress = topicProgress(cards)
  const overdue = isTopicOverdue(topic)
  const orderedCards = [...cards].sort((a, b) => a.sort_order - b.sort_order)
  const stepIndex = currentStepIndex(orderedCards)
  const allDone = orderedCards.length > 0 && stepIndex === -1

  const commitText = (field: 'title' | 'area' | 'level' | 'objective') => (value: string) => {
    const trimmed = field === 'title' ? value.trim() : value.trim()
    if (field === 'title' && !trimmed) return
    if (trimmed !== topic[field]) store.updateTopic(topic.id, { [field]: trimmed })
  }

  const handleDeleteTopic = () => {
    requestDelete(
      t('study_delete_topic_title'),
      t('study_delete_topic_message', { title: topic.title }),
      () => {
        store.deleteTopic(topic.id)
        onBack()
      },
    )
  }

  return (
    <div key={topic.id} style={{ padding: isMobile ? 16 : 24, maxWidth: 860, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <button
          onClick={onBack}
          type="button"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <ArrowLeft size={14} />
          {t('study_back')}
        </button>
        <button
          onClick={handleDeleteTopic}
          type="button"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid #ef444455', background: 'none', color: '#ef4444', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <Trash2 size={13} />
          {t('study_delete_topic')}
        </button>
      </div>

      <input
        defaultValue={topic.title}
        placeholder={t('study_title_placeholder')}
        onBlur={e => commitText('title')(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', background: 'transparent', fontSize: isMobile ? 20 : 24, fontWeight: 800, color: 'var(--color-text)', fontFamily: 'inherit', padding: 0, marginBottom: 4 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatusPill status={topic.status} />
        <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          {t('study_progress_points', { done: progress.done, total: progress.total })} · {progress.pct}%
        </span>
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
          <Field label={t('study_status')}>
            <select
              value={topic.status}
              onChange={e => store.updateTopic(topic.id, { status: e.target.value as StudyTopicStatus })}
              style={{ ...fieldInput, cursor: 'pointer' }}
            >
              {STATUS_ORDER.map(status => (
                <option key={status} value={status}>{t(STATUS_LABEL_KEY[status])}</option>
              ))}
            </select>
          </Field>
          <Field label={overdue ? `${t('study_target')} · ${t('study_target_overdue')}` : t('study_target')}>
            <input
              type="date"
              value={topic.target_date ?? ''}
              onChange={e => store.updateTopic(topic.id, { target_date: e.target.value || null })}
              style={{ ...fieldInput, border: overdue ? '1px solid #ef4444' : fieldInput.border, colorScheme: 'light dark' }}
            />
          </Field>
          <Field label={t('study_area')}>
            <input defaultValue={topic.area} placeholder={t('study_area_placeholder')} onBlur={e => commitText('area')(e.target.value)} style={fieldInput} />
          </Field>
          <Field label={t('study_level')}>
            <select
              value={topic.level}
              onChange={e => store.updateTopic(topic.id, { level: e.target.value })}
              style={{ ...fieldInput, cursor: 'pointer' }}
            >
              <option value="">{t('study_level_none')}</option>
              {/* Legacy/imported levels outside the static list stay selectable. */}
              {topic.level && !(STUDY_LEVELS as readonly string[]).includes(topic.level) && (
                <option value={topic.level}>{topic.level}</option>
              )}
              {STUDY_LEVELS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
            <Field label={t('study_objective')}>
              <textarea
                defaultValue={topic.objective}
                placeholder={t('study_objective_placeholder')}
                rows={isMobile ? 3 : 4}
                onBlur={e => commitText('objective')(e.target.value)}
                style={{
                  ...fieldInput, resize: 'vertical', lineHeight: 1.5,
                  minHeight: isMobile ? 76 : 100,
                  colorScheme: 'light dark', scrollbarWidth: 'thin',
                }}
              />
            </Field>
          </div>
          <Field label={t('study_started_at')}>
            <div style={{ fontSize: 13, color: 'var(--color-text)', padding: '8px 0' }}>
              {topic.started_at ? formatTimestamp(topic.started_at, lang) : '—'}
            </div>
          </Field>
          <Field label={t('study_completed_at')}>
            <div style={{ fontSize: 13, color: 'var(--color-text)', padding: '8px 0' }}>
              {topic.completed_at ? formatTimestamp(topic.completed_at, lang) : '—'}
            </div>
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <ProgressBar pct={progress.pct} height={8} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <SectionLabel>{t('study_roadmap_title')}</SectionLabel>
          {orderedCards.length > 0 && (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6366f1', whiteSpace: 'nowrap' }}>
              {t('study_roadmap_step_of', {
                current: stepIndex === -1 ? orderedCards.length : stepIndex + 1,
                total: orderedCards.length,
              })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {topic.target_date && (
            <button
              onClick={() => store.rescheduleCards(topic.id)}
              type="button"
              disabled={orderedCards.length === 0}
              title={t('study_reschedule_hint')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12.5, fontWeight: 600, cursor: orderedCards.length === 0 ? 'default' : 'pointer', opacity: orderedCards.length === 0 ? 0.5 : 1 }}
            >
              <RefreshCw size={13} />
              {t('study_reschedule')}
            </button>
          )}
          <button
            onClick={() => store.createCard(topic.id)}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={13} />
            {t('study_add_card')}
          </button>
          <button
            onClick={() => setAppendOpen(true)}
            type="button"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <FileUp size={13} />
            {t('study_import_append')}
          </button>
        </div>
      </div>

      {allDone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10, padding: '10px 14px', borderRadius: 12, backgroundColor: '#22c55e14', border: '1px solid #22c55e40' }}>
          <Trophy size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('study_roadmap_completed')}</span>
        </div>
      )}

      {orderedCards.length === 0 ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{t('study_no_cards')}</p>
      ) : (
        <div style={{ marginTop: 14 }}>
          {orderedCards.map((card, index) => (
            <StudyRoadmapStep
              key={card.id}
              card={card}
              index={index}
              isLast={index === orderedCards.length - 1}
              state={stepState(index, orderedCards)}
              isMobile={isMobile}
              onUpdate={patch => store.updateCard(card.id, patch)}
              onToggleCheckpoint={checkpointId => store.toggleCheckpoint(card.id, checkpointId)}
              onRequestDelete={() => requestDelete(
                t('study_delete_card_title'),
                t('study_delete_card_message', { title: card.title || t('study_card_untitled') }),
                () => store.deleteCard(card.id),
              )}
            />
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--color-border)', margin: '20px 0 16px' }} />

      <StudyDiary
        logs={logs}
        onAdd={content => store.addLog(topic.id, content)}
        onRequestDeleteLog={log => requestDelete(
          t('study_delete_log_title'),
          t('study_delete_log_message'),
          () => store.deleteLog(log.id),
        )}
      />

      <ImportStudyAppendModal
        open={appendOpen}
        onClose={() => setAppendOpen(false)}
        isMobile={isMobile}
        onAppend={async parsed => {
          const count = await store.appendCards(topic.id, parsed.cards)
          return count
        }}
      />
    </div>
  )
}

import { useState } from 'react'
import { CalendarClock, Check, ChevronDown, ChevronUp, Lock, Milestone, Pencil } from 'lucide-react'
import type { StudyCard, StudyCheckpoint } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import { cardProgress, type StudyStepState } from '../../lib/studyProgress'
import { isCardOverdue } from '../../lib/studySchedule'
import type { StudyCardPatch } from './useStudyTopics'
import StudyCardItem from './StudyCardItem'
import { formatDateISO } from './studyUi'

// One step of the study roadmap trail: numbered node + connector rail on the
// left, collapsible content on the right. States are derived from the card's
// checkpoints (completed / current / locked); the lock is visual-only — a
// future step can still be opened and worked on. The expanded body embeds the
// full StudyCardItem editing surface plus the "Por que agora" rationale.

interface StudyRoadmapStepProps {
  card: StudyCard
  index: number
  isLast: boolean
  state: StudyStepState
  onUpdate: (patch: StudyCardPatch) => void
  onToggleCheckpoint: (checkpointId: string) => void
  onRequestDelete: () => void
  onRequestRemoveCheckpoint: (checkpoint: StudyCheckpoint) => void
  isMobile?: boolean
}

export default function StudyRoadmapStep({
  card, index, isLast, state, onUpdate, onToggleCheckpoint, onRequestDelete, onRequestRemoveCheckpoint, isMobile = false,
}: StudyRoadmapStepProps) {
  const { t, lang } = useLanguage()
  // null = "auto": expanded iff this is the current step. Completing the
  // current step therefore auto-collapses it and auto-expands the next one —
  // purely derived, no effects.
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const [editingRationale, setEditingRationale] = useState(false)

  const expanded = expandedOverride ?? (state === 'current')
  const progress = cardProgress(card)
  const overdue = isCardOverdue(card)
  const nodeSize = isMobile ? 28 : 34

  const node = state === 'completed' ? (
    <div style={{ width: nodeSize, height: nodeSize, borderRadius: '50%', backgroundColor: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
      <Check size={isMobile ? 14 : 16} strokeWidth={3} />
    </div>
  ) : state === 'current' ? (
    <div style={{ width: nodeSize, height: nodeSize, borderRadius: '50%', backgroundColor: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: isMobile ? 12.5 : 14, fontWeight: 700, flexShrink: 0, boxShadow: '0 0 0 4px #6366f126' }}>
      {index + 1}
    </div>
  ) : (
    <div style={{ width: nodeSize, height: nodeSize, borderRadius: '50%', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', flexShrink: 0, boxSizing: 'border-box' }}>
      <Lock size={isMobile ? 11 : 13} />
    </div>
  )

  const dueChip = card.due_date && (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
      color: overdue ? '#ef4444' : 'var(--color-text-muted)',
      backgroundColor: overdue ? '#ef44441c' : 'var(--color-hover)',
    }}>
      <CalendarClock size={11} />
      {formatDateISO(card.due_date, lang)}
    </span>
  )

  return (
    <div style={{ display: 'flex', gap: isMobile ? 10 : 12 }}>
      <div style={{ width: nodeSize, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {node}
        {!isLast && (
          <div style={{ flex: 1, width: 2, marginTop: 4, borderRadius: 1, backgroundColor: state === 'completed' ? '#22c55e' : 'var(--color-border)' }} />
        )}
      </div>

      <div
        title={state === 'locked' && !expanded ? t('study_roadmap_locked_hint') : undefined}
        style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : isMobile ? 14 : 18, opacity: state === 'locked' ? 0.55 : 1 }}
      >
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, backgroundColor: 'var(--color-surface)', padding: isMobile ? 12 : 16 }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setExpandedOverride(!expanded)}
            onKeyDown={e => { if (e.key === 'Enter') setExpandedOverride(!expanded) }}
            title={expanded ? t('study_roadmap_collapse') : t('study_roadmap_expand')}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                <span style={{ fontSize: isMobile ? 13 : 14, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                  {card.title || t('study_card_untitled')}
                </span>
                {state === 'current' && (
                  <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6366f1', backgroundColor: '#6366f11c', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {t('study_roadmap_current')}
                  </span>
                )}
              </div>
              {!expanded && card.rationale && (
                <div style={{ marginTop: 3, fontSize: 12, fontStyle: 'italic', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {card.rationale}
                </div>
              )}
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {!expanded && dueChip}
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {progress.done}/{progress.total}
              </span>
              <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>
                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </span>
            </span>
          </div>

          {expanded && (
            <div style={{ marginTop: 10 }}>
              {editingRationale ? (
                <textarea
                  defaultValue={card.rationale}
                  autoFocus
                  rows={2}
                  placeholder={t('study_card_rationale_placeholder')}
                  onBlur={e => {
                    const value = e.target.value.trim()
                    if (value !== card.rationale) onUpdate({ rationale: value })
                    setEditingRationale(false)
                  }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.45 }}
                />
              ) : card.rationale ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '8px 10px', borderRadius: 8, backgroundColor: 'var(--color-hover)' }}>
                  <Milestone size={13} style={{ color: '#6366f1', flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                      {t('study_card_rationale_label')}
                    </span>
                    <p style={{ margin: '2px 0 0', fontSize: 12.5, fontStyle: 'italic', color: 'var(--color-text)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                      {card.rationale}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditingRationale(true)}
                    type="button"
                    title={t('study_card_rationale_label')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingRationale(true)}
                  type="button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, padding: 0 }}
                >
                  <Milestone size={12} />
                  {t('study_card_add_rationale')}
                </button>
              )}

              <StudyCardItem
                card={card}
                embedded
                isMobile={isMobile}
                onUpdate={onUpdate}
                onToggleCheckpoint={onToggleCheckpoint}
                onRequestDelete={onRequestDelete}
                onRequestRemoveCheckpoint={onRequestRemoveCheckpoint}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import { useSortable } from '@dnd-kit/sortable'
import { localeOf } from '../../../i18n/translations'
import { CSS } from '@dnd-kit/utilities'
import {
Calendar, CheckSquare,
ChevronLeft, ChevronRight,
Image,
Link2
} from 'lucide-react'
import { memo, useContext } from 'react'
import { UserAvatar } from '../../../components/UserAvatar'
import { useLanguage } from '../../../i18n/LanguageContext'
import { cardKeyDown } from '../../../lib/dndAccessibility'
import type { ProjectCard } from '../../../types'
import { QueueBadgeContext, todayStr } from '../projectsShared'
import { PriorityBadge, QueueBadgePill } from '../ui'

// ─── Card presentational ────────────────────────────────────────────────────

// PERF-011: memo; com props iguais (o mesmo objeto de card), o card não redesenha
// quando o painel ou outra coluna muda.
export const CardView = memo(function CardView({ card, priorityLabel, dragging }: { card: ProjectCard; priorityLabel: string; dragging?: boolean }) {
  const { t, lang } = useLanguage()
  const due = card.due_date ? new Date(card.due_date + 'T00:00:00') : null
  const overdue = due && !card.completed && due.getTime() < new Date(todayStr() + 'T00:00:00').getTime()
  const isToday = due && card.due_date === todayStr()
  const dueColor = overdue ? '#ef4444' : isToday ? '#f59e0b' : 'var(--color-text-muted)'
  const checklist = card.checklist ?? []
  const checklistDone = checklist.filter(i => i.completed).length
  const checklistTotal = checklist.length
  const attachmentCount = card.attachments?.length ?? 0
  const queueBadge = useContext(QueueBadgeContext).get(card.id)
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10,
        padding: '10px 12px', cursor: 'pointer', boxShadow: dragging ? '0 8px 24px rgba(0,0,0,0.25)' : '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column', gap: 8, opacity: card.completed ? 0.65 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.35, textDecoration: card.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>{card.title || t('projects_new_card')}</span>
        {queueBadge && <QueueBadgePill badge={queueBadge} />}
      </div>
      {(card.labels?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {card.labels.map((l, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', backgroundColor: 'var(--color-hover)', padding: '1px 6px', borderRadius: 4 }}>{l}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <PriorityBadge priority={card.priority} label={priorityLabel} />
        {due && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: dueColor }}>
            <Calendar size={11} />
            {overdue ? t('projects_due_overdue') : isToday ? t('projects_due_today') : due.toLocaleDateString(localeOf(lang))}
          </span>
        )}
        {checklistTotal > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: checklistDone === checklistTotal ? '#22c55e' : 'var(--color-text-muted)' }}>
            <CheckSquare size={11} />
            {t('projects_checklist_progress').replace('{done}', String(checklistDone)).replace('{total}', String(checklistTotal))}
          </span>
        )}
        {attachmentCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            <Image size={11} />
            {attachmentCount}
          </span>
        )}
        {card.linked_page_id && <Link2 size={12} style={{ color: 'var(--color-accent)' }} />}
        {card.assignee_profile && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <UserAvatar
              name={card.assignee_profile.display_name || card.assignee_profile.email}
              seed={card.assignee_profile.email}
              emoji={card.assignee_profile.avatar_emoji}
              color={card.assignee_profile.avatar_color}
              url={card.assignee_profile.avatar_url}
              size={20}
              title={card.assignee_profile.display_name || card.assignee_profile.email}
            />
          </span>
        )}
      </div>
    </div>
  )
})

// ─── Sortable card ────────────────────────────────────────────────────────────

// PERF-011: os handlers recebem o card (ou o id) em vez de serem lambdas criados
// por card a cada render, então o memo segura os cards que não mudaram.
export const SortableCard = memo(function SortableCard({
  card, priorityLabel, canEdit, onOpen, variant = 'board', showMovePrev, showMoveNext, onMovePrev, onMoveNext,
}: {
  card: ProjectCard; priorityLabel: string; canEdit: boolean; onOpen: (card: ProjectCard) => void;
  variant?: 'board' | 'compact'; showMovePrev?: boolean; showMoveNext?: boolean;
  onMovePrev?: (cardId: string) => void; onMoveNext?: (cardId: string) => void;
}) {
  const onClick = () => onOpen(card)
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled: !canEdit })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1,
  }
  const moveBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
    borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)',
    cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, flexShrink: 0,
  }
  return (
    // O wrapper já é role=button/tabIndex=0 (attributes do useSortable): Enter
    // abre o card; Espaço (KeyboardSensor) pega para mover.
    <div
      ref={setNodeRef}
      style={{ ...style, touchAction: 'manipulation' }}
      {...attributes}
      {...(canEdit ? listeners : {})}
      onClick={onClick}
      onKeyDown={cardKeyDown(canEdit ? listeners?.onKeyDown : undefined, onClick, isDragging)}
    >
      {variant === 'compact' && canEdit && (showMovePrev || showMoveNext) && (
        <div
          style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {showMovePrev ? (
            <button type="button" title={t('projects_compact_move_prev')} onClick={() => onMovePrev?.(card.id)} style={moveBtnStyle}>
              <ChevronLeft size={14} />
            </button>
          ) : <span style={{ width: 28 }} />}
          {showMoveNext ? (
            <button type="button" title={t('projects_compact_move_next')} onClick={() => onMoveNext?.(card.id)} style={moveBtnStyle}>
              <ChevronRight size={14} />
            </button>
          ) : <span style={{ width: 28 }} />}
        </div>
      )}
      <CardView card={card} priorityLabel={priorityLabel} />
    </div>
  )
})

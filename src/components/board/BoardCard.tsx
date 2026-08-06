import type React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLanguage } from '../../i18n/LanguageContext'

// Card do board: casca arrastável + botões ‹ › + o conteúdo que o chamador
// desenha. O board não sabe nada sobre o que está dentro.

const moveBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26,
  borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)',
  cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, flexShrink: 0,
}

export function BoardCardShell({
  id, draggable, children, onClick, onMovePrev, onMoveNext, busy = false,
}: {
  id: string
  /** false no mobile e em board read-only: o card vira estático. */
  draggable: boolean
  children: React.ReactNode
  onClick?: () => void
  /** null esconde o botão (ponta da trilha). */
  onMovePrev?: (() => void) | null
  onMoveNext?: (() => void) | null
  busy?: boolean
}) {
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  })

  const hasMoves = !!onMovePrev || !!onMoveNext

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : busy ? 0.55 : 1,
        touchAction: 'manipulation',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: onClick ? 'pointer' : draggable ? 'grab' : 'default',
      }}
      {...attributes}
      {...(draggable ? listeners : {})}
      onClick={onClick}
    >
      {children}
      {hasMoves && (
        // stopPropagation no pointerdown: sem isso o dnd-kit engole o clique e
        // o botão nunca dispara no meio de um card arrastável.
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {onMovePrev ? (
            <button type="button" title={t('board_move_prev')} disabled={busy}
              onClick={onMovePrev} style={moveBtnStyle}>
              <ChevronLeft size={14} />
            </button>
          ) : <span style={{ width: 26 }} />}
          {onMoveNext ? (
            <button type="button" title={t('board_move_next')} disabled={busy}
              onClick={onMoveNext} style={moveBtnStyle}>
              <ChevronRight size={14} />
            </button>
          ) : <span style={{ width: 26 }} />}
        </div>
      )}
    </div>
  )
}

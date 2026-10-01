// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import type { CollisionDetection } from '@dnd-kit/core'
import {
pointerWithin, rectIntersection
} from '@dnd-kit/core'
import { createContext } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { type QueueBadge } from '../../lib/cardQueue'
import { type BoardMember } from './boardLoader'
import { type ViewMode } from './ProjectsNav'


export const VALID_VIEWS: ViewMode[] = ['kanban', 'compact', 'list', 'overview', 'timeline']

// ─── Constants & helpers ──────────────────────────────────────────────────────

// QA-004: cores e ordem das prioridades vivem em src/lib/priorities.ts.
export { PROJECT_PRIORITY_COLORS as PRIORITY_COLORS } from '../../lib/priorities'
export const BOARD_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6']
export const BOARD_ICONS = ['📋', '🚀', '🎯', '💡', '🛠️', '📦', '🎨', '🧩', '📈', '🏗️', '🔥', '⭐']
export const ACTIVE_BOARD_KEY = 'projects_active_board'
export const VIEW_KEY = 'projects_view'
export const COMPACT_COLUMN_KEY = 'projects_compact_column:'
export const CARD_DRAFT_PREFIX = 'projects_card_draft:'
export const CARD_MODAL_STATE_KEY = 'projects_card_modal_state'
// Set by the dashboard (quick-note chips / due-soon list) to deep-open a card.
export const OPEN_CARD_KEY = 'projects_open_card'
export const AUTOSAVE_DEBOUNCE_MS = 800

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// QA-004: o flatten da árvore vive em src/lib/pageTree.ts.
export { flattenPages } from '../../lib/pageTree'

// ─── Shared styles ──────────────────────────────────────────────────────────

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6,
  fontSize: 14, backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box',
}
export const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--color-text-subtle)', marginBottom: 4, display: 'block',
}
export const cardLinkStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
  fontSize: 13, fontWeight: 500, textDecoration: 'none', overflow: 'hidden',
}

export type Member = BoardMember

// Selo da fila de desenvolvimento por card. Via contexto para não atravessar
// Column → SortableCard → CardView com mais uma prop.
export const QueueBadgeContext = createContext<Map<string, QueueBadge>>(new Map())

// Fase do fluxo Avaliação → Plano → Desenvolvimento → Validação. "plano",
// "review" (validar) e "waiting" (aguardando você) esperam o usuário.
export function queueBadgeLabel(t: ReturnType<typeof useLanguage>['t'], badge: QueueBadge): string {
  if (badge.kind === 'queued') return t('projects_queue_badge_queued').replace('{rank}', String(badge.rank))
  if (badge.kind === 'review') return t('projects_queue_badge_review')
  if (badge.kind === 'waiting') return t('projects_queue_badge_waiting')
  return badge.phase ? t(`projects_queue_phase_${badge.phase}`) : t('projects_queue_badge_working')
}

export const collisionDetection: CollisionDetection = (args) => {
  // When dragging a column, only collide with other columns so the drop always
  // resolves to a column (never a card under the pointer) and the horizontal
  // sortable preview animates. Card drags keep the full set of droppables.
  const isColumnDrag = args.active?.data?.current?.type === 'column'
  const scoped = isColumnDrag
    ? { ...args, droppableContainers: args.droppableContainers.filter(c => c.data.current?.type === 'column') }
    : args
  const pointerCollisions = pointerWithin(scoped)
  if (pointerCollisions.length > 0) return pointerCollisions
  return rectIntersection(scoped)
}

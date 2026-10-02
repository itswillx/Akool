// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
Bot,
CheckCheck,
ListOrdered,
UserRound,
X
} from 'lucide-react'
import { Backdrop } from '../../components/Backdrop'
import { useDialog } from '../../hooks/useDialog'
import { useLanguage } from '../../i18n/LanguageContext'
import { type QueueBadge } from '../../lib/cardQueue'
import type { ProjectCardPriority } from '../../types'
import { PRIORITY_COLORS, queueBadgeLabel } from './projectsShared'

// ─── Modal wrapper ────────────────────────────────────────────────────────────

export function Modal({
  title, onClose, children, width = 460, maxHeight = '90vh', closeOnBackdrop = true, isMobile = false,
}: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number; maxHeight?: string;
  closeOnBackdrop?: boolean; isMobile?: boolean;
}) {
  const { t } = useLanguage()
  // Esc segue a regra do fundo (UX-003): o modal do card (closeOnBackdrop=false)
  // guarda formulário e não fecha por Esc; o Tab fica preso em todos.
  const { titleId, dialogProps } = useDialog({ onClose, closeOnEsc: closeOnBackdrop })
  const handleBackdropClick = closeOnBackdrop ? onClose : undefined
  const mobileMaxHeight = maxHeight === '90vh' ? '95vh' : maxHeight

  if (isMobile) {
    return (
      <Backdrop align="bottom" className="finance-sheet-overlay" onClick={handleBackdropClick}>
        <div
          {...dialogProps}
          className="finance-sheet-panel finance-safe-bottom"
          onClick={e => e.stopPropagation()}
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '8px 20px 24px', maxHeight: mobileMaxHeight, overflowY: 'auto', boxShadow: '0 -8px 32px rgba(0,0,0,0.3)', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 12px' }}>
            <div style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: 'var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'var(--color-bg)', paddingBottom: 4 }}>
            <h3 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button type="button" aria-label={t('dialog_close')} onClick={onClose} style={{ border: 'none', background: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, width: 36, height: 36, flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </Backdrop>
    )
  }

  return (
    <Backdrop className="finance-sheet-overlay" padding={16} onClick={handleBackdropClick}>
      <div
        {...dialogProps}
        className="finance-modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width, maxWidth: '95vw', maxHeight, overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button type="button" aria-label={t('dialog_close')} onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', borderRadius: 6, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </Backdrop>
  )
}

// REL-006: falha ao carregar quadro(s), no lugar do quadro vazio que parecia
// "os cards sumiram".
export function LoadError({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 360 }}>{message}</p>
      <PrimaryBtn onClick={onRetry}>{retryLabel}</PrimaryBtn>
    </div>
  )
}

export function PrimaryBtn({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  )
}

export function GhostBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
      {children}
    </button>
  )
}

// ─── Priority badge ───────────────────────────────────────────────────────────

export function PriorityBadge({ priority, label }: { priority: ProjectCardPriority; label: string }) {
  const c = PRIORITY_COLORS[priority]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: c, backgroundColor: `${c}1f`, padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {label}
    </span>
  )
}

export function QueueBadgePill({ badge }: { badge: QueueBadge }) {
  const { t } = useLanguage()
  const c = badge.kind === 'queued' ? 'var(--color-accent)'
    : badge.kind === 'review' ? '#0891b2'
    : badge.kind === 'waiting' ? '#dc2626'
    : badge.phase === 'plano' || badge.phase === 'aprovado' ? '#8b5cf6' : '#f59e0b'
  const Icon = badge.kind === 'queued' ? ListOrdered : badge.kind === 'review' ? CheckCheck : badge.kind === 'waiting' ? UserRound : Bot
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: c, backgroundColor: `${c}1f`, padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>
      <Icon size={10} />
      {queueBadgeLabel(t, badge)}
    </span>
  )
}

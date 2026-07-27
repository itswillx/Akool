import { X } from 'lucide-react'
import { useFinanceMobile } from './mobileContext'

// Bottom-sheet on mobile, centered dialog on desktop. Relies on
// FinanceMobileContext, so it must render inside FinancePanel's provider.
//
// Clicking the backdrop does NOT dismiss by default: almost every modal here is
// a data-entry form, and losing a filled-in form to a stray click is the worst
// possible outcome. The header X and each form's Cancel button are the way out.
// Menus and other throwaway sheets can opt back in with `dismissOnBackdrop`.
export function Modal({ title, onClose, children, dismissOnBackdrop = false }: {
  title: string
  onClose: () => void
  children: React.ReactNode
  dismissOnBackdrop?: boolean
}) {
  const isMobile = useFinanceMobile()
  const handleBackdrop = dismissOnBackdrop ? onClose : undefined

  if (isMobile) {
    return (
      <div
        className="finance-sheet-overlay"
        onClick={handleBackdrop}
        style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <div
          className="finance-sheet-panel finance-safe-bottom"
          onClick={e => e.stopPropagation()}
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '8px 18px 20px', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -8px 32px rgba(0,0,0,0.3)', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}
        >
          {/* Drag handle */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 12px' }}>
            <div style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: 'var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, position: 'sticky', top: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, width: 36, height: 36, flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className="finance-sheet-overlay"
      onClick={handleBackdrop}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="finance-modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width: 420, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

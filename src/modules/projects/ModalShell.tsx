import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useDialog } from '../../hooks/useDialog'
import { useLanguage } from '../../i18n/LanguageContext'

// Casca dos modais do módulo (importar cards, fila): bottom sheet no mobile,
// diálogo centralizado no desktop. O Esc fecha (UX-003); o clique no fundo
// também, a menos que dismissOnBackdrop=false (ex.: import com texto colado,
// UX-009 — um clique fora perdia o que foi colado).
export default function ModalShell({
  title, onClose, children, isMobile, dismissOnBackdrop = true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  isMobile?: boolean
  dismissOnBackdrop?: boolean
}) {
  const { t } = useLanguage()
  const { titleId, dialogProps } = useDialog({ onClose, closeOnEsc: true })
  if (isMobile) {
    return (
      <div role="presentation"
        onClick={dismissOnBackdrop ? onClose : undefined}
        style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <div
          {...dialogProps}
          onClick={e => e.stopPropagation()}
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '16px 20px 24px', maxHeight: '95vh', overflowY: 'auto' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button type="button" aria-label={t('dialog_close')} onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div role="presentation"
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 16 }}
    >
      <div
        {...dialogProps}
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button type="button" aria-label={t('dialog_close')} onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

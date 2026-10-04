import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, X } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import type { ToastItem, ToastVariant } from '../contexts/ToastContext'

const ICONS: Record<ToastVariant, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Bell,
}

const COLOR_VARS: Record<ToastVariant, string> = {
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  success: 'var(--color-success)',
  info: 'var(--color-accent)',
}

// Rendered inside ToastProvider via portal so it always sits at the end of
// the DOM — above modals regardless of where in the tree the provider mounts.
// NOTIF-001: o contêiner fica sempre montado como região viva (polite): o
// leitor de tela só anuncia o que entra numa região que já existia. Erro
// interrompe (role=alert); o resto é anunciado na vez dele. O tempo do aviso
// para com o mouse ou o foco nele.
export function ToastStack({ toasts, onDismiss, onPause, onResume }: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
  onPause?: (id: string) => void
  onResume?: (id: string) => void
}) {
  const { t } = useLanguage()

  return createPortal(
    <div
      aria-live="polite"
      style={{
        position: 'fixed', top: 12, right: 12, zIndex: 1200,
        display: 'flex', flexDirection: 'column', gap: 8,
        maxWidth: 'min(92vw, 380px)', pointerEvents: 'none',
      }}
    >
      {toasts.map(toast => {
        const Icon = ICONS[toast.variant]
        return (
          <div
            key={toast.id}
            role={toast.variant === 'error' ? 'alert' : undefined}
            onMouseEnter={() => onPause?.(toast.id)}
            onMouseLeave={() => onResume?.(toast.id)}
            onFocus={() => onPause?.(toast.id)}
            onBlur={() => onResume?.(toast.id)}
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'flex-start', gap: 10,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderLeft: `3px solid ${COLOR_VARS[toast.variant]}`,
              borderRadius: 10, padding: '10px 12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              animation: 'toast-in 160ms ease-out',
            }}
          >
            <Icon size={18} color={COLOR_VARS[toast.variant]} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ flex: 1, fontSize: 13.5, color: 'var(--color-text)', lineHeight: 1.4 }}>
              {toast.message}
            </span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick()
                  onDismiss(toast.id)
                }}
                style={{ flexShrink: 0, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text)', borderRadius: 7, padding: '3px 10px', fontSize: 12.5, fontWeight: 600 }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => onDismiss(toast.id)}
              aria-label={t('toast_dismiss')}
              style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 2, display: 'flex' }}
            >
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

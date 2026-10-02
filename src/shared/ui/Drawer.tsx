import { X } from 'lucide-react'
import { Backdrop } from '@/shared/ui/Backdrop'
import { useDialog } from '@/shared/hooks/useDialog'
import { useLanguage } from '@/i18n/LanguageContext'

// Right-side drawer used on desktop for create/edit flows that are too tall for
// a centered modal (transaction, quote comparison).
//
// Like Modal, the backdrop does not dismiss: this only ever wraps forms, and a
// stray click outside would throw away whatever was typed. Close with the
// header X or the footer's Cancel. Esc follows the same rule (UX-003); Tab
// stays trapped inside.
export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const { t } = useLanguage()
  const { titleId, dialogProps } = useDialog({ onClose, closeOnEsc: false })
  return (
    <Backdrop align="right" className="finance-drawer-overlay" color="rgba(16,20,24,0.4)">
      <div
        {...dialogProps}
        className="finance-drawer-panel"
        style={{ width: 430, maxWidth: '100%', height: '100%', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', boxShadow: '-14px 0 44px rgba(0,0,0,0.22)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div id={titleId} style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{title}</div>
          <button type="button" aria-label={t('dialog_close')} onClick={onClose} style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 7, color: 'var(--color-text-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>{footer}</div>
        )}
      </div>
    </Backdrop>
  )
}

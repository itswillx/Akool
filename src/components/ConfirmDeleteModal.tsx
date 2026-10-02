import { useRef, useId } from 'react'
import { Backdrop } from './Backdrop'
import { useLanguage } from '../i18n/LanguageContext'
import { useDialog } from '../hooks/useDialog'

interface Props {
  open: boolean
  pageTitle?: string
  title?: string
  message?: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

// Sem atalho global de Enter (UX-001): Enter aciona só o botão focado, e o foco
// abre em Cancelar. Confirmar uma ação destrutiva exige Tab até o botão ou clique.
// Esc, Tab preso e foco devolvido vêm do useDialog (UX-003); dentro de outro
// modal, o Esc fecha só esta confirmação.
export default function ConfirmDeleteModal({ open, pageTitle, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useLanguage()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const messageId = useId()
  const { titleId, dialogProps } = useDialog({
    open, onClose: onCancel, closeOnEsc: true, initialFocusRef: cancelRef, role: 'alertdialog',
  })

  if (!open) return null

  return (
    <Backdrop color="rgba(0,0,0,0.4)" onClick={onCancel}>
      <div
        {...dialogProps}
        aria-describedby={messageId}
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.28)', padding: '28px 28px 24px', width: 'min(94vw, 400px)', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
          {title || t('confirm_delete_title')}
        </h2>
        <p id={messageId} style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {message || t('confirm_delete_message', { title: pageTitle || t('page_header_untitled') })}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            {t('confirm_delete_cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
          >
            {confirmLabel || t('confirm_delete_confirm')}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}

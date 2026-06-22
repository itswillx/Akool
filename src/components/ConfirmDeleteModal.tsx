import { useRef, useEffect } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

interface Props {
  open: boolean
  pageTitle?: string
  title?: string
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDeleteModal({ open, pageTitle, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useLanguage()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.28)', padding: '28px 28px 24px', width: 'min(94vw, 400px)', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
          {title || t('confirm_delete_title')}
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {message || t('confirm_delete_message', { title: pageTitle || t('page_header_untitled') })}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            {t('confirm_delete_cancel')}
          </button>
          <button
            onClick={onConfirm}
            style={{ flex: 1, padding: '9px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
          >
            {confirmLabel || t('confirm_delete_confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

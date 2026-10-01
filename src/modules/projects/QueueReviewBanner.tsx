import { useId, useState } from 'react'
import { CheckCheck, RotateCcw } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'

// Fila (fluxo v2): o card em Validação espera o usuário. Aprovar conclui (o
// mesmo que arrastar o card para Concluído); reprovar pede o motivo e devolve
// o card ao topo da fila. Quem fecha o modal depois do sucesso é o pai.
export default function QueueReviewBanner({ onApprove, onReject }: {
  onApprove: () => Promise<boolean>
  onReject: (reason: string) => Promise<boolean>
}) {
  const { t } = useLanguage()
  const reasonId = useId()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    await fn()
    setBusy(false)
  }

  const btn = (primary: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
    cursor: busy ? 'default' : 'pointer',
    border: primary ? 'none' : '1px solid var(--color-border)',
    background: primary ? '#16a34a' : 'var(--color-bg)',
    color: primary ? '#fff' : 'var(--color-text)',
  })

  return (
    <section aria-label={t('projects_queue_review_title')}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8, border: '1px solid #06b6d466', backgroundColor: '#06b6d414' }}>
      <strong style={{ fontSize: 13, color: 'var(--color-text)' }}>{t('projects_queue_review_title')}</strong>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('projects_queue_review_hint')}</p>
      {rejecting ? (
        <>
          <label htmlFor={reasonId} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{t('projects_queue_reject_reason')}</label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={busy} onClick={() => { setRejecting(false); setReason('') }} style={btn(false)}>
              {t('projects_cancel')}
            </button>
            <button type="button" disabled={busy || !reason.trim()} onClick={() => { void run(() => onReject(reason.trim())) }}
              style={{ ...btn(false), color: '#dc2626', opacity: reason.trim() ? 1 : 0.6 }}>
              <RotateCcw size={14} />{t('projects_queue_reject_confirm')}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => { void run(onApprove) }} style={btn(true)}>
            <CheckCheck size={14} />{t('projects_queue_approve')}
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} style={btn(false)}>
            <RotateCcw size={14} />{t('projects_queue_reject')}
          </button>
        </div>
      )}
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { ghostBtnStyle, primaryBtnStyle } from '@/shared/ui/uiTokens'
import { authErrorKey } from '../../lib/authErrors'
import type { AuthErrorLike } from '../../lib/authErrors'
import type { TranslationKey } from '../../i18n/translations'
import { AuthLink } from './AuthTopBar'
import { FormNotice } from './FormNotice'
import type { Translate } from './authView'

// Depois do cadastro ou do pedido de redefinição: o formulário sai de cena, a
// pessoa vê para onde o e-mail foi, pode reenviar (com a espera de 60 s que o
// Supabase impõe por e-mail) e voltar ao login. O foco vai ao título.
const COOLDOWN_MS = 60_000

interface Notice { tone: 'success' | 'error'; key?: TranslationKey; text?: string }

export function ConfirmationPanel({ kind, email, t, onResend, onBack }: {
  kind: 'signup' | 'reset'
  email: string
  t: Translate
  onResend: () => Promise<{ error: AuthErrorLike | string | null }>
  onBack: () => void
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [cooldownUntil, setCooldownUntil] = useState(() => Date.now() + COOLDOWN_MS)
  const [now, setNow] = useState(() => Date.now())
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const counting = remaining > 0
  useEffect(() => {
    if (!counting) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [counting])

  const blocked = sending || remaining > 0
  const resend = async () => {
    if (blocked) return
    setSending(true)
    try {
      const { error } = await onResend()
      if (error) {
        setNotice({ tone: 'error', key: authErrorKey(error) ?? undefined, text: typeof error === 'string' ? error : error.message })
      } else {
        setNotice({ tone: 'success', key: 'auth_resend_sent' })
        setCooldownUntil(Date.now() + COOLDOWN_MS)
        setNow(Date.now())
      }
    } finally {
      setSending(false)
    }
  }

  const label = sending ? t('auth_sending') : remaining > 0 ? t('auth_resend_wait', { seconds: remaining }) : t('auth_resend')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span aria-hidden="true" className="auth-pop" style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-success-text)', backgroundColor: 'color-mix(in srgb, var(--color-success) 16%, var(--color-bg))' }}>
        <CircleCheck size={22} />
      </span>
      <div>
        <h1 ref={titleRef} tabIndex={-1} style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
          {t(kind === 'signup' ? 'auth_signup_done_title' : 'auth_reset_done_title')}
        </h1>
        <p role="status" style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-text-muted)', margin: 0 }}>
          {t(kind === 'signup' ? 'auth_signup_done_text' : 'auth_reset_done_text', { email })}
        </p>
      </div>
      {notice && (
        <FormNotice tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.key ? t(notice.key) : notice.text}
        </FormNotice>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => { void resend() }}
          aria-disabled={blocked}
          style={{ ...primaryBtnStyle, fontSize: 14, padding: '10px 16px', opacity: blocked ? 0.6 : 1, cursor: blocked ? 'default' : 'pointer' }}
        >
          {label}
        </button>
        <AuthLink view="signin" onNavigate={onBack} style={{ ...ghostBtnStyle, fontSize: 14, padding: '10px 16px', color: 'var(--color-text)' }}>
          {t('auth_back_to_login')}
        </AuthLink>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { MfaPasskeyOption } from '../components/MfaPasskeyOption'
import { isTotpCode } from '../lib/mfa'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { Field } from '@/shared/ui/Field'
import { ghostBtnStyle } from '@/shared/ui/uiTokens'
import { AuthCardLayout, AuthShell } from './auth/AuthShell'
import { FormNotice } from './auth/FormNotice'
import { useAuthLang } from './auth/useAuthLang'

// SEC-004: segunda etapa do login para quem ativou MFA. A sessão existe (senha
// ok, AAL1), mas o app só abre depois do código TOTP subir a sessão para AAL2.
// Mesmo shell da tela de login; o idioma vem da mesma chave de localStorage
// que o AuthPage grava (o perfil ainda não carregou).
const LABEL_STYLE = { display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 } as const

export default function MfaChallengePage() {
  const { user, verifyMfa, signOut, recoveryMode, cancelPasswordReset } = useAuth()
  const isMobile = useIsMobile()
  const { lang, uiLang, t, changeLang } = useAuthLang()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [serverError, setServerError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Foco no campo do código ao abrir (por ref: autoFocus é vetado pelo jsx-a11y).
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setServerError('')
    if (!isTotpCode(code)) {
      setFieldError(t('mfa_invalid_code'))
      inputRef.current?.focus()
      return
    }
    setFieldError('')
    setLoading(true)
    try {
      const { error } = await verifyMfa(code)
      if (error === 'invalid_code') {
        setFieldError(t('mfa_invalid_code'))
        inputRef.current?.focus()
      } else if (error) {
        setServerError(t('mfa_error', { message: error }))
      }
    } finally {
      setLoading(false)
    }
  }

  // Vindo do link de recuperação, sair também desfaz a recuperação (senão a
  // tela da senha nova voltaria sem sessão).
  const leave = () => { void (recoveryMode ? cancelPasswordReset() : signOut()) }
  const action = (
    <button type="button" onClick={leave} style={{ ...ghostBtnStyle, color: 'var(--color-text)', fontSize: isMobile ? 12.5 : 13.5, padding: isMobile ? '6px 9px' : '8px 14px' }}>
      {t('mfa_signout')}
    </button>
  )

  return (
    <AuthShell view="signin" lang={lang} t={t} isMobile={isMobile} onNavigate={leave} onChangeLang={changeLang} title={t('mfa_challenge_title')} focus="none" action={action}>
      <AuthCardLayout lang={uiLang} t={t} isMobile={isMobile} context="mfa">
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>{t('mfa_challenge_title')}</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 6px', lineHeight: 1.5 }}>{t('mfa_challenge_desc')}</p>
        {user?.email && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 20px' }}>{user.email}</p>}

        <form onSubmit={handleSubmit} noValidate aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Field label={t('mfa_code_label')} labelStyle={LABEL_STYLE} error={fieldError || null}>{control => (
              <input
                {...control}
                ref={inputRef}
                className="auth-input keep-font-size"
                name="totp"
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setFieldError('') }}
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="go"
                readOnly={loading}
                placeholder="000000"
                style={{ padding: '11px 12px', fontSize: 22, letterSpacing: '0.4em', textAlign: 'center', fontFamily: 'monospace' }}
              />
            )}</Field>
          </div>

          {serverError && <FormNotice tone="error" role="alert">{serverError}</FormNotice>}

          <button
            type="submit"
            aria-disabled={loading}
            className="auth-submit"
            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: loading ? 'progress' : 'pointer', opacity: loading ? 0.85 : 1 }}
          >
            {loading && <span className="auth-spinner" aria-hidden="true" />}
            {loading ? t('mfa_verifying') : t('mfa_verify')}
          </button>
          <MfaPasskeyOption t={t} />
        </form>
      </AuthCardLayout>
    </AuthShell>
  )
}

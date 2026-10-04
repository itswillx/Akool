import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { PasswordInput } from '../components/PasswordFields'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { Field } from '@/shared/ui/Field'
import { ghostBtnStyle } from '@/shared/ui/uiTokens'
import { isPasswordValid } from '../lib/passwordPolicy'
import { AuthCardLayout, AuthShell } from './auth/AuthShell'
import { FormNotice } from './auth/FormNotice'
import { PasswordChecklist } from './auth/PasswordChecklist'
import { useAuthLang } from './auth/useAuthLang'

// Shown when the app is opened from a password-recovery email link
// (recoveryMode in AuthContext). Same shell as the sign-in screen; the
// language comes from the same localStorage key AuthPage writes (the profile
// is not loaded yet).
const LABEL_STYLE = { display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 } as const

interface Errors { newPwd?: string; confirm?: string; form?: string }

export default function ResetPasswordPage() {
  const { user, completePasswordReset, cancelPasswordReset } = useAuth()
  const isMobile = useIsMobile()
  const { lang, uiLang, t, changeLang } = useAuthLang()
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const newRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    if (!isPasswordValid(newPwd)) {
      setErrors({ newPwd: t('settings_pwd_short') })
      newRef.current?.focus()
      return
    }
    if (newPwd !== confirmPwd) {
      setErrors({ confirm: t('settings_pwd_mismatch') })
      confirmRef.current?.focus()
      return
    }
    setErrors({})
    setLoading(true)
    try {
      const { error } = await completePasswordReset(newPwd)
      if (error === 'same_password') setErrors({ newPwd: t('settings_pwd_same') })
      else if (error === 'weak_password') setErrors({ newPwd: t('auth_password_weak') })
      else if (error === 'session_missing') setErrors({ form: t('reset_session_missing') })
      else if (error) setErrors({ form: error })
      // On success recoveryMode flips to false and App renders the signed-in area.
    } finally {
      setLoading(false)
    }
  }

  const cancel = () => { void cancelPasswordReset() }
  const action = (
    <button type="button" onClick={cancel} style={{ ...ghostBtnStyle, color: 'var(--color-text)', fontSize: isMobile ? 12.5 : 13.5, padding: isMobile ? '6px 9px' : '8px 14px' }}>
      {t('reset_cancel')}
    </button>
  )

  return (
    <AuthShell view="forgot" lang={lang} t={t} isMobile={isMobile} onNavigate={cancel} onChangeLang={changeLang} title={t('reset_title')} action={action}>
      <AuthCardLayout lang={uiLang} t={t} isMobile={isMobile} context="reset">
        {!user ? (
          // Recovery flag set but no session (expired link, reloaded after
          // sign-out, ...): the only way forward is requesting a new link.
          <>
            <h1 tabIndex={-1} style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>{t('reset_title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 24px' }}>{t('reset_session_missing')}</p>
            <button
              type="button"
              onClick={cancel}
              style={{ width: '100%', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              {t('auth_back_to_login')}
            </button>
          </>
        ) : (
          <>
            <h1 tabIndex={-1} style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>{t('reset_title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 20px' }}>{t('reset_subtitle', { email: user.email ?? '' })}</p>

            <form onSubmit={handleSubmit} noValidate aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <Field label={t('settings_new_password')} labelStyle={LABEL_STYLE} error={errors.newPwd ?? null} hint={<PasswordChecklist password={newPwd} t={t} />}>{control => (
                  <PasswordInput
                    control={control}
                    inputRef={newRef}
                    className="auth-input"
                    name="new_password"
                    autoComplete="new-password"
                    enterKeyHint="next"
                    readOnly={loading}
                    t={t}
                    value={newPwd}
                    onChange={v => { setNewPwd(v); if (errors.newPwd) setErrors({}) }}
                    show={showNew}
                    onToggleShow={() => setShowNew(v => !v)}
                    placeholder={t('settings_password_min')}
                  />
                )}</Field>
              </div>

              <div>
                <Field label={t('settings_confirm_password')} labelStyle={LABEL_STYLE} error={errors.confirm ?? null}>{control => (
                  <PasswordInput
                    control={control}
                    inputRef={confirmRef}
                    className="auth-input"
                    name="confirm_password"
                    autoComplete="new-password"
                    enterKeyHint="go"
                    readOnly={loading}
                    t={t}
                    value={confirmPwd}
                    onChange={v => { setConfirmPwd(v); if (errors.confirm) setErrors({}) }}
                    show={showConfirm}
                    onToggleShow={() => setShowConfirm(v => !v)}
                    placeholder={t('settings_password_repeat')}
                  />
                )}</Field>
              </div>

              {errors.form && <FormNotice tone="error" role="alert">{errors.form}</FormNotice>}

              <button
                type="submit"
                aria-disabled={loading}
                className="auth-submit"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: loading ? 'progress' : 'pointer', opacity: loading ? 0.85 : 1, marginTop: 4 }}
              >
                {loading ? <><span className="auth-spinner" aria-hidden="true" /> {t('reset_saving')}</> : <><Lock size={14} /> {t('reset_submit')}</>}
              </button>
            </form>
          </>
        )}
      </AuthCardLayout>
    </AuthShell>
  )
}

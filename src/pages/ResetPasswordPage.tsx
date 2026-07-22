import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { PasswordInput, PasswordStrengthMeter } from '../components/PasswordFields'
import { getT } from '../i18n/translations'
import type { Lang } from '../i18n/translations'

// Shown when the app is opened from a password-recovery email link
// (recoveryMode in AuthContext). Rendered outside the LanguageProvider,
// so language comes from the same localStorage key AuthPage uses.
export default function ResetPasswordPage() {
  const { user, completePasswordReset, cancelPasswordReset } = useAuth()
  const storedLang = (localStorage.getItem('excalinotion_auth_lang') ?? 'pt-BR') as Lang
  const t = getT(storedLang)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPwd.length < 6) { setError(t('settings_pwd_short')); return }
    if (newPwd !== confirmPwd) { setError(t('settings_pwd_mismatch')); return }
    setLoading(true)
    const { error } = await completePasswordReset(newPwd)
    if (error === 'same_password') setError(t('settings_pwd_same'))
    else if (error === 'weak_password') setError(t('auth_password_weak'))
    else if (error === 'session_missing') setError(t('reset_session_missing'))
    else if (error) setError(error)
    // On success recoveryMode flips to false and App renders the signed-in area.
    setLoading(false)
  }

  const cancelBtn = (
    <button
      type="button"
      onClick={() => { void cancelPasswordReset() }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, textDecoration: 'underline', padding: 0 }}
    >
      {t('reset_cancel')}
    </button>
  )

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-bg-tertiary)', padding: '24px' }}>
      <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.14)', padding: '40px', width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'var(--color-btn-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-btn-primary-text)', fontSize: 18, fontWeight: 700 }}>A</div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Akool</p>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>{t('auth_tagline')}</p>
          </div>
        </div>

        {!user ? (
          // Recovery flag set but no session (expired link, reloaded after
          // sign-out, ...): the only way forward is requesting a new link.
          <>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>{t('reset_title')}</h2>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 24px' }}>{t('reset_session_missing')}</p>
            <button
              type="button"
              onClick={() => { void cancelPasswordReset() }}
              style={{ width: '100%', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              {t('auth_back_to_login')}
            </button>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>{t('reset_title')}</h2>
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 24px' }}>{t('reset_subtitle', { email: user.email ?? '' })}</p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>{t('settings_new_password')}</label>
                <PasswordInput
                  value={newPwd}
                  onChange={setNewPwd}
                  show={showNew}
                  onToggleShow={() => setShowNew(v => !v)}
                  placeholder={t('settings_password_min')}
                />
              </div>

              {newPwd.length > 0 && <PasswordStrengthMeter password={newPwd} t={t} />}

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>{t('settings_confirm_password')}</label>
                <PasswordInput
                  value={confirmPwd}
                  onChange={setConfirmPwd}
                  show={showConfirm}
                  onToggleShow={() => setShowConfirm(v => !v)}
                  placeholder={t('settings_password_repeat')}
                />
              </div>

              {error && <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>}

              <button
                type="submit"
                disabled={loading || !newPwd || !confirmPwd}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', backgroundColor: loading || !newPwd || !confirmPwd ? 'var(--color-btn-disabled)' : 'var(--color-btn-primary)', color: loading || !newPwd || !confirmPwd ? 'var(--color-btn-disabled-text)' : 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: loading || !newPwd || !confirmPwd ? 'not-allowed' : 'pointer', transition: 'background-color 0.15s', marginTop: 4 }}
              >
                {loading ? t('reset_saving') : <><Lock size={14} /> {t('reset_submit')}</>}
              </button>
            </form>

            <p style={{ textAlign: 'center', marginTop: 24, marginBottom: 0 }}>{cancelBtn}</p>
          </>
        )}
      </div>
    </div>
  )
}

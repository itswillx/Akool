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
          <svg width="48" height="36" viewBox="0 0 259 194" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(0,194) scale(0.1,-0.1)" fill="var(--color-text)" stroke="none">
              <path d="M575 1157 c-52 -21 -73 -36 -80 -57 -4 -14 -35 -34 -88 -59 -98 -45 -115 -62 -98 -94 23 -41 81 -77 125 -77 23 0 57 -3 78 -6 31 -6 37 -11 42 -39 7 -37 22 -47 48 -34 9 5 19 5 22 1 20 -33 48 -127 56 -188 5 -41 19 -91 30 -113 22 -43 130 -140 191 -171 43 -22 49 -36 21 -44 -25 -8 -65 -64 -58 -81 14 -36 148 -25 161 14 12 40 52 64 112 67 69 3 396 65 557 104 95 24 142 25 204 5 26 -8 69 -16 97 -18 63 -3 72 -26 25 -68 -26 -24 -30 -32 -20 -44 7 -8 28 -15 46 -15 25 0 32 -4 28 -15 -16 -39 104 -44 129 -5 6 11 22 20 34 20 33 0 28 16 -7 29 -30 10 -30 11 -30 83 0 100 -6 116 -44 126 -29 8 -31 11 -32 59 -3 102 -40 158 -124 188 -67 25 -303 37 -565 29 -213 -6 -236 -4 -314 15 -96 24 -157 56 -186 98 -12 15 -49 78 -84 138 -79 137 -103 158 -185 162 -34 1 -74 -3 -91 -10z"/>
            </g>
          </svg>
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text)', margin: 0 }}>Akool</p>
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

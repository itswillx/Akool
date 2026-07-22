import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, recoveryLinkError } from '../lib/supabase'
import { getT } from '../i18n/translations'
import type { Lang } from '../i18n/translations'

export default function AuthPage({ dailyLoginRequired = false }: { dailyLoginRequired?: boolean }) {
  const { signIn, signUp, sendPasswordReset } = useAuth()
  const storedLang = (localStorage.getItem('excalinotion_auth_lang') ?? 'pt-BR') as Lang
  const t = getT(storedLang)
  // An expired/used recovery link redirects here with an error hash — open
  // straight on the forgot form so the user can request a fresh link.
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(recoveryLinkError ? 'forgot' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    if (mode === 'forgot') {
      const { error } = await sendPasswordReset(email)
      if (error) setError(error)
      else setSuccess(t('auth_forgot_sent'))
    } else if (mode === 'signin') {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
    } else {
      const code = inviteCode.trim().toUpperCase()
      if (!code) {
        setError(t('auth_invite_required'))
        setLoading(false)
        return
      }
      const { data: validation } = await supabase.rpc('validate_invite_code', { p_code: code })
      if (!validation?.valid) {
        setError(t('auth_invite_invalid'))
        setLoading(false)
        return
      }
      const { error } = await signUp(email, password, code)
      if (error) {
        const msg = error.message ?? ''
        if (msg.includes('invite_invalid') || msg.includes('invite_required')) {
          setError(t('auth_invite_invalid'))
        } else if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('senha')) {
          setError(t('auth_password_weak'))
        } else {
          setError(msg)
        }
      } else {
        setSuccess(t('auth_confirm_email'))
      }
    }
    setLoading(false)
  }

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

        {dailyLoginRequired && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⏰</span>
            <span>{t('auth_daily_login_required')}</span>
          </div>
        )}
        {recoveryLinkError && mode === 'forgot' && !success && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, backgroundColor: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠️</span>
            <span>{t('auth_recovery_expired')}</span>
          </div>
        )}
        <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>
          {mode === 'signin' ? t('auth_welcome') : mode === 'signup' ? t('auth_create_account') : t('auth_forgot_title')}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 24px' }}>
          {mode === 'signin' ? t('auth_signin_subtitle') : mode === 'signup' ? t('auth_signup_subtitle') : t('auth_forgot_subtitle')}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>{t('auth_email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 14, outline: 'none', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
              placeholder="you@example.com"
              onFocus={e => (e.target.style.borderColor = 'var(--color-text)')}
              onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
            />
          </div>
          {mode !== 'forgot' && (
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>{t('auth_password')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 14, outline: 'none', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
              placeholder="••••••••"
              onFocus={e => (e.target.style.borderColor = 'var(--color-text)')}
              onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
            />
            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}
                style={{ marginTop: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12.5, textDecoration: 'underline' }}
              >
                {t('auth_forgot_link')}
              </button>
            )}
          </div>
          )}

          {mode === 'signup' && (
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>{t('auth_invite_code')}</label>
              <input
                type="text"
                required
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value.toUpperCase())}
                style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 14, outline: 'none', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', boxSizing: 'border-box', transition: 'border-color 0.15s', fontFamily: 'monospace', letterSpacing: '0.08em' }}
                placeholder={t('auth_invite_placeholder')}
                onFocus={e => (e.target.style.borderColor = 'var(--color-text)')}
                onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
              />
            </div>
          )}

          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>}
          {success && <p style={{ color: '#22c55e', fontSize: 13, margin: 0 }}>{success}</p>}

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', backgroundColor: loading ? 'var(--color-text-muted)' : 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', transition: 'background-color 0.15s', marginTop: 4 }}
          >
            {loading ? t('auth_loading') : mode === 'signin' ? t('auth_signin_btn') : mode === 'forgot' ? t('auth_forgot_btn') : t('auth_signup_btn')}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)', marginTop: 24 }}>
          {mode === 'signin' ? t('auth_no_account') : mode === 'signup' ? t('auth_has_account') : null}
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setSuccess('') }}
            style={{ color: 'var(--color-text)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
          >
            {mode === 'signin' ? t('auth_signup_link') : mode === 'signup' ? t('auth_signin_link') : t('auth_back_to_login')}
          </button>
        </p>
      </div>
    </div>
  )
}

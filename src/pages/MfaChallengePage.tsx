import { useState } from 'react'
import { LOCAL_KEYS } from '../lib/localKeys'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { MfaPasskeyOption } from '../components/MfaPasskeyOption'
import { isTotpCode } from '../lib/mfa'
import { getT, toLang } from '../i18n/translations'

// SEC-004: segunda etapa do login para quem ativou MFA. A sessão existe (senha
// ok, AAL1), mas o app só abre depois do código TOTP subir a sessão para AAL2.
// Fica fora do LanguageProvider, como AuthPage e ResetPasswordPage.
export default function MfaChallengePage() {
  const { user, verifyMfa, signOut } = useAuth()
  const storedLang = toLang(localStorage.getItem(LOCAL_KEYS.authLang))
  const t = getT(storedLang)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isTotpCode(code)) { setError(t('mfa_invalid_code')); return }
    setError('')
    setLoading(true)
    const { error: err } = await verifyMfa(code)
    setLoading(false)
    if (err === 'invalid_code') setError(t('mfa_invalid_code'))
    else if (err) setError(t('mfa_error', { message: err }))
  }

  const ready = isTotpCode(code) && !loading

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-bg-tertiary)', padding: '24px' }}>
      <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.14)', padding: '40px', width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'var(--color-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text)' }}>
            <ShieldCheck size={20} />
          </div>
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text)', margin: 0 }}>Akool</p>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>{t('mfa_challenge_title')}</h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 6px', lineHeight: 1.5 }}>{t('mfa_challenge_desc')}</p>
        {user?.email && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 20px' }}>{user.email}</p>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
            {t('mfa_code_label')}
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className="keep-font-size"
              style={{ width: '100%', padding: '11px 12px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 22, letterSpacing: '0.4em', textAlign: 'center', fontFamily: 'monospace', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', boxSizing: 'border-box' }}
            />
          </label>

          {error && <p role="alert" style={{ color: '#ef4444', fontSize: 13, margin: 0 }}>{error}</p>}

          <button
            type="submit"
            disabled={!ready}
            style={{ width: '100%', backgroundColor: ready ? 'var(--color-btn-primary)' : 'var(--color-btn-disabled)', color: ready ? 'var(--color-btn-primary-text)' : 'var(--color-btn-disabled-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            {loading ? t('mfa_verifying') : t('mfa_verify')}
          </button>
          <MfaPasskeyOption t={t} />
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, marginBottom: 0 }}>
          <button
            type="button"
            onClick={() => { void signOut() }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, textDecoration: 'underline', padding: 0 }}
          >
            {t('mfa_signout')}
          </button>
        </p>
      </div>
    </div>
  )
}

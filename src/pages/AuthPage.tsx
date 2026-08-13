import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, recoveryLinkError } from '../lib/supabase'
import { isRateLimited, rateLimitRetryAfter } from '../lib/rateLimit'
import { getT } from '../i18n/translations'
import type { Lang, TranslationKey } from '../i18n/translations'
import { helpContent } from '../i18n/helpContent'
import type { HelpIcon } from '../i18n/helpContent'
import { HelpGlyph } from '../components/helpIcons'
import { useIsMobile } from '../hooks/useIsMobile'

const HIGHLIGHTS: { icon: HelpIcon; key: TranslationKey }[] = [
  { icon: 'fileText', key: 'auth_highlight_pages' },
  { icon: 'kanban', key: 'auth_highlight_projects' },
  { icon: 'wallet', key: 'auth_highlight_finance' },
  { icon: 'share', key: 'auth_highlight_collab' },
  { icon: 'fileDown', key: 'auth_highlight_export' },
]

// Left-hand marketing panel: an autoplaying carousel of the app's real
// features, reusing the same curated copy as the in-app Welcome Tour
// (src/components/WelcomeTour.tsx, src/i18n/helpContent.ts `tour`) so this
// stays truthful and in sync instead of duplicating marketing copy. Hidden on
// mobile by the caller.
function AuthMarketingPanel({ lang }: { lang: Lang }) {
  const t = getT(lang)
  const steps = helpContent[lang].tour
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || steps.length <= 1) return
    const id = setInterval(() => setIndex(i => (i + 1) % steps.length), 6000)
    return () => clearInterval(id)
  }, [paused, steps.length])

  const step = steps[index]
  const prev = () => setIndex(i => (i - 1 + steps.length) % steps.length)
  const next = () => setIndex(i => (i + 1) % steps.length)

  const arrowBtnStyle: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 999, flexShrink: 0, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)',
  }

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        flex: '1 1 50%', minWidth: 360, maxWidth: 520, padding: '40px 40px 32px',
        display: 'flex', flexDirection: 'column',
        background: `linear-gradient(160deg, ${step.color}22, ${step.color}08)`,
        transition: 'background 0.4s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
        <svg width="48" height="36" viewBox="0 0 259 194" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <g transform="translate(0,194) scale(0.1,-0.1)" fill="var(--color-text)" stroke="none">
            <path d="M575 1157 c-52 -21 -73 -36 -80 -57 -4 -14 -35 -34 -88 -59 -98 -45 -115 -62 -98 -94 23 -41 81 -77 125 -77 23 0 57 -3 78 -6 31 -6 37 -11 42 -39 7 -37 22 -47 48 -34 9 5 19 5 22 1 20 -33 48 -127 56 -188 5 -41 19 -91 30 -113 22 -43 130 -140 191 -171 43 -22 49 -36 21 -44 -25 -8 -65 -64 -58 -81 14 -36 148 -25 161 14 12 40 52 64 112 67 69 3 396 65 557 104 95 24 142 25 204 5 26 -8 69 -16 97 -18 63 -3 72 -26 25 -68 -26 -24 -30 -32 -20 -44 7 -8 28 -15 46 -15 25 0 32 -4 28 -15 -16 -39 104 -44 129 -5 6 11 22 20 34 20 33 0 28 16 -7 29 -30 10 -30 11 -30 83 0 100 -6 116 -44 126 -29 8 -31 11 -32 59 -3 102 -40 158 -124 188 -67 25 -303 37 -565 29 -213 -6 -236 -4 -314 15 -96 24 -157 56 -186 98 -12 15 -49 78 -84 138 -79 137 -103 158 -185 162 -34 1 -74 -3 -91 -10z"/>
          </g>
        </svg>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-text)', margin: 0 }}>Akool</p>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 220 }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: `${step.color}1f`, color: step.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <HelpGlyph name={step.icon} size={28} />
        </div>
        <h2 style={{ margin: '0 0 10px', fontSize: 21, fontWeight: 700, color: 'var(--color-text)' }}>{step.title}</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-muted)', maxWidth: 380 }}>{step.description}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={prev} aria-label={t('auth_carousel_prev')} style={arrowBtnStyle}>
            <ChevronLeft size={15} />
          </button>
          <div style={{ display: 'flex', gap: 7 }}>
            {steps.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={s.title}
                style={{ width: i === index ? 22 : 7, height: 7, borderRadius: 999, border: 'none', padding: 0, cursor: 'pointer', backgroundColor: i === index ? step.color : 'var(--color-border)', transition: 'all 0.25s' }}
              />
            ))}
          </div>
          <button type="button" onClick={next} aria-label={t('auth_carousel_next')} style={arrowBtnStyle}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--color-border)' }}>
        <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {t('auth_marketing_highlights_title')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {HIGHLIGHTS.map(h => (
            <div key={h.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--color-text)' }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                <HelpGlyph name={h.icon} size={14} />
              </span>
              {t(h.key)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AuthPage({ dailyLoginRequired = false }: { dailyLoginRequired?: boolean }) {
  const { signIn, signUp, sendPasswordReset } = useAuth()
  const storedLang = (localStorage.getItem('excalinotion_auth_lang') ?? 'pt-BR') as Lang
  const t = getT(storedLang)
  const isMobile = useIsMobile()
  // An expired/used recovery link redirects here with an error hash — open
  // straight on the forgot form so the user can request a fresh link.
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(recoveryLinkError ? 'forgot' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')

  const switchMode = (m: 'signin' | 'signup' | 'forgot') => {
    setMode(m)
    setError('')
    setSuccess('')
  }

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
      // SEC-012: a RPC agora pode responder 429 (10 códigos inválidos / 10 min
      // por IP). Antes o `error` era descartado, então qualquer falha — rede,
      // 429, 500 — virava "código inválido", e uma rejeição do fetch pulava o
      // `setLoading(false)` lá embaixo e travava o botão em "Carregando...".
      let validation: { valid?: boolean } | null = null
      try {
        const { data, error: rpcError } = await supabase.rpc('validate_invite_code', { p_code: code })
        if (rpcError) {
          if (isRateLimited(rpcError)) {
            const seconds = rateLimitRetryAfter(rpcError) ?? 60
            setError(t('auth_invite_rate_limited', { seconds }))
          } else {
            setError(t('auth_invite_check_failed'))
          }
          setLoading(false)
          return
        }
        validation = data
      } catch {
        setError(t('auth_invite_check_failed'))
        setLoading(false)
        return
      }
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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
    fontSize: 13.5, fontWeight: 600, transition: 'all 0.15s',
    backgroundColor: active ? 'var(--color-surface)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  })

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-bg-tertiary)', padding: isMobile ? 16 : 24, minHeight: '100vh', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', width: '100%', maxWidth: isMobile ? 420 : 880, borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 60px -20px rgba(0,0,0,0.45)', backgroundColor: 'var(--color-surface)' }}>
        {!isMobile && <AuthMarketingPanel lang={storedLang} />}

        <div style={{ flex: '1 1 50%', minWidth: 0, padding: isMobile ? '32px 24px' : '40px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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

          {mode === 'forgot' ? (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 600 }}
            >
              <ArrowLeft size={14} /> {t('auth_back_to_login')}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, backgroundColor: 'var(--color-bg-tertiary)', marginBottom: 24 }}>
              <button type="button" onClick={() => switchMode('signin')} style={tabStyle(mode === 'signin')}>{t('auth_signin_btn')}</button>
              <button type="button" onClick={() => switchMode('signup')} style={tabStyle(mode === 'signup')}>{t('auth_signup_btn')}</button>
            </div>
          )}

          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>
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
                  onClick={() => switchMode('forgot')}
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
        </div>
      </div>
    </div>
  )
}

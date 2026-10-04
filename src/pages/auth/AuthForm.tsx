import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { authErrorKey, isEmailCooldown } from '../../lib/authErrors'
import type { AuthErrorLike } from '../../lib/authErrors'
import { resendSignupEmail } from '../../lib/data/auth'
import { validateInviteCode } from '../../lib/data/invites'
import { INVITE_CODE_MAX_LENGTH, normalizeInviteCode } from '../../lib/inviteCode'
import { isRateLimited, rateLimitRetryAfter } from '../../lib/rateLimit'
import { isJsonObject } from '../../lib/json'
import { isPasswordValid } from '../../lib/passwordPolicy'
import type { TranslationKey } from '../../i18n/translations'
import { Field } from '@/shared/ui/Field'
import { PasswordInput } from '../../components/PasswordFields'
import { AuthLink } from './AuthTopBar'
import { ConfirmationPanel } from './ConfirmationPanel'
import { FormNotice } from './FormNotice'
import { ModeSwitch } from './ModeSwitch'
import { PasswordChecklist } from './PasswordChecklist'
import type { AuthFormView, Translate } from './authView'
import { runAuthTransition } from './viewTransition'

// O formulário de entrar / criar conta / recuperar senha. O modo é controlado
// pelo gate (view ↔ hash); aqui ficam os campos, a validação (própria, sem as
// bolhas do navegador), os erros por campo, o envio e os painéis de sucesso.
// As trocas dentro do cartão (abas, recuperar, sucesso, voltar) passam por
// runAuthTransition('card'): o cartão muda de tamanho em vez de pular, e todo o
// estado da troca entra no mesmo update (senão sairia na imagem antiga).

// Mensagem guardada como chave + variáveis (traduzida na hora, para acompanhar
// o seletor PT/EN); texto cru só para erro do servidor que não conhecemos.
type Msg = { key: TranslationKey; vars?: Record<string, string | number> } | { text: string }
type FieldName = 'email' | 'password' | 'invite'
interface Notice { view: AuthFormView; tone: 'error' | 'success'; msg: Msg }
interface Done { kind: 'signup' | 'reset'; email: string }

const LABEL_STYLE = { display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 } as const
const HINT_STYLE: CSSProperties = { margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'var(--color-text-muted)' }
// Alvos de pelo menos 24 px (WCAG 2.5.8) para os links em forma de botão.
const LINK_BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 24, padding: '4px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, textDecoration: 'underline' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fromError(error: AuthErrorLike | string): Msg {
  const key = authErrorKey(error)
  if (key) return { key }
  return { text: typeof error === 'string' ? error : (error.message ?? '') }
}

export function AuthForm({ view, onSwitch, t, dailyLoginRequired, recoveryExpired, onSignedIn }: {
  view: AuthFormView
  onSwitch: (view: AuthFormView) => void
  t: Translate
  dailyLoginRequired: boolean
  recoveryExpired: boolean
  onSignedIn: () => void
}) {
  const { signIn, signUp, sendPasswordReset } = useAuth()
  const titleId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, Msg>>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const inviteRef = useRef<HTMLInputElement>(null)
  const refs = { email: emailRef, password: passwordRef, invite: inviteRef }
  // A resposta pode chegar depois que a pessoa saiu da tela (Voltar ao início
  // durante o envio): aí não há cartão para a transição de sucesso.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const render = (msg: Msg) => ('text' in msg ? msg.text : t(msg.key, msg.vars))
  const fieldError = (name: FieldName) => {
    const msg = fieldErrors[name]
    return msg ? render(msg) : null
  }
  const setFieldError = (name: FieldName, msg: Msg | null) => {
    setFieldErrors(prev => {
      const next = { ...prev }
      if (msg) next[name] = msg
      else delete next[name]
      return next
    })
  }
  const clearFieldError = (name: FieldName) => { if (fieldErrors[name]) setFieldError(name, null) }
  const focusField = (name: FieldName) => refs[name].current?.focus()
  const failField = (name: FieldName, msg: Msg) => {
    setFieldError(name, msg)
    focusField(name)
  }

  const switchMode = (next: AuthFormView) => {
    if (next === view) return
    runAuthTransition('card', () => {
      setNotice(null)
      setFieldErrors({})
      onSwitch(next)
    })
  }

  // Validação própria (o <form> tem noValidate: as bolhas do navegador saem no
  // idioma do sistema, não no escolhido na barra).
  const validate = (): FieldName | null => {
    const errors: Partial<Record<FieldName, Msg>> = {}
    const mail = email.trim()
    if (!mail) errors.email = { key: 'auth_err_email_required' }
    else if (!EMAIL_RE.test(mail)) errors.email = { key: 'auth_err_email_invalid' }
    if (view !== 'forgot' && !password) errors.password = { key: 'auth_err_password_required' }
    // SEC-004: mesma política da troca e da redefinição de senha.
    else if (view === 'signup' && !isPasswordValid(password)) errors.password = { key: 'auth_password_weak' }
    if (view === 'signup' && !inviteCode) errors.invite = { key: 'auth_invite_required' }
    setFieldErrors(errors)
    return (['email', 'password', 'invite'] as const).find(name => errors[name]) ?? null
  }

  /** Devolve o painel de sucesso quando o cadastro passa; null quando um erro já foi mostrado. */
  const submitSignup = async (mail: string): Promise<Done | null> => {
    const code = normalizeInviteCode(inviteCode)
    // SEC-012: a RPC pode responder 429 (10 códigos inválidos / 10 min por IP);
    // rede, 429 e 500 têm mensagens próprias em vez de virarem "código inválido".
    let check: Awaited<ReturnType<typeof validateInviteCode>>
    try {
      check = await validateInviteCode(code)
    } catch {
      failField('invite', { key: 'auth_invite_check_failed' })
      return null
    }
    if (check.error) {
      if (isRateLimited(check.error)) failField('invite', { key: 'auth_invite_rate_limited', vars: { seconds: rateLimitRetryAfter(check.error) ?? 60 } })
      else failField('invite', { key: 'auth_invite_check_failed' })
      return null
    }
    // A RPC devolve jsonb ({ valid, … }); só `valid: true` libera.
    if (!(isJsonObject(check.data) && check.data.valid === true)) {
      failField('invite', { key: 'auth_invite_invalid' })
      return null
    }
    const { error } = await signUp(mail, password, code)
    if (!error) return { kind: 'signup', email: mail }
    const raw = error.message ?? ''
    if (raw.includes('invite_invalid') || raw.includes('invite_required')) failField('invite', { key: 'auth_invite_invalid' })
    else if ((error as AuthErrorLike).code === 'weak_password' || /password|senha/i.test(raw)) failField('password', { key: 'auth_password_weak' })
    else setNotice({ view, tone: 'error', msg: fromError(error) })
    return null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // aria-disabled em vez de disabled: o foco fica no botão durante o envio.
    if (loading) return
    setNotice(null)
    const invalid = validate()
    if (invalid) {
      focusField(invalid)
      return
    }
    const mail = email.trim()
    setLoading(true)
    let success: Done | null = null
    try {
      if (view === 'forgot') {
        const { error } = await sendPasswordReset(mail)
        // Segundo pedido em menos de 60 s: o Supabase só recusa quando a conta
        // existe. Mesmo painel de "link enviado" (o anterior acabou de sair).
        if (error && !isEmailCooldown(error)) setNotice({ view, tone: 'error', msg: fromError(error) })
        else success = { kind: 'reset', email: mail }
      } else if (view === 'signin') {
        const { error } = await signIn(mail, password)
        if (error) setNotice({ view, tone: 'error', msg: fromError(error) })
        else onSignedIn()
      } else {
        success = await submitSignup(mail)
      }
    } finally {
      // O painel de sucesso entra pela transição do cartão, junto com o fim do carregando.
      const panel = success
      if (panel && mounted.current) {
        runAuthTransition('card', () => {
          setLoading(false)
          setDone(panel)
        })
      } else {
        setLoading(false)
      }
    }
  }

  const trackCapsLock = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'))

  if (done) {
    const resend = done.kind === 'signup' ? () => resendSignupEmail(done.email) : () => sendPasswordReset(done.email)
    return (
      <ConfirmationPanel
        kind={done.kind}
        email={done.email}
        t={t}
        onResend={resend}
        onBack={() => {
          runAuthTransition('card', () => {
            setDone(null)
            setNotice(null)
            setFieldErrors({})
            // O painel só aparece no cadastro e na recuperação: a volta é sempre ao login.
            onSwitch('signin')
          })
        }}
      />
    )
  }

  const title = view === 'signin' ? t('auth_welcome') : view === 'signup' ? t('auth_create_account') : t('auth_forgot_title')
  const subtitle = view === 'signin' ? t('auth_signin_subtitle') : view === 'signup' ? t('auth_signup_subtitle') : t('auth_forgot_subtitle')
  const submitLabel = loading
    ? (view === 'signin' ? t('auth_signing_in') : view === 'signup' ? t('auth_signing_up') : t('auth_sending'))
    : (view === 'signin' ? t('auth_signin_btn') : view === 'forgot' ? t('auth_forgot_btn') : t('auth_signup_btn'))
  const passwordHint = capsLock || view === 'signup'
    ? (
      <>
        {capsLock && <p style={{ ...HINT_STYLE, color: 'var(--color-text)', fontWeight: 600 }}>{t('auth_caps_lock')}</p>}
        {view === 'signup' && <PasswordChecklist password={password} t={t} />}
      </>
    )
    : undefined

  return (
    <>
      {view === 'forgot' ? (
        <button type="button" onClick={() => switchMode('signin')} style={{ ...LINK_BTN, marginBottom: 16, fontWeight: 600, textDecoration: 'none' }}>
          <ArrowLeft size={14} /> {t('auth_back_to_login')}
        </button>
      ) : (
        <ModeSwitch view={view} t={t} onSwitch={switchMode} />
      )}

      {/* tabIndex -1: o shell foca o título na troca de view (leitor de tela anuncia a tela). */}
      <h1 id={titleId} tabIndex={-1} style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>{title}</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 20px' }}>{subtitle}</p>

      {dailyLoginRequired && view === 'signin' && (
        <div style={{ marginBottom: 16 }}>
          <FormNotice tone="info" role="status">{t('auth_daily_login_required')}</FormNotice>
        </div>
      )}
      {recoveryExpired && view === 'forgot' && (
        <div style={{ marginBottom: 16 }}>
          <FormNotice tone="warning" role="status">{t('auth_recovery_expired')}</FormNotice>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate aria-labelledby={titleId} aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Field label={t('auth_email')} labelStyle={LABEL_STYLE} error={fieldError('email')}>{control => (
            <input
              {...control}
              ref={emailRef}
              className="auth-input"
              type="email"
              name="email"
              inputMode="email"
              // UX-007: `username` no login pareia com `current-password` no gerenciador de senhas.
              autoComplete={view === 'signin' ? 'username' : 'email'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={view === 'forgot' ? 'send' : 'next'}
              required
              readOnly={loading}
              value={email}
              onChange={e => { setEmail(e.target.value); clearFieldError('email') }}
              placeholder="you@example.com"
            />
          )}</Field>
        </div>

        {view !== 'forgot' && (
          <div>
            <Field label={t('auth_password')} labelStyle={LABEL_STYLE} error={fieldError('password')} hint={passwordHint}>{control => (
              <PasswordInput
                control={control}
                inputRef={passwordRef}
                className="auth-input"
                name="password"
                t={t}
                // UX-007: o gerenciador de senhas preenche no login e sugere uma senha forte no cadastro.
                autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
                required
                readOnly={loading}
                enterKeyHint={view === 'signup' ? 'next' : 'go'}
                value={password}
                onChange={v => { setPassword(v); clearFieldError('password') }}
                show={showPassword}
                onToggleShow={() => setShowPassword(s => !s)}
                placeholder="••••••••"
                onKeyUp={trackCapsLock}
                onKeyDown={trackCapsLock}
              />
            )}</Field>
            {view === 'signin' && (
              <button type="button" onClick={() => switchMode('forgot')} style={{ ...LINK_BTN, marginTop: 4 }}>
                {t('auth_forgot_link')}
              </button>
            )}
          </div>
        )}

        {view === 'signup' && (
          <div>
            <Field label={t('auth_invite_code')} labelStyle={LABEL_STYLE} error={fieldError('invite')} hint={<p style={HINT_STYLE}>{t('auth_invite_hint')}</p>}>{control => (
              <input
                {...control}
                ref={inviteRef}
                className="auth-input"
                type="text"
                name="invite_code"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                required
                readOnly={loading}
                maxLength={INVITE_CODE_MAX_LENGTH}
                value={inviteCode}
                onChange={e => { setInviteCode(normalizeInviteCode(e.target.value)); clearFieldError('invite') }}
                style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}
                placeholder={t('auth_invite_placeholder')}
              />
            )}</Field>
          </div>
        )}

        {notice && notice.view === view && (
          <FormNotice tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{render(notice.msg)}</FormNotice>
        )}

        <button
          type="submit"
          aria-disabled={loading}
          className="auth-submit"
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, border: 'none', cursor: loading ? 'progress' : 'pointer', opacity: loading ? 0.85 : 1, marginTop: 4 }}
        >
          {loading && <span className="auth-spinner" aria-hidden="true" />}
          {submitLabel}
        </button>
      </form>

      {view !== 'forgot' && (
        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {view === 'signup' ? t('auth_has_account') : t('auth_no_account')}
          <AuthLink
            view={view === 'signup' ? 'signin' : 'signup'}
            onNavigate={() => switchMode(view === 'signup' ? 'signin' : 'signup')}
            // --color-text sublinhado: o azul de --color-primary dá 3,7:1 no cartão claro.
            style={{ color: 'var(--color-text)', fontWeight: 600, textDecoration: 'underline' }}
          >
            {view === 'signup' ? t('auth_signin_link') : t('auth_signup_link')}
          </AuthLink>
        </p>
      )}
    </>
  )
}

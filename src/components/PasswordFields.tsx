import { Eye, EyeOff } from 'lucide-react'
import type { CSSProperties, KeyboardEvent, Ref } from 'react'
import type { TranslationKey } from '../i18n/translations'
import { MIN_PASSWORD_LENGTH, isPasswordValid } from '../lib/passwordPolicy'
import type { FieldControlProps } from '@/shared/ui/Field'

// Shared between UserSettingsModal (password tab), ResetPasswordPage and the
// sign-in/sign-up form. `t` comes in as a prop because the entry screens read
// the language from localStorage (the profile is not loaded yet).

export const passwordInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1.5px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 14,
  color: 'var(--color-text)',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
  backgroundColor: 'var(--color-surface)',
}

export function PasswordInput({ value, onChange, show, onToggleShow, placeholder, control, autoComplete, t, name, required, enterKeyHint, readOnly, className, style, inputRef, onKeyUp, onKeyDown }: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggleShow: () => void
  placeholder?: string
  /** UX-007: ids do <Field> (label, dica e erro ligados ao campo). */
  control?: FieldControlProps
  /** `current-password` para a senha atual; `new-password` para a nova. */
  autoComplete?: 'current-password' | 'new-password'
  /** Para o nome do botão de mostrar/ocultar (ver o comentário do topo sobre o `t`). */
  t: (key: TranslationKey) => string
  name?: string
  required?: boolean
  enterKeyHint?: 'go' | 'next' | 'done' | 'send'
  readOnly?: boolean
  /** Com classe (ex.: `auth-input`), o visual vem do CSS e os handlers inline de borda ficam de fora. */
  className?: string
  style?: CSSProperties
  inputRef?: Ref<HTMLInputElement>
  onKeyUp?: (e: KeyboardEvent<HTMLInputElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  const styled = !className
  return (
    <div style={{ position: 'relative' }}>
      <input
        {...control}
        ref={inputRef}
        name={name}
        autoComplete={autoComplete}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        enterKeyHint={enterKeyHint}
        readOnly={readOnly}
        className={className}
        style={{ ...(styled ? passwordInputStyle : {}), paddingRight: 44, ...style }}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
        onFocus={styled ? e => (e.target.style.borderColor = 'var(--color-text)') : undefined}
        onBlur={styled ? e => (e.target.style.borderColor = 'var(--color-border)') : undefined}
      />
      {/* Nome fixo + aria-pressed (um estado só); 32 px de alvo (WCAG 2.5.8). */}
      <button
        type="button"
        onClick={onToggleShow}
        aria-label={t('password_show')}
        aria-pressed={show}
        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

// Cores por token (claras no escuro, escuras no claro); o rótulo usa os tokens
// de texto, que passam 4,5:1, e as barras os de ícone/borda.
const BAR_COLORS = ['var(--color-error)', 'var(--color-warning)', 'var(--color-warning)', 'var(--color-success)', 'var(--color-success)']
const LABEL_COLORS = ['var(--color-error-text)', 'var(--color-text-muted)', 'var(--color-text-muted)', 'var(--color-success-text)', 'var(--color-success-text)']

export function PasswordStrengthMeter({ password, t }: {
  password: string
  t: (key: TranslationKey) => string
}) {
  const score = getPasswordStrength(password)
  const labels = [
    t('settings_strength_very_weak'),
    t('settings_strength_weak'),
    t('settings_strength_fair'),
    t('settings_strength_strong'),
    t('settings_strength_very_strong'),
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: i <= score ? BAR_COLORS[score] : 'var(--color-border)', transition: 'background-color 0.2s' }} />
        ))}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: LABEL_COLORS[score] }}>{labels[score]}</span>
      {!isPasswordValid(password) && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('password_requirements_hint').replace('{min}', String(MIN_PASSWORD_LENGTH))}
        </span>
      )}
    </div>
  )
}

// Nunca contradiz a política (SEC-004): enquanto faltar regra, no máximo
// "fraca"; a partir daí, tamanho e símbolo sobem a nota.
export function getPasswordStrength(pwd: string): number {
  if (pwd.length === 0) return 0
  if (!isPasswordValid(pwd)) return pwd.length >= MIN_PASSWORD_LENGTH ? 1 : 0
  let score = 2
  if (pwd.length >= MIN_PASSWORD_LENGTH + 4) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  return Math.min(score, 4)
}

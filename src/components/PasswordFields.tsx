import { Eye, EyeOff } from 'lucide-react'
import type { TranslationKey } from '../i18n/translations'

// Shared between UserSettingsModal (password tab) and ResetPasswordPage.
// `t` comes in as a prop because ResetPasswordPage renders outside the
// LanguageProvider (which only wraps the signed-in tree).

export const passwordInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1.5px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  color: 'var(--color-text)',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
  backgroundColor: 'var(--color-surface)',
}

export function PasswordInput({ value, onChange, show, onToggleShow, placeholder }: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggleShow: () => void
  placeholder?: string
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...passwordInputStyle, paddingRight: 40 }}
        onFocus={e => (e.target.style.borderColor = 'var(--color-text)')}
        onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
      />
      <button
        type="button"
        onClick={onToggleShow}
        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

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
  const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: i <= score ? colors[score] : '#e9e9e7', transition: 'background-color 0.2s' }} />
        ))}
      </div>
      <span style={{ fontSize: 11, color: colors[score] }}>{labels[score]}</span>
    </div>
  )
}

export function getPasswordStrength(pwd: string): number {
  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  return Math.min(score, 4)
}

import { useState } from 'react'
import { CheckCheck, Copy } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { localDateKey, localDaysBetween } from '../../lib/localDate'
import { SOFT } from '../settings/settingsTokens'

// ARCH-008: peças de interface do painel de admin.

/** Caixa das tabelas (fundo, borda, cantos). */
export function TableBox({ children }: { children: React.ReactNode }) {
  return <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>{children}</div>
}

export function LoginBadge({ lastLoginDate }: { lastLoginDate: string | null }) {
  const { t } = useLanguage()
  if (!lastLoginDate) return <span style={{ fontSize: 11, color: 'var(--color-text-subtle)' }}>—</span>
  // REL-007: dias de calendário no fuso local (o login grava a data local).
  // Datas à frente vêm de gravações em UTC anteriores ao REL-007: contam como hoje.
  const days = localDaysBetween(lastLoginDate, localDateKey()) ?? 0
  const tone = days <= 0 ? SOFT.green : days === 1 ? SOFT.yellow : SOFT.red
  const label = days <= 0 ? t('users_login_today') : days === 1 ? t('users_login_yesterday') : t('users_login_days_ago', { n: days })
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: tone.bg, color: tone.text }}>{label}</span>
}

export function ActionBtn({ title, disabled, loading, onClick, color, children }: {
  title: string
  disabled: boolean
  loading: boolean
  onClick: () => void
  /** Cor do contorno e do ícone ao passar o mouse (token `var(--color-*)`). */
  color: string
  children: React.ReactNode
}) {
  const [hov, setHov] = useState(false)
  const lit = hov && !disabled
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, borderRadius: 6, border: '1px solid',
        borderColor: lit ? color : 'var(--color-border)',
        backgroundColor: lit ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent',
        color: disabled ? 'var(--color-border)' : hov ? color : 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

/** Botão pequeno de alerta (vermelho) ou de acréscimo (verde). */
export function SoftButton({ tone, onClick, disabled, children }: { tone: 'red' | 'green'; onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  const box = tone === 'red' ? SOFT.redBox : SOFT.greenBox
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 7, border: `1px solid ${box.border}`, backgroundColor: box.bg, color: box.text, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  )
}

export function CopyCodeButton({ copied, onCopy, compact }: { copied: boolean; onCopy: () => void; compact?: boolean }) {
  const { t } = useLanguage()
  const color = copied ? 'var(--color-success)' : 'var(--color-text-muted)'
  if (compact) {
    return (
      <button type="button" onClick={onCopy} title={t('settings_api_copy')} aria-label={t('settings_api_copy')} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
        {copied ? <CheckCheck size={12} /> : <Copy size={12} />}
      </button>
    )
  }
  return (
    <button type="button" onClick={onCopy} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', fontSize: 12, color }}>
      {copied ? <><CheckCheck size={12} /> {t('settings_api_copied')}</> : <><Copy size={12} /> {t('settings_api_copy')}</>}
    </button>
  )
}

export function TableHead({ columns, template }: { columns: string[]; template: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: template, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
      {columns.map((h, i) => (
        <span key={`${i}-${h}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
      ))}
    </div>
  )
}

/** Linha de aviso dentro de uma tabela ("carregando", "nenhum"). */
export function TableNotice({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{children}</div>
}

export function LegendItem({ icon, color, label }: { icon: React.ReactNode; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--color-text-muted)' }}>
      <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
      {label}
    </div>
  )
}

export function AdminTabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
        borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
        backgroundColor: active ? 'var(--color-surface)' : 'transparent',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontSize: 14, fontWeight: active ? 600 : 400,
        borderBottom: active ? '2px solid var(--color-text)' : '2px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      {icon}{label}
    </button>
  )
}

export function InviteSubTabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, border: '1.5px solid',
        borderColor: active ? 'var(--color-text)' : 'var(--color-border)',
        backgroundColor: active ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

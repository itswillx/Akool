import { useId } from 'react'
import { Field, type FieldControlProps } from '@/shared/ui/Field'
import type { InviteStatus } from '../../lib/data/invites'
import { SOFT } from './settingsTokens'

// ARCH-008: peças de interface das Configurações e do painel de admin
// (abas, rótulos, faixa de feedback, selos de status). Cores e estilos de
// formulário ficam em settingsTokens.ts.

const STATUS_BADGE: Record<InviteStatus, { bg: string; text: string }> = { pending: SOFT.green, used: SOFT.indigo, expired: SOFT.gray }

export function InviteStatusBadge({ status, label, fit }: { status: InviteStatus; label: string; fit?: boolean }) {
  const sc = STATUS_BADGE[status]
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text, width: fit ? 'fit-content' : undefined }}>
      {label}
    </span>
  )
}

export function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 8, border: 'none', cursor: 'pointer', backgroundColor: active ? 'var(--color-active)' : 'transparent', color: active ? 'var(--color-text)' : 'var(--color-text-muted)', fontSize: 13, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s' }}
    >
      {icon}{label}
    </button>
  )
}

/** Opção de um grupo (idioma, tema, visão do financeiro). */
export function OptionButton({ selected, onClick, icon, label }: { selected: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: selected ? 600 : 400,
        border: selected ? '2px solid var(--color-text)' : '1.5px solid var(--color-border)',
        backgroundColor: selected ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
        color: selected ? 'var(--color-text)' : 'var(--color-text-muted)',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

export function PanelFallback() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-muted)', fontSize: 14 }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700, fontSize: 13 }}>A</div>
    </div>
  )
}

const FIELD_LABEL_STYLE = { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 } as const

// UX-007: campo de texto (render prop) vira <Field>, com o label ligado ao
// input; grupo de botões (idioma, tema…) vira role="group" nomeado pelo título.
export function FieldLabel({ label, children }: {
  label: string
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode)
}) {
  const groupId = useId()
  if (typeof children === 'function') {
    return <div><Field label={label} labelStyle={FIELD_LABEL_STYLE}>{children}</Field></div>
  }
  return (
    <div role="group" aria-labelledby={groupId}>
      <span id={groupId} style={FIELD_LABEL_STYLE}>{label}</span>
      {children}
    </div>
  )
}

export function FeedbackBanner({ type, text, style }: { type: 'success' | 'error'; text: string; style?: React.CSSProperties }) {
  const box = type === 'success' ? SOFT.greenBox : SOFT.redBox
  return (
    // UX-007: erro anunciado na hora; sucesso quando o leitor terminar.
    <div role={type === 'error' ? 'alert' : 'status'} style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: box.bg, border: `1px solid ${box.border}`, color: box.text, fontSize: 13, ...style }}>
      {text}
    </div>
  )
}

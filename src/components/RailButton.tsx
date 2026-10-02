import { useState, type CSSProperties, type ReactNode } from 'react'

// QA-004: o botão de navegação lateral (rail) num lugar só. Antes havia uma
// cópia em cada módulo (Projetos, Estudos, Documentos e Financeiro), e só a do
// Financeiro marcava o item atual com aria-current. Módulos não importam uns
// dos outros; todos importam daqui.

export function RailBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span style={{
      marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 999, backgroundColor: '#ef4444',
      color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', padding: '0 5px', flexShrink: 0,
    }}>
      {count}
    </span>
  )
}

export function RailGroupTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase',
      color: 'var(--color-text-muted)', padding: '0 10px', marginBottom: 4,
    }}>
      {children}
    </div>
  )
}

export function RailButton({ icon, label, active = false, danger = false, compact = false, subtle = false, badge, trailing, onClick }: {
  icon: ReactNode
  label: string
  active?: boolean
  /** Vermelho (ex.: excluir quadro). */
  danger?: boolean
  /** Menor e sem negrito no ativo (lista do painel Documentos). */
  compact?: boolean
  /** Texto apagado quando inativo (nav do Financeiro). */
  subtle?: boolean
  /** Contador à direita (ex.: revisões vencidas). */
  badge?: number
  /** Qualquer coisa à direita (ex.: seta de "mais"). */
  trailing?: ReactNode
  onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  const textColor = danger ? '#ef4444' : active || !subtle ? 'var(--color-text)' : 'var(--color-text-subtle)'
  const iconColor = danger ? '#ef4444' : active && !compact ? 'var(--color-text)' : 'var(--color-text-muted)'
  const style: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: compact ? 8 : 9, width: '100%',
    padding: compact ? '7px 8px' : '8px 10px', borderRadius: compact ? 6 : 8,
    border: 'none', cursor: 'pointer', textAlign: 'left',
    backgroundColor: active ? 'var(--color-active)' : hov ? 'var(--color-hover)' : 'transparent',
    color: textColor, fontSize: 13.5, fontWeight: active && !compact ? 600 : 500,
  }
  return (
    <button
      type="button"
      onClick={onClick}
      // UX-008: a barra lateral é navegação (não abas); o item ativo é a página atual.
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={style}
    >
      <span style={{ display: 'flex', flexShrink: 0, color: iconColor }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge != null && <RailBadge count={badge} />}
      {trailing && <span style={{ marginLeft: 'auto', display: 'flex', color: 'var(--color-text-muted)', flexShrink: 0 }}>{trailing}</span>}
    </button>
  )
}

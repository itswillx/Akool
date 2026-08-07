import type { CSSProperties } from 'react'

// Design tokens shared by the finance panel and its submodules. Maps the
// "Controle Financeiro" design onto the site's CSS variables so the module keeps
// the same contrast as the rest of the app (decision: graphite accent, income
// green, expense red). Use these instead of hardcoded hexes.

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 14,
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  outline: 'none',
  boxSizing: 'border-box',
}

export const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  display: 'block',
}

export const FIN_ACCENT = 'var(--color-btn-primary)'          // primary buttons / active emphasis (graphite)
export const FIN_ACCENT_TEXT = 'var(--color-btn-primary-text)'
export const FIN_POS = 'var(--color-done)'                    // income
export const FIN_NEG = 'var(--color-error)'                   // expense
export const FIN_POS_SOFT = 'rgba(16,185,129,0.13)'
export const FIN_NEG_SOFT = 'rgba(239,68,68,0.13)'
export const FIN_WARN = '#f59e0b'                             // attention / overdue (kept semantic)

// Numeric figures use tabular-nums so columns of money align (design parity).
export const tabularNums: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

// Segmented control (pill toggle): a subtle track with a raised "surface" pill
// for the active option — Família/Individual, Lateral/Topo, Todos/Receitas.
export const segTrackStyle: CSSProperties = {
  display: 'inline-flex',
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 3,
}

export function segBtnStyle(active: boolean, opts?: { wide?: boolean }): CSSProperties {
  return {
    flex: opts?.wide ? 1 : undefined,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    border: 'none',
    background: active ? 'var(--color-surface)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-subtle)',
    fontSize: opts?.wide ? 13.5 : 12.5,
    fontWeight: active ? 600 : 500,
    padding: opts?.wide ? '8px 12px' : '5px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
    transition: 'background 0.12s, color 0.12s',
  }
}

// Primary (graphite) call-to-action button.
export const primaryBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: FIN_ACCENT,
  color: FIN_ACCENT_TEXT,
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// Subtle/secondary outlined button.
export const ghostBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-subtle)',
  fontSize: 13,
  fontWeight: 500,
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// Card surface used across the redesigned tabs.
export const cardSurfaceStyle: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
}

// Pill badge tinted by the colour it is given (status, kind, channel...).
// Viveu duplicado em cada submódulo até Obras e Investimentos saírem; o Resumo
// usava a cópia de Obras, então subiu para cá em vez de virar mais uma cópia.
export function badgeStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    color,
    background: 'color-mix(in srgb, currentColor 14%, transparent)',
    whiteSpace: 'nowrap',
  }
}

// Uppercase section caption (e.g. "EVOLUÇÃO MENSAL").
export const sectionCaptionStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  margin: 0,
}

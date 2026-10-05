import type { CSSProperties } from 'react'
import { badgeStyle, ghostBtnStyle } from '@/shared/ui/uiTokens'
import type { ApiTokenStatus } from '../../lib/data/apiTokens'

// API-009: estilos da aba API, num arquivo sem componentes (o Fast Refresh
// pede isso). Só tokens de cor: nada de hex (UX-015).

export type BannerTone = 'warning' | 'error' | 'success'

const TONE: Record<BannerTone, { base: string; text: string }> = {
  warning: { base: 'var(--color-warning)', text: 'var(--color-text)' },
  error: { base: 'var(--color-error)', text: 'var(--color-error-text)' },
  success: { base: 'var(--color-success)', text: 'var(--color-success-text)' },
}

export function bannerStyle(tone: BannerTone): CSSProperties {
  const { base, text } = TONE[tone]
  return {
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid color-mix(in srgb, ${base} 45%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${base} 10%, transparent)`,
    color: text,
    fontSize: 12.5,
    lineHeight: 1.45,
  }
}

const STATUS_COLOR: Record<ApiTokenStatus, string> = {
  active: 'var(--color-success-text)',
  revoked: 'var(--color-error-text)',
  expired: 'var(--color-text-muted)',
}

export const statusBadgeStyle = (status: ApiTokenStatus): CSSProperties => ({ ...badgeStyle(STATUS_COLOR[status]), flexShrink: 0 })

export const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 11.5,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-bg-secondary)',
  color: 'var(--color-text-subtle)',
  whiteSpace: 'nowrap',
}

export const smallBtnStyle: CSSProperties = { ...ghostBtnStyle, fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6 }

/** Botão de ação destrutiva; armado (segundo passo), fica cheio. */
export function dangerBtnStyle(armed: boolean): CSSProperties {
  return {
    ...smallBtnStyle,
    border: '1px solid color-mix(in srgb, var(--color-error) 45%, transparent)',
    background: armed ? 'var(--color-error-text)' : 'transparent',
    color: armed ? 'var(--color-surface)' : 'var(--color-error-text)',
  }
}

export const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 14,
  borderRadius: 10,
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
}

export const fieldLabelStyle: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }

export const hintStyle: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45 }

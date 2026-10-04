import type { CSSProperties } from 'react'

// Estilos comuns das seções da landing (LandingSections, vitrine, perguntas
// frequentes). Num .ts para o fast refresh continuar valendo nos componentes.

export const H2: CSSProperties = { margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--color-text)' }
export const H3: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }
export const BODY: CSSProperties = { margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-text-muted)' }
export const SUBTITLE: CSSProperties = { margin: '4px 0 20px', fontSize: 14, color: 'var(--color-text-muted)' }

/** Largura e respiro de cada seção. */
export function sectionInner(isMobile: boolean): CSSProperties {
  return { maxWidth: 1100, margin: '0 auto', padding: isMobile ? '24px 16px' : '40px 24px', boxSizing: 'border-box' }
}

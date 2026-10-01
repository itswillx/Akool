import { useState, type CSSProperties, type RefObject } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

export const SPLIT_MIN = 20
export const SPLIT_MAX = 80
const KEY_STEP = 5
const HIT = 24 // área de toque, em px

const clamp = (value: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))

// Área de toque de 24px com o traço visível no meio, sem mudar o layout: as
// margens negativas somam a largura extra. Lado a lado, a área invade mais o
// desenho (14px) que a nota (6px), para não cobrir a barra de rolagem da nota.
function hitAreaStyle(stacked: boolean, dragging: boolean): CSSProperties {
  const color = dragging ? 'var(--color-primary)' : 'var(--color-border)'
  if (stacked) {
    const line = 6
    const before = (HIT - line) / 2
    return {
      height: HIT, margin: `-${before}px 0`, cursor: 'row-resize',
      background: `linear-gradient(to bottom, transparent ${before}px, ${color} ${before}px, ${color} ${before + line}px, transparent ${before + line}px)`,
    }
  }
  const line = 4
  const before = 6
  return {
    width: HIT, margin: `0 -${HIT - line - before}px 0 -${before}px`, cursor: 'col-resize',
    background: `linear-gradient(to right, transparent ${before}px, ${color} ${before}px, ${color} ${before + line}px, transparent ${before + line}px)`,
  }
}

/**
 * UX-010: divisor do split view (nota + desenho). Pointer Events com captura:
 * funciona no touch e o arrasto não se perde sobre o canvas do Excalidraw.
 * Teclado (padrão "window splitter"): setas mudam 5%, Home/End vão aos limites.
 * `stacked`: painéis empilhados (celular), o divisor corre na vertical.
 */
export default function SplitDivider({ containerRef, ratio, onChange, onDraggingChange, stacked = false }: {
  containerRef: RefObject<HTMLElement | null>
  ratio: number
  onChange: (ratio: number) => void
  onDraggingChange?: (dragging: boolean) => void
  stacked?: boolean
}) {
  const { t } = useLanguage()
  const [dragging, setDragging] = useState(false)

  const setDrag = (value: boolean) => {
    setDragging(value)
    onDraggingChange?.(value)
  }

  const ratioAt = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || (stacked ? rect.height : rect.width) <= 0) return null
    const fraction = stacked ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width
    return clamp(fraction * 100)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={stacked ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(ratio)}
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-label={t('split_resize')}
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        setDrag(true)
      }}
      onPointerMove={e => {
        if (!dragging) return
        const next = ratioAt(e)
        if (next !== null) onChange(next)
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onLostPointerCapture={() => { if (dragging) setDrag(false) }}
      onKeyDown={e => {
        let next: number | null = null
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ratio - KEY_STEP
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ratio + KEY_STEP
        else if (e.key === 'Home') next = SPLIT_MIN
        else if (e.key === 'End') next = SPLIT_MAX
        if (next === null) return
        e.preventDefault()
        onChange(clamp(next))
      }}
      style={{
        flexShrink: 0, position: 'relative', zIndex: 2, touchAction: 'none',
        ...hitAreaStyle(stacked, dragging),
      }}
    />
  )
}

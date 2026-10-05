import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { segBtnStyle, segTrackStyle } from '@/shared/ui/uiTokens'

// API-009: controle segmentado com a semântica de grupo de rádio (WAI-ARIA):
// uma parada de Tab por grupo (a opção marcada, ou a primeira livre), setas
// movem e escolhem, Home/End vão às pontas e opção desligada fica de fora.
// A variante "cards" mostra título e descrição (os presets).

export interface SegmentedOption<V extends string | number> {
  value: V
  label: string
  /** Só na variante "cards": a linha de baixo, ligada por aria-describedby. */
  description?: string
  disabled?: boolean
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

const CARDS_TRACK: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }

function cardStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 3,
    textAlign: 'left',
    padding: '9px 11px',
    borderRadius: 8,
    border: active ? '2px solid var(--color-text)' : '1.5px solid var(--color-border)',
    backgroundColor: active ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
    color: 'var(--color-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  }
}

export function SegmentedRadio<V extends string | number>({ options, value, onChange, label, labelledBy, describedBy, variant = 'segmented' }: {
  options: readonly SegmentedOption<V>[]
  /** null: nenhuma marcada (ex.: seção com subseções em níveis diferentes). */
  value: V | null
  onChange: (value: V) => void
  /** Nome do grupo, quando não há rótulo visível para apontar. */
  label?: string
  labelledBy?: string
  describedBy?: string
  variant?: 'segmented' | 'cards'
}) {
  const id = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.flatMap((option, i) => (option.disabled ? [] : [i]))
  const checked = options.findIndex(option => option.value === value && !option.disabled)
  const tabStop = checked >= 0 ? checked : enabled[0]
  const cards = variant === 'cards'

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const pos = enabled.indexOf(from)
    let to: number | undefined
    if (NEXT_KEYS.has(event.key)) to = enabled[(pos + 1) % enabled.length]
    else if (PREV_KEYS.has(event.key)) to = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (event.key === 'Home') to = enabled[0]
    else if (event.key === 'End') to = enabled[enabled.length - 1]
    if (to === undefined) return
    event.preventDefault()
    buttons.current[to]?.focus()
    onChange(options[to].value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      style={cards ? CARDS_TRACK : { ...segTrackStyle, flexWrap: 'wrap' }}
    >
      {options.map((option, i) => {
        const active = option.value === value
        const disabled = !!option.disabled
        const described = cards && option.description
        return (
          <button
            key={String(option.value)}
            ref={el => { buttons.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-labelledby={described ? `${id}-${i}` : undefined}
            aria-describedby={described ? `${id}-${i}-d` : undefined}
            disabled={disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={event => onKeyDown(event, i)}
            style={cards ? cardStyle(active, disabled) : { ...segBtnStyle(active), ...(disabled ? { cursor: 'not-allowed', opacity: 0.45 } : null) }}
          >
            {described ? (
              <>
                <span id={`${id}-${i}`} style={{ fontSize: 13, fontWeight: 600 }}>{option.label}</span>
                <span id={`${id}-${i}-d`} style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{option.description}</span>
              </>
            ) : option.label}
          </button>
        )
      })}
    </div>
  )
}

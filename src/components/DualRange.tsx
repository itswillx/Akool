import { tabularNums, FIN_ACCENT } from './uiTokens'

// Two-thumb range filter over one painted track. Native <input type="range">
// pairs stacked with pointer-events off (only the thumbs are live) — see the
// .dualrange rules in index.css, which exist because pseudo-elements can't be
// styled inline.
//
// The thumbs work in fixed 0..100 steps mapped onto `bounds`, so the control
// behaves the same whether the domain range is cents or a neighbor count.
// `max === null` means "no ceiling" (right thumb parked at the end) — the
// caller must keep passing bounds computed BEFORE this filter is applied, or
// the track shrinks under the user's own drag.

const STEPS = 100

export function DualRange({ label, bounds, min, max, onChange, format }: {
  label: string
  bounds: { min: number; max: number }
  min: number
  max: number | null
  onChange: (min: number, max: number | null) => void
  format: (v: number) => string
}) {
  const span = Math.max(1, bounds.max - bounds.min)
  const toStep = (v: number) => Math.round(((v - bounds.min) / span) * STEPS)
  const fromStep = (step: number) => Math.round(bounds.min + (step / STEPS) * span)

  const minStep = Math.min(STEPS, Math.max(0, toStep(min)))
  const maxStep = max == null ? STEPS : Math.min(STEPS, Math.max(0, toStep(max)))

  // Cada thumb é travado pelo outro, então eles nunca se cruzam.
  const setMinStep = (step: number) => {
    const clamped = Math.min(step, maxStep)
    onChange(clamped <= 0 ? bounds.min : fromStep(clamped), max)
  }
  const setMaxStep = (step: number) => {
    const clamped = Math.max(step, minStep)
    onChange(min, clamped >= STEPS ? null : fromStep(clamped))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', minWidth: 180, maxWidth: 300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>
        <span>{label}</span>
        <span style={tabularNums}>
          {format(fromStep(minStep))} – {maxStep >= STEPS ? format(bounds.max) : format(fromStep(maxStep))}
        </span>
      </div>
      <div style={{ position: 'relative', height: 16 }}>
        <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 0, right: 0, height: 4, borderRadius: 999, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 4, borderRadius: 999, background: FIN_ACCENT,
          left: `${minStep}%`, width: `${Math.max(0, maxStep - minStep)}%`,
        }} />
        <input type="range" className="dualrange" min={0} max={STEPS} step={1}
          value={minStep} onChange={e => setMinStep(Number(e.target.value))} />
        <input type="range" className="dualrange" min={0} max={STEPS} step={1}
          value={maxStep} onChange={e => setMaxStep(Number(e.target.value))} />
      </div>
    </div>
  )
}

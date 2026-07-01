// Small hand-rolled, dependency-free SVG chart primitives for the Projects
// dashboard. Presentational and pure; colors come from the caller (hex or CSS
// variables) so they adapt to light/dark theme.

export interface ChartDatum {
  label: string
  value: number
  color: string
}

// Ring chart. Segments are drawn as dash-offset strokes on stacked circles,
// starting at 12 o'clock (rotate -90deg). Center shows the total (or override).
export function Donut({ data, size = 124, thickness = 16, centerValue, centerLabel }: {
  data: ChartDatum[]; size?: number; thickness?: number; centerValue?: string | number; centerLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-hover)" strokeWidth={thickness} />
        {total > 0 && data.filter(d => d.value > 0).map((d, i) => {
          const len = (d.value / total) * c
          const seg = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          )
          offset += len
          return seg
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: Math.round(size * 0.24), fontWeight: 800, color: 'var(--color-text)', lineHeight: 1 }}>{centerValue ?? total}</span>
        {centerLabel && <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', fontWeight: 600, marginTop: 2 }}>{centerLabel}</span>}
      </div>
    </div>
  )
}

// Color dot + label + value rows, paired with a Donut/SegmentedBar.
export function Legend({ items }: { items: ChartDatum[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0, flex: 1 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: it.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{it.label}</span>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, flexShrink: 0 }}>{it.value}</span>
        </div>
      ))}
    </div>
  )
}

// Single horizontal stacked bar (proportional segments).
export function SegmentedBar({ segments, height = 14 }: { segments: ChartDatum[]; height?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0)
  return (
    <div style={{ display: 'flex', width: '100%', height, borderRadius: 999, overflow: 'hidden', backgroundColor: 'var(--color-hover)' }}>
      {total > 0 && segments.filter(s => s.value > 0).map((s, i) => (
        <div key={i} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />
      ))}
    </div>
  )
}

// Filled area + line trend. Stroke kept crisp via non-scaling-stroke so the SVG
// can stretch to full width (preserveAspectRatio none). Values + labels below.
export function AreaTrend({ points, color, height = 110 }: {
  points: { label: string; value: number }[]; color: string; height?: number;
}) {
  const n = points.length
  if (n === 0) return null
  const W = 100, H = 40, padY = 3
  const max = Math.max(1, ...points.map(p => p.value))
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => H - padY - (v / max) * (H - padY * 2)
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const area = `M ${x(0)},${y(points[0].value)} ` + points.map((p, i) => `L ${x(i)},${y(p.value)}`).join(' ') + ` L ${x(n - 1)},${H} L ${x(0)},${H} Z`
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d={area} fill={color} fillOpacity={0.14} stroke="none" />
        <polyline points={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', marginTop: 6 }}>
        {points.map((p, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>{p.value}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

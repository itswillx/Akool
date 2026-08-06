// Small hand-rolled, dependency-free SVG chart primitives for the Projects
// dashboard. Presentational and pure; colors come from the caller (hex or CSS
// variables) so they adapt to light/dark theme.

import { useState } from 'react'

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
// `formatValue` exists because the raw datum is a plain number: money is stored
// in cents, so without it a slice reads "543895" instead of "R$ 5.438,95".
export function Legend({ items, formatValue = String }: {
  items: ChartDatum[]; formatValue?: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0, flex: 1 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: it.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{it.label}</span>
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, flexShrink: 0 }}>{formatValue(it.value)}</span>
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

export interface AreaSeries {
  name: string
  color: string
  values: number[]
}

// Two overlaid area trends on a shared Y scale (e.g. income vs expense per
// month). Same stretched-SVG technique as AreaTrend; the hover guide line,
// point markers and tooltip are HTML overlays because anything drawn inside a
// preserveAspectRatio="none" SVG would distort. Per-point values live in the
// tooltip only — 12 currency values would not fit under the chart.
export function DualAreaTrend({ labels, series, height = 190, formatValue = String }: {
  labels: string[]; series: [AreaSeries, AreaSeries]; height?: number; formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  if (n === 0) return null
  const W = 100, H = 40, padY = 3
  const max = Math.max(1, ...series[0].values, ...series[1].values)
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => H - padY - (v / max) * (H - padY * 2)
  const line = (values: number[]) => values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const area = (values: number[]) =>
    `M ${x(0)},${y(values[0] ?? 0)} ` + values.map((v, i) => `L ${x(i)},${y(v)}`).join(' ') + ` L ${x(n - 1)},${H} L ${x(0)},${H} Z`
  // Keep the floating card inside the chart near both edges.
  const tooltipLeft = (i: number) => Math.min(Math.max(x(i), 12), 88)
  return (
    <div>
      <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
        <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
          {series.map((s, si) => (
            <path key={`a${si}`} d={area(s.values)} fill={s.color} fillOpacity={0.12} stroke="none" />
          ))}
          {series.map((s, si) => (
            <polyline key={`l${si}`} points={line(s.values)} fill="none" stroke={s.color} strokeWidth={2}
              vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </svg>
        {hover != null && (
          <>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${x(hover)}%`, width: 1, backgroundColor: 'var(--color-border)', pointerEvents: 'none' }} />
            {series.map((s, si) => (
              <div key={si} style={{
                position: 'absolute', left: `${x(hover)}%`, top: `${(y(s.values[hover] ?? 0) / H) * 100}%`,
                width: 9, height: 9, borderRadius: '50%', backgroundColor: s.color,
                border: '2px solid var(--color-bg)', transform: 'translate(-50%, -50%)', pointerEvents: 'none',
              }} />
            ))}
            <div style={{
              position: 'absolute', left: `${tooltipLeft(hover)}%`, bottom: 'calc(100% - 4px)', transform: 'translateX(-50%)',
              backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 10,
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)', padding: '8px 10px', pointerEvents: 'none', zIndex: 2, whiteSpace: 'nowrap',
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'capitalize', marginBottom: 4 }}>{labels[hover]}</div>
              {series.map((s, si) => (
                <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                  <span style={{ color: 'var(--color-text-muted)' }}>{s.name}</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text)', marginLeft: 'auto', paddingLeft: 10 }}>{formatValue(s.values[hover] ?? 0)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {labels.map((_, i) => (
            <div key={i} style={{ flex: 1 }} onMouseEnter={() => setHover(i)} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', marginTop: 6 }}>
        {labels.map((l, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', minWidth: 0, fontSize: 10, textTransform: 'capitalize',
            color: hover === i ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: hover === i ? 700 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{l}</div>
        ))}
      </div>
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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Maximize2, Minimize2, Crosshair } from 'lucide-react'
import type { GraphEdgeBase, GraphNodeBase, GraphShape } from '../../lib/graph'
import type { LayoutNode } from '../../lib/forceLayout'
import { layoutBounds } from '../../lib/forceLayout'
import { ghostBtnStyle } from '../uiTokens'

// Domain-agnostic SVG canvas for a "Rede" view: pan/zoom via viewBox, hover
// tooltip (desktop), click-to-select with neighbor highlight, label
// decluttering and a fullscreen overlay.
//
// Everything domain-specific is a prop (value formatting, edge colour, kind
// label, the UI strings) so this file never imports a domain's i18n keys or
// formatters. Adapters live next to each domain's tab.

interface ViewBox { x: number; y: number; w: number; h: number }

/** Font sizes are in CSS pixels and converted to user units per zoom level, so
 *  text stays the same size on screen no matter how large the layout canvas is. */
const LABEL_PX = 11
const VALUE_PX = 9.5
const LABEL_MAX_CHARS = 22
/** Rough width of a character relative to the font size, for the collision box. */
const CHAR_RATIO = 0.55

export interface GraphCanvasLabels {
  empty: string
  zoomIn: string
  zoomOut: string
  zoomReset: string
  fullscreen: string
  exitFullscreen: string
}

function truncate(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label
}

export function GraphCanvas<N extends GraphNodeBase, E extends GraphEdgeBase>({
  graph, layout, selectedId, onSelect, height, isMobile, labels,
  kindLabel, formatValue, edgeColor,
}: {
  graph: GraphShape<N, E>
  layout: LayoutNode[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** '100%' fills the parent — use it when the parent already has a height. */
  height: number | '100%'
  isMobile: boolean
  labels: GraphCanvasLabels
  kindLabel: (kind: N['kind']) => string
  /** Renders under the node label and in the tooltip. `null` hides the value
   *  line entirely (a domain whose `value` is an internal weight). */
  formatValue?: ((v: number) => string) | null
  /** Highlight colour of an edge touching the active node. Defaults to the
   *  target node's colour. */
  edgeColor?: (edge: E, nodeById: Map<string, N>) => string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [vb, setVb] = useState<ViewBox | null>(null)
  const [hover, setHover] = useState<{ id: string; px: number; py: number } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [pixelWidth, setPixelWidth] = useState(0)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; vb: ViewBox; moved: boolean } | null>(null)

  const at = useMemo(() => new Map(layout.map(p => [p.id, p])), [layout])
  const nodeById = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph.nodes])
  const maxWeight = useMemo(() => Math.max(1, ...graph.edges.map(e => e.weight)), [graph.edges])

  // Frame the actual drawing, not the whole layout canvas: the canvas grows
  // with the node count, so a fixed viewBox would leave a big graph tiny in a
  // corner and a small one lost in white space.
  const home = useMemo(() => layoutBounds(layout), [layout])
  const layoutKey = useMemo(() => layout.map(p => p.id).join(','), [layout])

  // Re-frame whenever the node set changes (filters, search, new data). Pan and
  // zoom of the current set are preserved — only a different graph resets them.
  useEffect(() => {
    setVb(home)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setPixelWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setPixelWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view = vb ?? home
  // User units per CSS pixel. Everything meant to keep a fixed on-screen size
  // (text, tooltip anchoring) multiplies by this.
  const unitsPerPx = pixelWidth > 0 ? view.w / pixelWidth : 1

  // Hover vence a seleção para efeito de destaque momentâneo.
  const activeId = hover?.id ?? selectedId
  const neighborIds = useMemo(() => {
    if (!activeId) return null
    const out = new Set<string>([activeId])
    for (const e of graph.edges) {
      if (e.source === activeId) out.add(e.target)
      if (e.target === activeId) out.add(e.source)
    }
    return out
  }, [activeId, graph.edges])

  // Which labels fit without colliding. Panning doesn't change relative
  // positions, so this only depends on the layout and the zoom level — rounding
  // the scale keeps it from recomputing on every wheel tick.
  const zoomBucket = Math.round(Math.log2(Math.max(0.01, unitsPerPx)) * 4)
  const labelledIds = useMemo(() => {
    const scale = Math.pow(2, zoomBucket / 4)
    if (scale <= 0 || layout.length === 0) return new Set<string>()
    // Work in CSS pixels: box sizes are the same everywhere on screen.
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = []
    const accepted = new Set<string>()
    // Biggest first: the most connected node wins the space it contests.
    const ordered = [...layout].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))
    for (const p of ordered) {
      const node = nodeById.get(p.id)
      if (!node) continue
      const text = truncate(node.label)
      if (!text) continue
      const halfW = (text.length * LABEL_PX * CHAR_RATIO) / 2
      const cx = p.x / scale
      const top = (p.y + p.r) / scale + 3
      const box = { x1: cx - halfW, y1: top, x2: cx + halfW, y2: top + LABEL_PX * 1.25 }
      const clash = boxes.some(b => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)
      if (clash) continue
      boxes.push(box)
      accepted.add(p.id)
    }
    return accepted
  }, [layout, nodeById, zoomBucket])

  const colorOf = (e: E) =>
    edgeColor ? edgeColor(e, nodeById) : nodeById.get(e.target)?.color ?? 'var(--color-border)'

  const zoomAt = (factor: number, anchorSvgX: number, anchorSvgY: number) => {
    setVb(prev => {
      const cur = prev ?? home
      // Clamp relative to the framed graph: 4x in, 4x out from the fit.
      const w = Math.min(home.w * 4, Math.max(home.w / 4, cur.w * factor))
      const scale = w / cur.w
      return {
        x: anchorSvgX - (anchorSvgX - cur.x) * scale,
        y: anchorSvgY - (anchorSvgY - cur.y) * scale,
        w,
        h: cur.h * scale,
      }
    })
  }

  // Wheel precisa de preventDefault, e a prop onWheel do React registra um
  // listener passivo — então o listener vai direto no elemento, não-passivo.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const relX = (e.clientX - rect.left) / rect.width
      const relY = (e.clientY - rect.top) / rect.height
      setVb(prev => {
        const cur = prev ?? home
        const anchorX = cur.x + relX * cur.w
        const anchorY = cur.y + relY * cur.h
        const w = Math.min(home.w * 4, Math.max(home.w / 4, cur.w * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
        const scale = w / cur.w
        return {
          x: anchorX - (anchorX - cur.x) * scale,
          y: anchorY - (anchorY - cur.y) * scale,
          w,
          h: cur.h * scale,
        }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [home])

  // Escape leaves fullscreen — the overlay covers the app, so there has to be a
  // way out that isn't the button.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current) return
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, vb: view, moved: false }
    ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = ((e.clientX - d.startX) / rect.width) * d.vb.w
    const dy = ((e.clientY - d.startY) / rect.height) * d.vb.h
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true
    setVb({ x: d.vb.x - dx, y: d.vb.y - dy, w: d.vb.w, h: d.vb.h })
  }
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    // Clique parado no fundo desseleciona; arrasto não.
    if (!d.moved) onSelect(null)
  }

  const moveHover = (node: N, e: React.MouseEvent) => {
    if (isMobile) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ id: node.id, px: e.clientX - rect.left, py: e.clientY - rect.top })
  }

  const zoomBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button title={label} aria-label={label} onClick={onClick}
      style={{ ...ghostBtnStyle, padding: 6, borderRadius: 7, lineHeight: 0 }}>
      {icon}
    </button>
  )

  const hoverNode = hover ? nodeById.get(hover.id) : null

  const shell: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 900, background: 'var(--color-surface)', overflow: 'hidden' }
    : { position: 'relative', height, overflow: 'hidden' }

  return (
    <div ref={containerRef} style={shell}>
      {graph.nodes.length === 0 ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13.5 }}>
          {labels.empty}
        </div>
      ) : (
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          style={{ display: 'block', touchAction: 'none', cursor: 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {graph.edges.map(e => {
            const a = at.get(e.source)
            const b = at.get(e.target)
            if (!a || !b) return null
            const touched = activeId != null && (e.source === activeId || e.target === activeId)
            const faded = activeId != null && !touched
            return (
              <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={touched ? colorOf(e) : 'var(--color-border)'}
                strokeWidth={1 + 3 * (e.weight / maxWeight)}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                opacity={faded ? 0.15 : touched ? 0.9 : 0.5}
                style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
              />
            )
          })}
          {graph.nodes.map(node => {
            const p = at.get(node.id)
            if (!p) return null
            const selected = node.id === selectedId
            const active = activeId === node.id
            const highlighted = neighborIds != null && neighborIds.has(node.id)
            const faded = (neighborIds != null && !highlighted) || node.dimmed
            // Hover/seleção sempre mostram o nome, mesmo quando o declutter o
            // teria escondido — é a forma de ler um nó pequeno.
            const showLabel = labelledIds.has(node.id) || active || (highlighted && selectedId != null)
            const showValue = formatValue != null && showLabel && p.r >= 18
            return (
              <g key={node.id}
                transform={`translate(${p.x} ${p.y})`}
                role="button"
                tabIndex={0}
                opacity={faded ? (node.dimmed && neighborIds == null ? 0.45 : 0.18) : 1}
                style={{ cursor: 'pointer', transition: 'transform 0.35s ease, opacity 0.15s', outline: 'none' }}
                onClick={e => { e.stopPropagation(); onSelect(node.id) }}
                onPointerDown={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') onSelect(node.id) }}
                onMouseEnter={e => moveHover(node, e)}
                onMouseMove={e => moveHover(node, e)}
                onMouseLeave={() => setHover(h => (h?.id === node.id ? null : h))}
              >
                {selected && (
                  <circle r={p.r + 5} fill="none" stroke={node.color} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.55} />
                )}
                <circle r={p.r}
                  fill={`color-mix(in srgb, ${node.color} 18%, var(--color-surface))`}
                  stroke={node.color}
                  strokeWidth={selected ? 2.5 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
                <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(10, p.r * 0.72)} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {node.icon}
                </text>
                {showLabel && (
                  <text textAnchor="middle" y={p.r + LABEL_PX * unitsPerPx} fontSize={LABEL_PX * unitsPerPx} fontWeight={600}
                    fill="var(--color-text)" stroke="var(--color-surface)" strokeWidth={3 * unitsPerPx} paintOrder="stroke"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {truncate(node.label)}
                  </text>
                )}
                {showValue && (
                  <text textAnchor="middle" y={p.r + (LABEL_PX + VALUE_PX + 3) * unitsPerPx} fontSize={VALUE_PX * unitsPerPx}
                    fill="var(--color-text-muted)" stroke="var(--color-surface)" strokeWidth={3 * unitsPerPx} paintOrder="stroke"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {formatValue(node.value)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}

      {/* Controles — o zoom é essencial no mobile (sem wheel) e acessível no desktop. */}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {zoomBtn(labels.zoomIn, <Plus size={15} />, () => zoomAt(1 / 1.25, view.x + view.w / 2, view.y + view.h / 2))}
        {zoomBtn(labels.zoomOut, <Minus size={15} />, () => zoomAt(1.25, view.x + view.w / 2, view.y + view.h / 2))}
        {zoomBtn(labels.zoomReset, <Crosshair size={15} />, () => setVb(home))}
        {zoomBtn(
          fullscreen ? labels.exitFullscreen : labels.fullscreen,
          fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />,
          () => setFullscreen(f => !f),
        )}
      </div>

      {hoverNode && hover && (
        <div style={{
          position: 'absolute',
          left: Math.min(hover.px + 14, (containerRef.current?.clientWidth ?? 300) - 190),
          top: Math.max(hover.py - 10, 8),
          backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 10,
          boxShadow: '0 6px 20px rgba(0,0,0,0.12)', padding: '8px 10px', pointerEvents: 'none', zIndex: 2,
          maxWidth: 240,
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text)' }}>
            {hoverNode.icon} {hoverNode.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{kindLabel(hoverNode.kind)}</div>
          {formatValue != null && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)', marginTop: 2 }}>{formatValue(hoverNode.value)}</div>
          )}
        </div>
      )}
    </div>
  )
}

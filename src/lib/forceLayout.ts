// Tiny deterministic force-directed layout for the finance "Rede" graph.
// Pure and dependency-free like the rest of src/lib: pairwise repulsion
// (Fruchterman-Reingold style), springs along edges, weak central gravity.
// O(n²) per iteration is fine at this graph's scale (dozens of nodes; only
// past ~300 would it be worth cutting iterations down).
//
// Determinism matters: the PRNG is seeded from the sorted node ids, so the
// same data always draws the same picture — no re-shuffling on every render
// or reload. Callers memoize by node/edge ids and never re-run on hover.

export interface LayoutNode {
  id: string
  x: number
  y: number
  r: number
}

export const LAYOUT_WIDTH = 1000
export const LAYOUT_HEIGHT = 640

/** Breathing room kept between two circles by the separation pass. */
const NODE_GAP = 16

/** Node count the base canvas is sized for. */
const REFERENCE_NODES = 40
/** Past this the canvas stops growing — the view zooms out instead. */
const MAX_CANVAS_SCALE = 4

// Canvas big enough for `n` nodes. A fixed canvas means 20 nodes and 300 nodes
// fight over the same area, and the second case comes out as a hairball; the
// area per node stays roughly constant instead. Callers frame the result with
// layoutBounds, so a larger canvas costs nothing on screen.
export function layoutSizeFor(n: number): { width: number; height: number } {
  const scale = Math.min(MAX_CANVAS_SCALE, Math.max(1, Math.sqrt(n / REFERENCE_NODES)))
  return { width: LAYOUT_WIDTH * scale, height: LAYOUT_HEIGHT * scale }
}

// Iterations worth running for `n` nodes: each one is O(n²), so a big graph
// trades some relaxation for staying responsive. Nobody can tell the difference
// once the layout is zoomed out to fit.
export function iterationsFor(n: number): number {
  return n > 120 ? Math.max(80, Math.round((250 * 120) / n)) : 250
}

// Node radius from its value on a sqrt scale (area ~ value reads better than
// radius ~ value), clamped so tiny nodes stay clickable and huge ones don't
// swallow the canvas.
export function radiusFor(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 10
  return Math.min(34, 10 + 24 * Math.sqrt(value / maxValue))
}

// Bounding box of a finished layout plus a margin — what the canvas frames on
// screen. Empty layouts fall back to the base canvas so the viewBox is valid.
export function layoutBounds(nodes: LayoutNode[], margin = 40): { x: number; y: number; w: number; h: number } {
  if (nodes.length === 0) return { x: 0, y: 0, w: LAYOUT_WIDTH, h: LAYOUT_HEIGHT }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    // The label sits under the circle, so the bottom needs extra room.
    minX = Math.min(minX, n.x - n.r)
    minY = Math.min(minY, n.y - n.r)
    maxX = Math.max(maxX, n.x + n.r)
    maxY = Math.max(maxY, n.y + n.r + 18)
  }
  return {
    x: minX - margin,
    y: minY - margin,
    w: Math.max(1, maxX - minX + margin * 2),
    h: Math.max(1, maxY - minY + margin * 2),
  }
}

// mulberry32 — small, fast, good-enough PRNG for jittering start positions.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// djb2 over the sorted ids: same node set (any order) → same seed → same layout.
function seedFrom(ids: string[]): number {
  let h = 5381
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  }
  return h >>> 0
}

export function runForceLayout(
  nodes: { id: string; r: number }[],
  edges: { source: string; target: string; weight: number }[],
  opts?: { width?: number; height?: number; iterations?: number },
): LayoutNode[] {
  const n = nodes.length
  if (n === 0) return []
  const size = layoutSizeFor(n)
  const width = opts?.width ?? size.width
  const height = opts?.height ?? size.height
  const iterations = opts?.iterations ?? iterationsFor(n)

  const rand = mulberry32(seedFrom(nodes.map(nd => nd.id)))
  const cx = width / 2
  const cy = height / 2

  // Start on a circle with jitter — never two nodes on the same point, so the
  // repulsion term can't divide by zero.
  const pos = nodes.map((nd, i) => {
    const angle = (i / n) * 2 * Math.PI
    const ring = Math.min(width, height) * 0.3
    return {
      id: nd.id,
      r: nd.r,
      x: cx + Math.cos(angle) * ring + (rand() - 0.5) * 40,
      y: cy + Math.sin(angle) * ring + (rand() - 0.5) * 40,
    }
  })
  const index = new Map(pos.map((p, i) => [p.id, i]))

  const maxWeight = Math.max(1, ...edges.map(e => e.weight))
  const springs = edges
    .map(e => ({ a: index.get(e.source), b: index.get(e.target), weightNorm: e.weight / maxWeight }))
    .filter((s): s is { a: number; b: number; weightNorm: number } => s.a != null && s.b != null && s.a !== s.b)

  // Ideal pairwise distance scales with available area per node.
  const k = Math.sqrt((width * height) / n)

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations
    const step = 12 * cooling + 0.5
    const dx = new Array<number>(n).fill(0)
    const dy = new Array<number>(n).fill(0)

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = pos[i].x - pos[j].x
        let vy = pos[i].y - pos[j].y
        let d = Math.hypot(vx, vy)
        if (d < 0.01) {
          // Coincident points give no direction — nudge apart deterministically.
          vx = rand() - 0.5
          vy = rand() - 0.5
          d = Math.hypot(vx, vy)
        }
        const force = (k * k) / d / d
        dx[i] += (vx / d) * force
        dy[i] += (vy / d) * force
        dx[j] -= (vx / d) * force
        dy[j] -= (vy / d) * force
      }
    }

    for (const s of springs) {
      const a = pos[s.a]
      const b = pos[s.b]
      let vx = b.x - a.x
      let vy = b.y - a.y
      let d = Math.hypot(vx, vy)
      if (d < 0.01) { vx = rand() - 0.5; vy = rand() - 0.5; d = Math.hypot(vx, vy) }
      // Heavier edges pull slightly tighter (up to 25% shorter rest length).
      const restLen = (90 + a.r + b.r) * (1 - 0.25 * s.weightNorm)
      const force = (d - restLen) / d * 0.06
      dx[s.a] += vx * force
      dy[s.a] += vy * force
      dx[s.b] -= vx * force
      dy[s.b] -= vy * force
    }

    for (let i = 0; i < n; i++) {
      // Weak pull to the center keeps disconnected clusters on canvas.
      dx[i] += (cx - pos[i].x) * 0.01
      dy[i] += (cy - pos[i].y) * 0.01
      const d = Math.hypot(dx[i], dy[i])
      const clampedStep = d > step ? step / d : 1
      pos[i].x += dx[i] * clampedStep
      pos[i].y += dy[i] * clampedStep
      pos[i].x = Math.min(width - pos[i].r, Math.max(pos[i].r, pos[i].x))
      pos[i].y = Math.min(height - pos[i].r, Math.max(pos[i].r, pos[i].y))
    }

    // Separation pass. Repulsion alone can't guarantee circles don't touch —
    // it falls off with 1/d² and springs pull the other way, so a hub's
    // children end up glued together. This resolves the overlap directly.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[i]
        const b = pos[j]
        const wanted = a.r + b.r + NODE_GAP
        let vx = b.x - a.x
        let vy = b.y - a.y
        let d = Math.hypot(vx, vy)
        if (d >= wanted) continue
        if (d < 0.01) { vx = rand() - 0.5; vy = rand() - 0.5; d = Math.hypot(vx, vy) }
        const push = (wanted - d) / 2
        a.x -= (vx / d) * push
        a.y -= (vy / d) * push
        b.x += (vx / d) * push
        b.y += (vy / d) * push
      }
    }
  }

  // The separation pass runs after the clamp, so a node can end up just past
  // the edge; pull everyone back in one last time.
  for (const p of pos) {
    p.x = Math.min(width - p.r, Math.max(p.r, p.x))
    p.y = Math.min(height - p.r, Math.max(p.r, p.y))
  }

  return pos.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r }))
}

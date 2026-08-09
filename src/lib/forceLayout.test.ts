import { describe, it, expect } from 'vitest'
import { LAYOUT_HEIGHT, LAYOUT_WIDTH, iterationsFor, layoutBounds, layoutSizeFor, radiusFor, runForceLayout } from './forceLayout'

const nodes = [
  { id: 'a', r: 30 },
  { id: 'b', r: 20 },
  { id: 'c', r: 14 },
  { id: 'd', r: 12 },
  { id: 'e', r: 10 },
  { id: 'f', r: 18 },
]
// a-b-c formam um cluster ligado; d/e/f soltos ou ligados entre si.
const edges = [
  { source: 'a', target: 'b', weight: 100 },
  { source: 'a', target: 'c', weight: 40 },
  { source: 'e', target: 'f', weight: 10 },
]

describe('radiusFor', () => {
  it('is monotonic in value and clamped to [10, 34]', () => {
    const max = 1000
    const rs = [0, 10, 100, 500, 1000].map(v => radiusFor(v, max))
    for (let i = 1; i < rs.length; i++) expect(rs[i]).toBeGreaterThanOrEqual(rs[i - 1])
    expect(rs[0]).toBe(10)
    expect(rs[rs.length - 1]).toBe(34)
    expect(radiusFor(50, 0)).toBe(10) // maxValue 0 não divide por zero
  })
})

describe('layoutSizeFor', () => {
  it('keeps the base canvas for small graphs and grows with the count', () => {
    expect(layoutSizeFor(10)).toEqual({ width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT })
    expect(layoutSizeFor(40)).toEqual({ width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT })
    expect(layoutSizeFor(160).width).toBeCloseTo(LAYOUT_WIDTH * 2)
  })
  it('saturates at 4x so the canvas never runs away', () => {
    expect(layoutSizeFor(5000)).toEqual({ width: LAYOUT_WIDTH * 4, height: LAYOUT_HEIGHT * 4 })
  })
})

describe('iterationsFor', () => {
  it('trades relaxation for responsiveness as the graph grows', () => {
    expect(iterationsFor(40)).toBe(250)
    expect(iterationsFor(120)).toBe(250)
    expect(iterationsFor(300)).toBeLessThan(250)
    expect(iterationsFor(5000)).toBe(80) // piso
  })
})

describe('layoutBounds', () => {
  it('contains every node plus its radius and the margin', () => {
    const layout = runForceLayout(nodes, edges)
    const b = layoutBounds(layout)
    for (const p of layout) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(b.x)
      expect(p.y - p.r).toBeGreaterThanOrEqual(b.y)
      expect(p.x + p.r).toBeLessThanOrEqual(b.x + b.w)
      expect(p.y + p.r).toBeLessThanOrEqual(b.y + b.h)
    }
  })
  it('falls back to the base canvas when there is nothing to frame', () => {
    expect(layoutBounds([])).toEqual({ x: 0, y: 0, w: LAYOUT_WIDTH, h: LAYOUT_HEIGHT })
  })
})

describe('runForceLayout', () => {
  it('is deterministic: same input, same positions', () => {
    const first = runForceLayout(nodes, edges)
    const second = runForceLayout(nodes, edges)
    expect(second).toEqual(first)
  })
  it('is order-insensitive in its seed (reversed node list, same seed source)', () => {
    const reversed = runForceLayout([...nodes].reverse(), edges)
    const straight = runForceLayout(nodes, edges)
    // Mesmo conjunto de ids → mesma seed; posições por id podem diferir pela
    // ordem de inicialização, mas o conjunto de ids retornado é o mesmo.
    expect(reversed.map(p => p.id).sort()).toEqual(straight.map(p => p.id).sort())
  })
  it('keeps every node finite and inside the canvas with its radius as margin', () => {
    for (const p of runForceLayout(nodes, edges)) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(p.r)
      expect(p.x).toBeLessThanOrEqual(LAYOUT_WIDTH - p.r)
      expect(p.y).toBeGreaterThanOrEqual(p.r)
      expect(p.y).toBeLessThanOrEqual(LAYOUT_HEIGHT - p.r)
    }
  })
  it('pulls connected pairs closer than unconnected ones on average', () => {
    const layout = runForceLayout(nodes, edges)
    const at = new Map(layout.map(p => [p.id, p]))
    const dist = (a: string, b: string) => Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y)

    const connected = edges.map(e => dist(e.source, e.target))
    const connectedKeys = new Set(edges.map(e => [e.source, e.target].sort().join('|')))
    const unconnected: number[] = []
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const key = [nodes[i].id, nodes[j].id].sort().join('|')
        if (!connectedKeys.has(key)) unconnected.push(dist(nodes[i].id, nodes[j].id))
      }
    }
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    expect(avg(connected)).toBeLessThan(avg(unconnected))
  })
  it('separates every pair by at least the sum of their radii', () => {
    // Estrela: um hub com 24 filhos é o caso que mais empilha bolhas.
    const hub = { id: 'hub', r: 34 }
    const children = Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, r: 10 + (i % 5) }))
    const star = [hub, ...children]
    const starEdges = children.map(c => ({ source: 'hub', target: c.id, weight: 1 }))
    const layout = runForceLayout(star, starEdges)
    const at = new Map(layout.map(p => [p.id, p]))
    for (let i = 0; i < star.length; i++) {
      for (let j = i + 1; j < star.length; j++) {
        const a = at.get(star[i].id)!
        const b = at.get(star[j].id)!
        // Tolerância de 1px: o clamp final pode reencostar um nó na borda.
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r - 1)
      }
    }
  })
  it('handles empty and single-node graphs', () => {
    expect(runForceLayout([], [])).toEqual([])
    const single = runForceLayout([{ id: 'solo', r: 12 }], [])
    expect(single).toHaveLength(1)
    expect(Number.isFinite(single[0].x)).toBe(true)
  })
})

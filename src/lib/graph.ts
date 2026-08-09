// Domain-agnostic graph primitives shared by the "Rede" views (finance and
// documents). Pure, side-effect free, no React.
//
// The functions here take `{ nodes, edges }` structurally rather than a nominal
// Graph type, so a domain's own interfaces (FinanceGraph, DocsGraph) flow in and
// out unchanged — a domain node keeps its extra fields through a filter.
// Everything domain-specific (how a graph is BUILT, what `value` means) stays in
// the domain's own module.

export interface GraphNodeBase<K extends string = string> {
  /** Prefixed by kind ('acc:<uuid>', 'pg:<uuid>'…) so ids coming from different
   *  tables can never collide inside one graph. */
  id: string
  kind: K
  refId: string
  label: string
  icon: string
  color: string
  /** Whatever the domain sizes nodes by (money, degree…). Drives the radius. */
  value: number
  /** Set by applySearch on neighbors of a match: rendered faded for context. */
  dimmed?: boolean
}

export interface GraphEdgeBase<EK extends string = string> {
  id: string
  source: string
  target: string
  weight: number
  kind: EK
}

/** Structural shape the helpers below operate on. */
export interface GraphShape<N, E> {
  nodes: N[]
  edges: E[]
}

// Node-value bounds of the UNfiltered graph — this feeds the range slider, so
// it must be computed before applyValueFilter (otherwise the slider's own
// selection would shrink its track on every drag).
export function graphValueBounds<N extends GraphNodeBase>(graph: GraphShape<N, unknown>): { min: number; max: number } {
  if (graph.nodes.length === 0) return { min: 0, max: 0 }
  let min = Infinity
  let max = -Infinity
  for (const n of graph.nodes) {
    if (n.value < min) min = n.value
    if (n.value > max) max = n.value
  }
  return { min, max }
}

// Drop nodes outside [minValue, maxValue] and any edge that lost an endpoint.
export function applyValueFilter<N extends GraphNodeBase, E extends GraphEdgeBase>(
  graph: GraphShape<N, E>,
  minValue: number,
  maxValue: number | null,
): GraphShape<N, E> {
  const keep = new Set(
    graph.nodes
      .filter(n => n.value >= minValue && (maxValue == null || n.value <= maxValue))
      .map(n => n.id),
  )
  if (keep.size === graph.nodes.length) return graph
  return {
    nodes: graph.nodes.filter(n => keep.has(n.id)),
    edges: graph.edges.filter(e => keep.has(e.source) && keep.has(e.target)),
  }
}

// Accent/case-insensitive normalization so "saude" finds "Saúde".
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Keep nodes whose label matches plus their direct neighbors; neighbors carry
// `dimmed` so the graph can fade them — context without clutter.
export function applySearch<N extends GraphNodeBase, E extends GraphEdgeBase>(
  graph: GraphShape<N, E>,
  search: string,
): GraphShape<N, E> {
  const term = normalizeSearch(search)
  if (!term) return graph
  const matched = new Set(
    graph.nodes.filter(n => normalizeSearch(n.label).includes(term)).map(n => n.id),
  )
  const neighbors = new Set<string>()
  for (const e of graph.edges) {
    if (matched.has(e.source)) neighbors.add(e.target)
    if (matched.has(e.target)) neighbors.add(e.source)
  }
  return {
    nodes: graph.nodes
      .filter(n => matched.has(n.id) || neighbors.has(n.id))
      .map(n => (matched.has(n.id) ? n : { ...n, dimmed: true })),
    edges: graph.edges.filter(e =>
      (matched.has(e.source) || neighbors.has(e.source))
      && (matched.has(e.target) || neighbors.has(e.target))),
  }
}

// Direct neighbors of a node with the connecting edge, heaviest first.
export function neighborsOf<N extends GraphNodeBase, E extends GraphEdgeBase>(
  graph: GraphShape<N, E>,
  nodeId: string,
): { node: N; edge: E }[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const out: { node: N; edge: E }[] = []
  for (const e of graph.edges) {
    const otherId = e.source === nodeId ? e.target : e.target === nodeId ? e.source : null
    if (!otherId) continue
    const node = byId.get(otherId)
    if (node) out.push({ node, edge: e })
  }
  return out.sort((a, b) => b.edge.weight - a.edge.weight)
}

// Neighbor count per node id. Every node gets an entry (0 for isolated ones).
// Assumes parallel edges were already collapsed by the builder, so an edge
// count IS a distinct-neighbor count.
export function degreeMap<N extends GraphNodeBase, E extends GraphEdgeBase>(
  graph: GraphShape<N, E>,
): Map<string, number> {
  const out = new Map<string, number>(graph.nodes.map(n => [n.id, 0]))
  for (const e of graph.edges) {
    if (out.has(e.source)) out.set(e.source, (out.get(e.source) ?? 0) + 1)
    if (out.has(e.target)) out.set(e.target, (out.get(e.target) ?? 0) + 1)
  }
  return out
}

// Drop nodes with no edges. Edges are untouched — every edge still has both
// endpoints, since only zero-degree nodes go.
export function dropIsolated<N extends GraphNodeBase, E extends GraphEdgeBase>(
  graph: GraphShape<N, E>,
): GraphShape<N, E> {
  const linked = new Set<string>()
  for (const e of graph.edges) {
    linked.add(e.source)
    linked.add(e.target)
  }
  if (linked.size === graph.nodes.length) return graph
  return { nodes: graph.nodes.filter(n => linked.has(n.id)), edges: graph.edges }
}

// Keep only the `max` highest-value nodes (ties broken by id, so the cut is
// deterministic across renders) and drop edges that lost an endpoint.
//
// The force layout is O(n²) per iteration: fine for the dozens of nodes a
// finance graph has, not for the hundreds of cards a document graph can reach.
// Callers surface the truncation in the UI — a silently smaller graph reads as
// "that's all there is".
export function capGraph<N extends GraphNodeBase, E extends GraphEdgeBase>(
  graph: GraphShape<N, E>,
  max: number,
): GraphShape<N, E> {
  if (graph.nodes.length <= max) return graph
  const kept = [...graph.nodes]
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, max)
  const keep = new Set(kept.map(n => n.id))
  return {
    // Preserve the caller's original node order; only membership changes.
    nodes: graph.nodes.filter(n => keep.has(n.id)),
    edges: graph.edges.filter(e => keep.has(e.source) && keep.has(e.target)),
  }
}

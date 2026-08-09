// Pure model behind the documents "Rede" section: turns pages, kanban boards
// and cards, quick notes and collaborators into a node/edge graph. Framework
// agnostic and side-effect free — the Supabase loader lives in docsGraphData.ts.
//
// Why these edges: the app has NO page-to-page links (no wiki-links, no
// backlinks, no link table), so a page-only graph would just redraw the sidebar
// tree. Everything below is relational and cheap to read; the one connection
// that would need parsing page content (a `projectCard` block embedded in a
// note) is deliberately out of v1.
//
// The signed-in user is never a node. They own nearly everything, so an "me"
// node wired to the whole graph would wreck both the force layout and the
// degree ranking.

import type {
  Page, PageType, ProfileBadge, ProjectBoard, ProjectCard, ProjectCardPriority, QuickNote,
} from '../types'
import { avatarColor } from './avatar'
import { degreeMap, type GraphEdgeBase, type GraphNodeBase, type GraphShape } from './graph'

export type DocsNodeKind = 'page' | 'board' | 'card' | 'note' | 'person'

export type DocsEdgeKind =
  | 'parent-page'    // page → subpage
  | 'board-card'     // board → its cards
  | 'card-parent'    // card → subtask
  | 'card-depends'   // card → card it depends on
  | 'card-page'      // card → linked page
  | 'note-link'      // quick note → page or card
  | 'assignee'       // card → person
  | 'page-share'     // page → person
  | 'board-share'    // board → person

export interface DocsNode extends GraphNodeBase<DocsNodeKind> {
  /** Distinct neighbours. `value` mirrors it — the graph sizes nodes by how
   *  connected they are, not by any amount. */
  degree: number
}

export interface DocsEdge extends GraphEdgeBase<DocsEdgeKind> {
  /** Every relation between this pair. Two items can be linked in more than one
   *  way (a card that links a page AND a note pointing at both); those collapse
   *  into one edge so the degree stays a neighbour count. */
  kinds: DocsEdgeKind[]
}

export type DocsGraph = GraphShape<DocsNode, DocsEdge>

export interface DocsGraphSource {
  /** Flat list — the panel already flattens the PagesContext tree. */
  pages: Page[]
  boards: ProjectBoard[]
  columns: { id: string; board_id: string; name: string }[]
  cards: ProjectCard[]
  notes: QuickNote[]
  pageShares: { page_id: string; shared_with_user_id: string }[]
  boardShares: { board_id: string; shared_with_user_id: string }[]
  /** Keyed by user id; the signed-in user must NOT be in here. */
  profiles: Map<string, ProfileBadge>
}

export interface DocsGraphFilters {
  search: string
  kinds: Record<DocsNodeKind, boolean>
  boardId: string | null
  minDegree: number
  maxDegree: number | null
  hideIsolated: boolean
}

export const DEFAULT_DOCS_FILTERS: DocsGraphFilters = {
  search: '',
  kinds: { page: true, board: true, card: true, note: true, person: true },
  boardId: null,
  minDegree: 0,
  maxDegree: null,
  hideIsolated: false,
}

// Force layout is O(n²); a document graph can reach hundreds of cards where a
// finance one had dozens. Callers surface the truncation — see capGraph.
export const MAX_DOCS_NODES = 300

export const pageNodeId = (id: string) => `pg:${id}`
export const boardNodeId = (id: string) => `bd:${id}`
export const cardNodeId = (id: string) => `cd:${id}`
export const noteNodeId = (id: string) => `qn:${id}`
export const personNodeId = (id: string) => `ps:${id}`

// Page has no colour column, so type carries the hue: notes blue, drawings
// purple, both teal, todo amber.
const PAGE_TYPE_COLORS: Record<PageType, string> = {
  note: '#3b82f6',
  drawing: '#a855f7',
  both: '#14b8a6',
  todo: '#f59e0b',
}

// Cards have no icon either; priority reads at a glance, done wins over it.
const PRIORITY_ICONS: Record<ProjectCardPriority, string> = {
  low: '🔹',
  medium: '🔸',
  high: '🔺',
  urgent: '🔴',
}

const NOTE_COLOR_VAR = (color: QuickNote['color']) => `var(--sticky-${color}-border)`

/** First non-empty line of a sticky note, trimmed to fit a graph label. */
export function quickNoteLabel(content: string, max = 40): string {
  const line = (content ?? '').split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// Edge colour/priority order: when a pair is connected in several ways, the
// first kind in this list wins as the primary (it is the one drawn).
const EDGE_PRIORITY: DocsEdgeKind[] = [
  'parent-page', 'board-card', 'card-parent', 'card-depends',
  'card-page', 'note-link', 'assignee', 'page-share', 'board-share',
]

interface RawEdge { a: string; b: string; kind: DocsEdgeKind }

function collapseEdges(raw: RawEdge[], nodeIds: Set<string>): DocsEdge[] {
  const byPair = new Map<string, { source: string; target: string; kinds: DocsEdgeKind[] }>()
  for (const { a, b, kind } of raw) {
    // Self-links (a card depending on itself) carry no information and would
    // inflate the degree of exactly one node.
    if (a === b) continue
    // Dangling endpoints happen for real: RLS can hide a card listed in
    // depends_on, and linked_page_id can point at a deleted page.
    if (!nodeIds.has(a) || !nodeIds.has(b)) continue
    const [source, target] = a < b ? [a, b] : [b, a]
    const key = `${source}|${target}`
    const cur = byPair.get(key)
    if (cur) {
      if (!cur.kinds.includes(kind)) cur.kinds.push(kind)
    } else {
      byPair.set(key, { source, target, kinds: [kind] })
    }
  }
  return [...byPair.entries()].map(([id, { source, target, kinds }]) => {
    const ordered = [...kinds].sort((x, y) => EDGE_PRIORITY.indexOf(x) - EDGE_PRIORITY.indexOf(y))
    return { id, source, target, weight: ordered.length, kinds: ordered, kind: ordered[0] }
  })
}

/**
 * Build the graph from the loaded data.
 *
 * `filters.kinds` and `filters.boardId` are applied HERE, before the degree is
 * counted — hiding collaborators has to shrink the pages they were attached to.
 * Applying them later would leave the node radius claiming connections the user
 * can no longer see.
 */
export function buildDocsGraph(
  source: DocsGraphSource,
  filters: Pick<DocsGraphFilters, 'kinds' | 'boardId'> = { kinds: DEFAULT_DOCS_FILTERS.kinds, boardId: null },
): DocsGraph {
  const { kinds, boardId } = filters
  const boardOf = new Map(source.boards.map(b => [b.id, b]))
  const inScope = (id: string | null | undefined) => boardId == null || id === boardId

  const boards = kinds.board ? source.boards.filter(b => inScope(b.id)) : []
  const cards = kinds.card ? source.cards.filter(c => inScope(c.board_id)) : []
  const pages = kinds.page ? source.pages : []
  const notes = kinds.note ? source.notes : []

  const nodes: DocsNode[] = []
  const base = { degree: 0, value: 0 }

  for (const p of pages) {
    nodes.push({
      ...base,
      id: pageNodeId(p.id), kind: 'page', refId: p.id,
      label: p.title || '', icon: p.icon || '📄', color: PAGE_TYPE_COLORS[p.type] ?? PAGE_TYPE_COLORS.note,
    })
  }
  for (const b of boards) {
    nodes.push({
      ...base,
      id: boardNodeId(b.id), kind: 'board', refId: b.id,
      label: b.name, icon: b.icon || '📋', color: b.color || '#64748b',
    })
  }
  for (const c of cards) {
    nodes.push({
      ...base,
      id: cardNodeId(c.id), kind: 'card', refId: c.id,
      label: c.title,
      icon: c.completed ? '✅' : PRIORITY_ICONS[c.priority] ?? '🔸',
      // Cor do quadro dono: os cards se agrupam visualmente por projeto.
      color: boardOf.get(c.board_id)?.color || '#94a3b8',
    })
  }
  for (const n of notes) {
    nodes.push({
      ...base,
      id: noteNodeId(n.id), kind: 'note', refId: n.id,
      label: quickNoteLabel(n.content), icon: '🗒️', color: NOTE_COLOR_VAR(n.color),
    })
  }

  // Pessoas só entram se aparecerem numa relação visível com o escopo atual.
  const raw: RawEdge[] = []
  const pageIds = new Set(pages.map(p => p.id))
  const cardIds = new Set(cards.map(c => c.id))
  const boardIds = new Set(boards.map(b => b.id))
  const peopleUsed = new Set<string>()
  const usePerson = (userId: string | null | undefined): string | null => {
    if (!kinds.person || !userId) return null
    if (!source.profiles.has(userId)) return null
    peopleUsed.add(userId)
    return personNodeId(userId)
  }

  for (const p of pages) {
    if (p.parent_id && pageIds.has(p.parent_id)) {
      raw.push({ a: pageNodeId(p.parent_id), b: pageNodeId(p.id), kind: 'parent-page' })
    }
  }
  for (const c of cards) {
    if (boardIds.has(c.board_id)) raw.push({ a: boardNodeId(c.board_id), b: cardNodeId(c.id), kind: 'board-card' })
    if (c.linked_page_id && pageIds.has(c.linked_page_id)) {
      raw.push({ a: cardNodeId(c.id), b: pageNodeId(c.linked_page_id), kind: 'card-page' })
    }
    if (c.parent_card_id && cardIds.has(c.parent_card_id)) {
      raw.push({ a: cardNodeId(c.parent_card_id), b: cardNodeId(c.id), kind: 'card-parent' })
    }
    for (const dep of c.depends_on ?? []) {
      if (cardIds.has(dep)) raw.push({ a: cardNodeId(c.id), b: cardNodeId(dep), kind: 'card-depends' })
    }
    const assignee = usePerson(c.assignee_user_id)
    if (assignee) raw.push({ a: cardNodeId(c.id), b: assignee, kind: 'assignee' })
  }
  for (const n of notes) {
    for (const item of n.linked_items ?? []) {
      if (item.type === 'page' && pageIds.has(item.targetId)) {
        raw.push({ a: noteNodeId(n.id), b: pageNodeId(item.targetId), kind: 'note-link' })
      } else if (item.type === 'card' && cardIds.has(item.targetId)) {
        raw.push({ a: noteNodeId(n.id), b: cardNodeId(item.targetId), kind: 'note-link' })
      }
    }
  }
  for (const s of source.pageShares) {
    if (!pageIds.has(s.page_id)) continue
    const person = usePerson(s.shared_with_user_id)
    if (person) raw.push({ a: pageNodeId(s.page_id), b: person, kind: 'page-share' })
  }
  for (const s of source.boardShares) {
    if (!boardIds.has(s.board_id)) continue
    const person = usePerson(s.shared_with_user_id)
    if (person) raw.push({ a: boardNodeId(s.board_id), b: person, kind: 'board-share' })
  }

  for (const userId of peopleUsed) {
    const profile = source.profiles.get(userId)!
    nodes.push({
      ...base,
      id: personNodeId(userId), kind: 'person', refId: userId,
      label: profile.display_name || profile.email,
      icon: profile.avatar_emoji || '👤',
      color: profile.avatar_color || avatarColor(profile.email),
    })
  }

  const nodeIds = new Set(nodes.map(n => n.id))
  const edges = collapseEdges(raw, nodeIds)

  const graph: DocsGraph = { nodes, edges }
  const degrees = degreeMap(graph)
  for (const node of nodes) {
    node.degree = degrees.get(node.id) ?? 0
    node.value = node.degree
  }
  return graph
}

// ─── Stats & rankings ────────────────────────────────────────────────────────

/** Neighbour counts by kind, for the detail panel's stat grid. */
export function neighborKindCounts(graph: DocsGraph, nodeId: string): Record<DocsNodeKind, number> {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const out: Record<DocsNodeKind, number> = { page: 0, board: 0, card: 0, note: 0, person: 0 }
  for (const e of graph.edges) {
    const otherId = e.source === nodeId ? e.target : e.target === nodeId ? e.source : null
    if (!otherId) continue
    const other = byId.get(otherId)
    if (other) out[other.kind] += 1
  }
  return out
}

/** Chain of ancestor pages, root first — the breadcrumb in a page's detail. */
export function pageAncestors(pages: Page[], pageId: string): Page[] {
  const byId = new Map(pages.map(p => [p.id, p]))
  const out: Page[] = []
  const seen = new Set<string>([pageId])
  let cur = byId.get(pageId)?.parent_id ?? null
  while (cur && !seen.has(cur)) {
    const parent = byId.get(cur)
    if (!parent) break
    out.unshift(parent)
    seen.add(cur)
    cur = parent.parent_id
  }
  return out
}

/** Most connected nodes, optionally of a single kind. Ties broken by label. */
export function rankByDegree(graph: DocsGraph, n: number, kind?: DocsNodeKind): DocsNode[] {
  return graph.nodes
    .filter(node => (kind ? node.kind === kind : true) && node.degree > 0)
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
    .slice(0, n)
}

/** Nodes nothing points at — the actionable list (orphan pages, loose cards). */
export function listIsolated(graph: DocsGraph, n: number): DocsNode[] {
  return graph.nodes
    .filter(node => node.degree === 0)
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, n)
}

import type { ProjectCard } from '../types'

// Pure date / layout helpers for the projects timeline (Gantt) view.
// All dates are 'YYYY-MM-DD' strings; arithmetic is done in UTC to avoid DST drift.

const DAY_MS = 86_400_000

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function isoFromUTC(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Whole days from `a` to `b` (b - a). Negative if b is before a. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS)
}

export function addDays(iso: string, n: number): string {
  return isoFromUTC(toUTC(iso) + n * DAY_MS)
}

/** First day of the month for `iso`. */
export function startOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/** Last day of the month for `iso`. */
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return isoFromUTC(Date.UTC(y, m, 0)) // day 0 of next month = last day of this month
}

/** Monday on or before `iso`. */
export function startOfWeek(iso: string): string {
  const dow = new Date(toUTC(iso)).getUTCDay() // 0=Sun..6=Sat
  const back = (dow + 6) % 7 // days since Monday
  return addDays(iso, -back)
}

/** ISO-8601 week number. */
export function isoWeek(iso: string): number {
  const date = new Date(toUTC(iso))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thursday of current week
  const thursday = date.getTime()
  date.setUTCMonth(0, 1)
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay()) + 7) % 7)
  }
  return 1 + Math.ceil((thursday - date.getTime()) / (7 * DAY_MS))
}

// ─── Progress ─────────────────────────────────────────────────────────────────

/** Progress 0–100 derived from the card's completion / checklist. */
export function cardProgress(card: ProjectCard): number {
  if (card.completed) return 100
  const list = card.checklist ?? []
  if (list.length === 0) return 0
  const done = list.filter(i => i.completed).length
  return Math.round((done / list.length) * 100)
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

export interface GanttNode {
  card: ProjectCard
  children: GanttNode[]
}

const byOrder = (a: ProjectCard, b: ProjectCard) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

/** Build the parent/child forest. Cards whose parent is missing from the set become roots. */
export function buildTree(cards: ProjectCard[]): GanttNode[] {
  const ids = new Set(cards.map(c => c.id))
  const childrenOf = new Map<string, ProjectCard[]>()
  const roots: ProjectCard[] = []
  for (const c of cards) {
    if (c.parent_card_id && ids.has(c.parent_card_id)) {
      const arr = childrenOf.get(c.parent_card_id) ?? []
      arr.push(c)
      childrenOf.set(c.parent_card_id, arr)
    } else {
      roots.push(c)
    }
  }
  const build = (card: ProjectCard): GanttNode => ({
    card,
    children: (childrenOf.get(card.id) ?? []).sort(byOrder).map(build),
  })
  return roots.sort(byOrder).map(build)
}

export interface FlatRow {
  card: ProjectCard
  depth: number
  hasChildren: boolean
  collapsed: boolean
}

/** Flatten the forest into rendering order, hiding descendants of collapsed nodes. */
export function flattenTree(nodes: GanttNode[], collapsed: Set<string>, depth = 0): FlatRow[] {
  const out: FlatRow[] = []
  for (const node of nodes) {
    const isCollapsed = collapsed.has(node.card.id)
    out.push({ card: node.card, depth, hasChildren: node.children.length > 0, collapsed: isCollapsed })
    if (node.children.length > 0 && !isCollapsed) {
      out.push(...flattenTree(node.children, collapsed, depth + 1))
    }
  }
  return out
}

// ─── Bars ──────────────────────────────────────────────────────────────────────

export interface GanttBar {
  start: string // inclusive
  end: string   // inclusive
  isMilestone: boolean
  progress: number // 0–100
}

function leafBar(card: ProjectCard): GanttBar | null {
  const { start_date, due_date } = card
  if (start_date && due_date) {
    const [s, e] = diffDays(start_date, due_date) < 0 ? [due_date, start_date] : [start_date, due_date]
    return { start: s, end: e, isMilestone: false, progress: cardProgress(card) }
  }
  if (due_date) return { start: due_date, end: due_date, isMilestone: true, progress: cardProgress(card) }
  if (start_date) return { start: start_date, end: start_date, isMilestone: true, progress: cardProgress(card) }
  return null
}

/**
 * Bar for a node. Parents roll up to span min(start)→max(end) across BOTH their
 * own dates and every descendant (so the bar reflects the full schedule it
 * encloses, at any nesting depth), with a duration-weighted progress derived
 * from the children. Leaves use their own start/due dates.
 */
export function nodeBar(node: GanttNode): GanttBar | null {
  const own = leafBar(node.card)
  if (node.children.length === 0) return own

  const childBars = node.children.map(nodeBar).filter((b): b is GanttBar => b != null)
  if (childBars.length === 0) return own

  // Seed the span with the node's own dates so a parent always extends to cover
  // its own schedule plus all descendants — recursion handles deeper nesting.
  const spanBars = own ? [own, ...childBars] : childBars
  let start = spanBars[0].start
  let end = spanBars[0].end
  for (const b of spanBars) {
    if (diffDays(b.start, start) > 0) start = b.start
    if (diffDays(end, b.end) > 0) end = b.end
  }

  // Progress stays duration-weighted across children only.
  let weighted = 0
  let weight = 0
  for (const b of childBars) {
    const days = Math.max(1, diffDays(b.start, b.end) + 1)
    weighted += b.progress * days
    weight += days
  }
  return { start, end, isMilestone: false, progress: weight > 0 ? Math.round(weighted / weight) : 0 }
}

// ─── Links (dependency + parent connectors) ────────────────────────────────────

export type GanttLinkKind = 'dep' | 'parent'

export interface GanttLink {
  from: string // predecessor / parent card id
  to: string   // successor / child card id
  kind: GanttLinkKind
}

/**
 * Build the connector list from card relationships:
 * - `depends_on` → `dep` links (predecessor → successor).
 * - `parent_card_id` → `parent` links (parent → child).
 * Only links whose both endpoints exist in the set are kept. When the same pair
 * is both a parent and a dependency, the more informative `dep` link wins.
 */
export function buildLinks(cards: ProjectCard[]): GanttLink[] {
  const ids = new Set(cards.map(c => c.id))
  const seen = new Set<string>()
  const links: GanttLink[] = []

  for (const c of cards) {
    for (const predId of c.depends_on ?? []) {
      if (!ids.has(predId) || predId === c.id) continue
      const key = `${predId}->${c.id}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ from: predId, to: c.id, kind: 'dep' })
    }
  }

  for (const c of cards) {
    const parentId = c.parent_card_id
    if (!parentId || !ids.has(parentId) || parentId === c.id) continue
    const key = `${parentId}->${c.id}`
    if (seen.has(key)) continue // already linked as a dependency
    seen.add(key)
    links.push({ from: parentId, to: c.id, kind: 'parent' })
  }

  return links
}

export interface LinkPathArgs {
  x1: number // predecessor anchor x
  y1: number // predecessor anchor y (row center)
  x2: number // successor anchor x
  y2: number // successor anchor y (row center)
  rowH: number
  gap?: number
}

/**
 * SVG path for an elbow connector between two bar anchors. When the successor
 * starts well after the predecessor anchor, a simple forward elbow is used.
 * When the bars overlap (successor starts at/behind the predecessor anchor —
 * common for parent rollups), the path routes out to the right, down into the
 * gap between the rows, then back to the successor instead of drawing backwards
 * behind the bars.
 */
export function linkPath({ x1, y1, x2, y2, rowH, gap = 9 }: LinkPathArgs): string {
  if (x2 - x1 >= gap * 2) {
    const elbow = x2 - gap
    return `M ${x1} ${y1} H ${elbow} V ${y2} H ${x2}`
  }
  const out = x1 + gap
  const back = x2 - gap
  const midY = y1 + (y2 >= y1 ? rowH / 2 : -rowH / 2)
  return `M ${x1} ${y1} H ${out} V ${midY} H ${back} V ${y2} H ${x2}`
}

// ─── Chart range ─────────────────────────────────────────────────────────────

export interface DateRange { start: string; end: string }

/** Min start → max end across the given bars, or null when there are none. */
export function barsRange(bars: GanttBar[]): DateRange | null {
  if (bars.length === 0) return null
  let start = bars[0].start
  let end = bars[0].end
  for (const b of bars) {
    if (diffDays(b.start, start) > 0) start = b.start
    if (diffDays(end, b.end) > 0) end = b.end
  }
  return { start, end }
}

// ─── Header segments ───────────────────────────────────────────────────────────

export interface Segment {
  offset: number // days from range start
  days: number   // span in days
  key: string
  date: string   // representative ISO date (first day of the segment)
}

/** Month segments covering [rangeStart, rangeEnd] inclusive. */
export function monthSegments(rangeStart: string, rangeEnd: string): Segment[] {
  const out: Segment[] = []
  let cursor = startOfMonth(rangeStart)
  while (diffDays(cursor, rangeEnd) >= 0) {
    const segStart = diffDays(rangeStart, cursor) < 0 ? rangeStart : cursor
    const monthEnd = endOfMonth(cursor)
    const segEnd = diffDays(monthEnd, rangeEnd) < 0 ? monthEnd : rangeEnd
    out.push({ offset: diffDays(rangeStart, segStart), days: diffDays(segStart, segEnd) + 1, key: cursor, date: cursor })
    cursor = addDays(monthEnd, 1)
  }
  return out
}

/** Year segments covering [rangeStart, rangeEnd] inclusive. */
export function yearSegments(rangeStart: string, rangeEnd: string): Segment[] {
  const out: Segment[] = []
  let year = Number(rangeStart.slice(0, 4))
  const endYear = Number(rangeEnd.slice(0, 4))
  while (year <= endYear) {
    const yStart = diffDays(rangeStart, `${year}-01-01`) < 0 ? rangeStart : `${year}-01-01`
    const yEnd = diffDays(`${year}-12-31`, rangeEnd) < 0 ? `${year}-12-31` : rangeEnd
    out.push({ offset: diffDays(rangeStart, yStart), days: diffDays(yStart, yEnd) + 1, key: String(year), date: yStart })
    year++
  }
  return out
}

/** Week segments (Mondays) covering [rangeStart, rangeEnd] inclusive. */
export function weekSegments(rangeStart: string, rangeEnd: string): Segment[] {
  const out: Segment[] = []
  let cursor = startOfWeek(rangeStart)
  while (diffDays(cursor, rangeEnd) >= 0) {
    const segStart = diffDays(rangeStart, cursor) < 0 ? rangeStart : cursor
    const weekEnd = addDays(cursor, 6)
    const segEnd = diffDays(weekEnd, rangeEnd) < 0 ? weekEnd : rangeEnd
    out.push({ offset: diffDays(rangeStart, segStart), days: diffDays(segStart, segEnd) + 1, key: cursor, date: cursor })
    cursor = addDays(cursor, 7)
  }
  return out
}

/** Day segments covering [rangeStart, rangeEnd] inclusive. */
export function daySegments(rangeStart: string, rangeEnd: string): Segment[] {
  const out: Segment[] = []
  const total = diffDays(rangeStart, rangeEnd)
  for (let i = 0; i <= total; i++) {
    const date = addDays(rangeStart, i)
    out.push({ offset: i, days: 1, key: date, date })
  }
  return out
}

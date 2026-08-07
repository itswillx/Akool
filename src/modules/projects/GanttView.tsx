import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight, GanttChartSquare, Plus, Share2 } from 'lucide-react'
import type { ProjectCard, ProjectColumn, ProjectCardPriority } from '../../types'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  buildTree, flattenTree, nodeBar, barsRange, diffDays, addDays, startOfMonth, endOfMonth,
  monthSegments, weekSegments, daySegments, yearSegments, isoWeek, buildLinks, linkPath,
  type GanttBar, type GanttNode, type Segment,
} from '../../lib/ganttLayout'

type Zoom = 'day' | 'week' | 'month'
const PX_PER_DAY: Record<Zoom, number> = { day: 34, week: 16, month: 5 }
const ZOOM_KEY = 'projects_gantt_zoom:'

const pad = (n: number) => String(n).padStart(2, '0')
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface GanttViewProps {
  columns: ProjectColumn[]
  cards: ProjectCard[]
  canEdit: boolean
  isMobile?: boolean
  priorityLabel: (p: ProjectCardPriority) => string
  boardId: string
  onCardClick: (c: ProjectCard) => void
  onAddCard: (columnId: string) => void
  onCardReschedule?: (cardId: string, dates: { start_date: string | null; due_date: string | null }) => void
}

type DragMode = 'move' | 'start' | 'end'

export default function GanttView({ columns, cards, canEdit, isMobile, priorityLabel, boardId, onCardClick, onAddCard, onCardReschedule }: GanttViewProps) {
  const { t, lang } = useLanguage()
  const scrollRef = useRef<HTMLDivElement>(null)

  const ROW_H = isMobile ? 46 : 38
  const HEADER_H = 48
  const NAME_W = isMobile ? 150 : 188
  const META_W = isMobile ? 0 : 152 // start + progress columns (desktop only)
  const LEFT_W = NAME_W + META_W

  const [zoom, setZoom] = useState<Zoom>(() => {
    const stored = localStorage.getItem(ZOOM_KEY + boardId)
    if (stored === 'day' || stored === 'week' || stored === 'month') return stored
    return 'week'
  })
  const [showDeps, setShowDeps] = useState(!isMobile)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; mode: DragMode; days: number } | null>(null)
  const dragState = useRef<{ id: string; mode: DragMode; startX: number; startDate: string | null; dueDate: string | null; days: number; moved: boolean } | null>(null)
  const draggedRef = useRef(false)

  useEffect(() => { localStorage.setItem(ZOOM_KEY + boardId, zoom) }, [zoom, boardId])

  const pxPerDay = PX_PER_DAY[zoom]
  const today = useMemo(() => todayISO(), [])

  const beginDrag = (e: ReactPointerEvent, card: ProjectCard, mode: DragMode) => {
    if (!canEdit || isMobile || !onCardReschedule) return
    e.stopPropagation()
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    dragState.current = { id: card.id, mode, startX: e.clientX, startDate: card.start_date, dueDate: card.due_date, days: 0, moved: false }
    setDrag({ id: card.id, mode, days: 0 })
  }

  const moveDrag = (e: ReactPointerEvent) => {
    const d = dragState.current
    if (!d) return
    const days = Math.round((e.clientX - d.startX) / pxPerDay)
    if (days !== d.days) {
      d.days = days
      if (days !== 0) d.moved = true
      setDrag({ id: d.id, mode: d.mode, days })
    }
  }

  const endDrag = (e: ReactPointerEvent) => {
    const d = dragState.current
    if (!d) return
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (d.moved && d.days !== 0 && onCardReschedule) {
      let start = d.startDate
      let due = d.dueDate
      if (d.mode === 'move') {
        start = d.startDate ? addDays(d.startDate, d.days) : null
        due = d.dueDate ? addDays(d.dueDate, d.days) : null
      } else if (d.mode === 'start' && d.startDate) {
        start = addDays(d.startDate, d.days)
        if (d.dueDate && diffDays(start, d.dueDate) < 0) start = d.dueDate
      } else if (d.mode === 'end' && d.dueDate) {
        due = addDays(d.dueDate, d.days)
        if (d.startDate && diffDays(d.startDate, due) < 0) due = d.startDate
      }
      draggedRef.current = true
      window.setTimeout(() => { draggedRef.current = false }, 300)
      onCardReschedule(d.id, { start_date: start, due_date: due })
    }
    dragState.current = null
    setDrag(null)
  }

  const columnColor = useMemo(() => {
    const m = new Map<string, string>()
    columns.forEach(c => m.set(c.id, c.color))
    return m
  }, [columns])
  const cardColor = (c: ProjectCard) => columnColor.get(c.column_id) ?? '#6366f1'

  const tree = useMemo<GanttNode[]>(() => buildTree(cards), [cards])

  const barById = useMemo(() => {
    const m = new Map<string, GanttBar | null>()
    const walk = (n: GanttNode) => { m.set(n.card.id, nodeBar(n)); n.children.forEach(walk) }
    tree.forEach(walk)
    return m
  }, [tree])

  const range = useMemo(() => {
    const bars: GanttBar[] = []
    barById.forEach(b => { if (b) bars.push(b) })
    const r = barsRange(bars)
    if (!r) return null
    const startMin = diffDays(today, r.start) < 0 ? r.start : today
    const endMax = diffDays(today, r.end) < 0 ? today : r.end
    return { start: startOfMonth(startMin), end: endOfMonth(endMax) }
  }, [barById, today])

  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed])
  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r, i) => m.set(r.card.id, i))
    return m
  }, [rows])
  const links = useMemo(() => buildLinks(cards), [cards])

  const totalDays = range ? diffDays(range.start, range.end) + 1 : 0
  const timelineWidth = totalDays * pxPerDay
  const dateToX = (d: string) => (range ? diffDays(range.start, d) * pxPerDay : 0)

  const bottomSegments: Segment[] = useMemo(() => {
    if (!range) return []
    if (zoom === 'day') return daySegments(range.start, range.end)
    if (zoom === 'week') return weekSegments(range.start, range.end)
    return monthSegments(range.start, range.end)
  }, [range, zoom])
  const topSegments: Segment[] = useMemo(() => {
    if (!range) return []
    if (zoom === 'month') return yearSegments(range.start, range.end)
    return monthSegments(range.start, range.end)
  }, [range, zoom])

  const topLabel = (seg: Segment) => {
    if (zoom === 'month') return seg.date.slice(0, 4)
    const d = new Date(`${seg.date}T00:00:00`)
    return d.toLocaleDateString(lang, { month: 'long', year: 'numeric' })
  }
  const bottomLabel = (seg: Segment) => {
    if (zoom === 'week') return `${t('projects_gantt_week_abbr')}${isoWeek(seg.date)}`
    const d = new Date(`${seg.date}T00:00:00`)
    if (zoom === 'month') return d.toLocaleDateString(lang, { month: 'short' })
    return String(d.getDate())
  }
  const fmtShort = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: '2-digit' })

  // Scroll so "today" is visible when the chart (re)mounts or zoom changes.
  useEffect(() => {
    if (!range || !scrollRef.current) return
    const x = dateToX(today)
    if (x > 0) scrollRef.current.scrollLeft = Math.max(0, x - 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, boardId, range?.start])

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const firstColumnId = columns[0]?.id

  // ─── Empty state ──────────────────────────────────────────────────────────────
  if (!range) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <GanttChartSquare size={28} color="#6366f1" />
        </div>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{t('projects_gantt_empty_title')}</h3>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-muted)', maxWidth: 360 }}>{t('projects_gantt_empty_desc')}</p>
        {canEdit && firstColumnId && (
          <button onClick={() => onAddCard(firstColumnId)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            <Plus size={14} />{t('projects_add_card')}
          </button>
        )}
      </div>
    )
  }

  const todayX = dateToX(today)
  const showTodayLine = todayX >= 0 && todayX <= timelineWidth
  const rowsHeight = rows.length * ROW_H

  const zoomBtn = (z: Zoom, label: string) => (
    <button key={z} onClick={() => setZoom(z)} style={{ padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: zoom === z ? 600 : 400, backgroundColor: zoom === z ? '#6366f1' : 'var(--color-bg)', color: zoom === z ? '#fff' : 'var(--color-text-muted)' }}>
      {label}
    </button>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          {zoomBtn('day', t('projects_gantt_zoom_day'))}
          {zoomBtn('week', t('projects_gantt_zoom_week'))}
          {zoomBtn('month', t('projects_gantt_zoom_month'))}
        </div>
        <button
          onClick={() => setShowDeps(v => !v)}
          title={t('projects_gantt_show_deps')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: showDeps ? '#6366f11f' : 'var(--color-bg)', color: showDeps ? '#6366f1' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <Share2 size={13} />{!isMobile && t('projects_gantt_show_deps')}
        </button>
      </div>

      {/* Chart */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', position: 'relative', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ display: 'flex', width: LEFT_W + timelineWidth, minHeight: '100%' }}>
          {/* Frozen left pane */}
          <div style={{ width: LEFT_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--color-bg)', borderRight: '1px solid var(--color-border)' }}>
            <div style={{ height: HEADER_H, position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' }}>
              <div style={{ width: NAME_W, padding: '0 12px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('projects_card_title')}</div>
              {!isMobile && (
                <>
                  <div style={{ width: 80, fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('projects_start_date')}</div>
                  <div style={{ width: 72, fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('projects_overview_progress')}</div>
                </>
              )}
            </div>
            {rows.map(row => {
              const bar = barById.get(row.card.id)
              return (
                <div
                  key={row.card.id}
                  onClick={() => onCardClick(row.card)}
                  style={{ height: ROW_H, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', opacity: row.card.completed ? 0.6 : 1 }}
                >
                  <div style={{ width: NAME_W, display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 8 + row.depth * 16, paddingRight: 8, minWidth: 0 }}>
                    {row.hasChildren ? (
                      <button onClick={e => { e.stopPropagation(); toggleCollapse(row.card.id) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0, flexShrink: 0 }}>
                        {row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                    ) : <span style={{ width: 14, flexShrink: 0 }} />}
                    <span style={{ fontSize: 13, fontWeight: row.hasChildren ? 600 : 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: row.card.completed ? 'line-through' : 'none' }}>
                      {row.card.title || t('projects_new_card')}
                    </span>
                  </div>
                  {!isMobile && (
                    <>
                      <div style={{ width: 80, fontSize: 12, color: 'var(--color-text-muted)' }}>{row.card.start_date ? fmtShort(row.card.start_date) : '–'}</div>
                      <div style={{ width: 72, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--color-hover)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${bar?.progress ?? 0}%`, background: (bar?.progress ?? 0) >= 100 ? '#22c55e' : '#6366f1' }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', width: 26, textAlign: 'right' }}>{bar?.progress ?? 0}%</span>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Timeline pane */}
          <div style={{ position: 'relative', width: timelineWidth, flexShrink: 0 }}>
            {/* Grid lines (behind bars) */}
            <svg width={timelineWidth} height={HEADER_H + rowsHeight} style={{ position: 'absolute', top: 0, left: 0, zIndex: 0, pointerEvents: 'none' }}>
              {bottomSegments.map(seg => (
                <line key={seg.key} x1={seg.offset * pxPerDay} y1={0} x2={seg.offset * pxPerDay} y2={HEADER_H + rowsHeight} stroke="var(--color-border)" strokeWidth={1} opacity={0.5} />
              ))}
            </svg>

            {/* Header */}
            <div style={{ height: HEADER_H, position: 'sticky', top: 0, zIndex: 2, background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ position: 'relative', height: 24, borderBottom: '1px solid var(--color-border)' }}>
                {topSegments.map(seg => (
                  <div key={seg.key} style={{ position: 'absolute', left: seg.offset * pxPerDay, width: seg.days * pxPerDay, height: 24, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 12, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', whiteSpace: 'nowrap', textTransform: 'capitalize', borderLeft: '1px solid var(--color-border)' }}>
                    {topLabel(seg)}
                  </div>
                ))}
              </div>
              <div style={{ position: 'relative', height: 24 }}>
                {bottomSegments.map(seg => (
                  <div key={seg.key} style={{ position: 'absolute', left: seg.offset * pxPerDay, width: seg.days * pxPerDay, height: 24, display: 'flex', alignItems: 'center', justifyContent: zoom === 'day' ? 'center' : 'flex-start', paddingLeft: zoom === 'day' ? 0 : 6, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', borderLeft: '1px solid var(--color-border)' }}>
                    {bottomLabel(seg)}
                  </div>
                ))}
              </div>
            </div>

            {/* Bars */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              {rows.map(row => {
                const bar = barById.get(row.card.id)
                const color = cardColor(row.card)
                return (
                  <div
                    key={row.card.id}
                    onClick={() => { if (draggedRef.current) { draggedRef.current = false; return } onCardClick(row.card) }}
                    onMouseEnter={() => { if (!isMobile) setHoveredId(row.card.id) }}
                    onMouseLeave={() => { if (!isMobile) setHoveredId(null) }}
                    style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                  >
                    {bar && bar.isMilestone && (() => {
                      const isDragging = drag?.id === row.card.id
                      const mDate = isDragging && drag ? addDays(bar.start, drag.days) : bar.start
                      const canDrag = canEdit && !isMobile && !!onCardReschedule
                      return (
                        <div
                          onPointerDown={canDrag ? (e) => beginDrag(e, row.card, 'move') : undefined}
                          onPointerMove={canDrag ? moveDrag : undefined}
                          onPointerUp={canDrag ? endDrag : undefined}
                          style={{ position: 'absolute', left: dateToX(mDate) - 7, top: ROW_H / 2 - 7, display: 'flex', alignItems: 'center', gap: 6, cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : 'pointer', touchAction: canDrag ? 'none' : undefined }}
                        >
                          <span title={row.card.title} style={{ width: 14, height: 14, background: color, transform: 'rotate(45deg)', borderRadius: 2, flexShrink: 0 }} />
                          {!isMobile && <span style={{ fontSize: 11.5, color: 'var(--color-text)', whiteSpace: 'nowrap', transform: 'translateY(-1px)', pointerEvents: 'none' }}>{row.card.title}</span>}
                        </div>
                      )
                    })()}
                    {bar && !bar.isMilestone && (() => {
                      const isDragging = drag?.id === row.card.id
                      let bStart = bar.start
                      let bEnd = bar.end
                      if (isDragging && drag) {
                        if (drag.mode === 'move') { bStart = addDays(bar.start, drag.days); bEnd = addDays(bar.end, drag.days) }
                        else if (drag.mode === 'start') { bStart = addDays(bar.start, drag.days); if (diffDays(bStart, bEnd) < 0) bStart = bEnd }
                        else if (drag.mode === 'end') { bEnd = addDays(bar.end, drag.days); if (diffDays(bStart, bEnd) < 0) bEnd = bStart }
                      }
                      const left = dateToX(bStart)
                      const width = Math.max(pxPerDay, (diffDays(bStart, bEnd) + 1) * pxPerDay)
                      const hovered = hoveredId === row.card.id
                      const canDrag = canEdit && !isMobile && !!onCardReschedule && !row.hasChildren
                      const cursor = canDrag ? (isDragging ? 'grabbing' : 'grab') : 'pointer'
                      return (
                        <>
                          <div
                            title={`${row.card.title} · ${priorityLabel(row.card.priority)} · ${bar.progress}%`}
                            onPointerDown={canDrag ? (e) => beginDrag(e, row.card, 'move') : undefined}
                            onPointerMove={canDrag ? moveDrag : undefined}
                            onPointerUp={canDrag ? endDrag : undefined}
                            style={{ position: 'absolute', left, top: row.hasChildren ? ROW_H / 2 - 5 : ROW_H / 2 - 9, width, height: row.hasChildren ? 10 : 18, borderRadius: row.hasChildren ? 3 : 6, background: row.hasChildren ? 'transparent' : `${color}33`, border: row.hasChildren ? `2px solid ${color}` : `1px solid ${color}`, overflow: 'hidden', display: 'flex', alignItems: 'center', cursor, touchAction: canDrag ? 'none' : undefined }}
                          >
                            {!row.hasChildren && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bar.progress}%`, background: color, opacity: 0.85, pointerEvents: 'none' }} />}
                            {!row.hasChildren && width > 24 && (
                              <span style={{ position: 'relative', padding: hovered && canDrag ? '0 12px' : '0 6px', maxWidth: Math.min(width - 12, 132), fontSize: 11, fontWeight: 600, color: 'var(--color-text)', textShadow: '0 0 2px var(--color-bg), 0 0 2px var(--color-bg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                                {row.card.title}
                              </span>
                            )}
                            {canDrag && (
                              <>
                                <div onPointerDown={(e) => beginDrag(e, row.card, 'start')} onPointerMove={moveDrag} onPointerUp={endDrag} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 9, cursor: 'ew-resize', zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
                                  {hovered && <span style={{ width: 4, height: 12, borderRadius: 2, background: color, boxShadow: '0 0 0 1.5px var(--color-bg)', pointerEvents: 'none' }} />}
                                </div>
                                <div onPointerDown={(e) => beginDrag(e, row.card, 'end')} onPointerMove={moveDrag} onPointerUp={endDrag} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 9, cursor: 'ew-resize', zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
                                  {hovered && <span style={{ width: 4, height: 12, borderRadius: 2, background: color, boxShadow: '0 0 0 1.5px var(--color-bg)', pointerEvents: 'none' }} />}
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                )
              })}
            </div>

            {/* Overlay: dependency arrows + today line (above bars) */}
            <svg width={timelineWidth} height={HEADER_H + rowsHeight} style={{ position: 'absolute', top: 0, left: 0, zIndex: 2, pointerEvents: 'none' }}>
              {showTodayLine && (
                <line x1={todayX} y1={0} x2={todayX} y2={HEADER_H + rowsHeight} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.8} />
              )}
              {showDeps && links.map(link => {
                const fromIdx = rowIndexById.get(link.from)
                const toIdx = rowIndexById.get(link.to)
                const fromBar = barById.get(link.from)
                const toBar = barById.get(link.to)
                if (fromIdx == null || toIdx == null || !fromBar || !toBar) return null

                const isParent = link.kind === 'parent'
                // Dependency: end-of-predecessor → start-of-successor.
                // Parent: start-of-parent → start-of-child (a "belongs to" hint).
                const x1 = isParent ? dateToX(fromBar.start) : dateToX(fromBar.end) + pxPerDay
                const y1 = HEADER_H + fromIdx * ROW_H + ROW_H / 2
                const x2 = dateToX(toBar.start)
                const y2 = HEADER_H + toIdx * ROW_H + ROW_H / 2
                const d = linkPath({ x1, y1, x2, y2, rowH: ROW_H })
                const stroke = isParent ? '#6366f1' : 'var(--color-text-muted)'
                const opacity = isParent ? 0.45 : 0.7
                return (
                  <g key={`${link.kind}-${link.from}-${link.to}`}>
                    <path d={d} fill="none" stroke={stroke} strokeWidth={1.4} strokeDasharray={isParent ? '4 3' : undefined} opacity={opacity} />
                    <polygon points={`${x2},${y2} ${x2 - 6},${y2 - 4} ${x2 - 6},${y2 + 4}`} fill={stroke} opacity={opacity} />
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

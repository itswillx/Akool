import { jsPDF } from 'jspdf'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { exportToBlob as excalidrawExportToBlob } from '@excalidraw/excalidraw'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/money'
import { accountBalance } from '../lib/financeCalc'
import type { Page, FinanceTransaction, FinanceAccount, FinanceCategory, FinanceBudget, FinanceGoal, FinanceGoalContribution, FinanceRecurring, FinanceInvestmentMovement } from '../types'

const MARGIN = 15
const PAGE_W = 210
const PAGE_H = 297
const CONTENT_W = PAGE_W - MARGIN * 2

// ─── Block text extraction ────────────────────────────────────────────────────

type LineStyle = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'code' | 'blank'

interface LineEntry {
  text: string
  style: LineStyle
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (content as any[]).map(c => c.text ?? '').join('')
}

const CARD_PRIORITY_LABELS: Record<string, string> = {
  low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente',
}

// Serialises a `projectCard` block's snapshot into printable lines: title,
// board · column context, priority/due meta, description and checklist.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractProjectCard(b: any): LineEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any = {}
  try { snap = JSON.parse(b.props?.snapshot || '{}') } catch { snap = {} }

  const lines: LineEntry[] = []
  lines.push({ text: snap.title || 'Card', style: 'h3' })

  const context = [snap.boardName, snap.columnName].filter(Boolean).join(' · ')
  if (context) lines.push({ text: context, style: 'p' })

  const meta: string[] = []
  if (snap.priority) meta.push(`Prioridade: ${CARD_PRIORITY_LABELS[snap.priority] ?? snap.priority}`)
  if (snap.dueDate) meta.push(`Prazo: ${snap.dueDate}`)
  if (snap.completed) meta.push('Concluído')
  if (meta.length) lines.push({ text: meta.join('  |  '), style: 'p' })

  if (snap.description) lines.push({ text: snap.description, style: 'p' })

  if (Array.isArray(snap.checklist)) {
    for (const item of snap.checklist) {
      lines.push({ text: `${item?.completed ? '[x]' : '[ ]'} ${item?.text ?? ''}`, style: 'li' })
    }
  }

  lines.push({ text: '', style: 'blank' })
  return lines
}

function extractBlocks(blocks: unknown[]): LineEntry[] {
  const lines: LineEntry[] = []
  for (const block of blocks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = block as any
    const type: string = b.type ?? 'paragraph'
    const text = inlineText(b.content)

    if (type === 'heading') {
      const level: number = b.props?.level ?? 1
      lines.push({ text, style: (`h${Math.min(level, 3)}`) as LineStyle })
    } else if (type === 'bulletListItem' || type === 'numberedListItem') {
      lines.push({ text: `- ${text}`, style: 'li' })
    } else if (type === 'checkListItem') {
      const checked = b.props?.checked ? '[x]' : '[ ]'
      lines.push({ text: `${checked} ${text}`, style: 'li' })
    } else if (type === 'codeBlock') {
      lines.push({ text, style: 'code' })
    } else if (type === 'projectCard') {
      lines.push(...extractProjectCard(b))
    } else if (type === 'image' || type === 'diagram') {
      // skip unsupported block types
    } else {
      if (text.trim()) lines.push({ text, style: 'p' })
      else lines.push({ text: '', style: 'blank' })
    }

    if (Array.isArray(b.children) && b.children.length > 0) {
      lines.push(...extractBlocks(b.children))
    }
  }
  return lines
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

const LINE_H: Record<LineStyle, number> = { h1: 8, h2: 7, h3: 6.5, p: 5.5, li: 5.5, code: 5, blank: 3 }
const FONT_SIZE: Record<LineStyle, number> = { h1: 16, h2: 14, h3: 12, p: 10, li: 10, code: 9, blank: 10 }

function renderLine(doc: jsPDF, entry: LineEntry, y: number): number {
  if (entry.style === 'blank') return y + LINE_H.blank

  const fs = FONT_SIZE[entry.style]
  const lh = LINE_H[entry.style]

  switch (entry.style) {
    case 'h1':
    case 'h2':
    case 'h3':
      doc.setFont('helvetica', 'bold')
      break
    default:
      doc.setFont('helvetica', 'normal')
  }
  doc.setFontSize(fs)

  const maxW = entry.style === 'code' ? CONTENT_W - 4 : CONTENT_W
  const wrapped = doc.splitTextToSize(entry.text, maxW)
  const blockH = wrapped.length * lh

  if (y + blockH > PAGE_H - MARGIN) return -1

  if (entry.style === 'code') {
    doc.setFillColor(240, 240, 240)
    doc.rect(MARGIN, y - 3.5, CONTENT_W, blockH + 4, 'F')
    doc.setTextColor(50, 50, 50)
    doc.text(wrapped, MARGIN + 2, y)
    doc.setTextColor(0, 0, 0)
  } else {
    doc.text(wrapped, MARGIN, y)
  }

  return y + blockH + (entry.style.startsWith('h') ? 3 : 2)
}

function ensureLine(doc: jsPDF, entry: LineEntry, y: number): number {
  let ny = renderLine(doc, entry, y)
  if (ny === -1) {
    doc.addPage()
    ny = renderLine(doc, entry, MARGIN)
  }
  return ny as number
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 1, h: 1 })
    img.src = dataUrl
  })
}

/**
 * Adds an image to the PDF maintaining aspect ratio.
 * Fits to CONTENT_W first; if scaled height exceeds available space, starts
 * a new page and scales to fit there instead.
 */
function addImageAspectFit(
  doc: jsPDF,
  dataUrl: string,
  imgW: number,
  imgH: number,
  y: number
): number {
  const ratio = imgW / imgH // px-aspect, same in mm

  // Scale to fit content width
  let finalW = CONTENT_W
  let finalH = finalW / ratio

  const available = PAGE_H - y - MARGIN - 10

  if (finalH > available) {
    if (available < 40) {
      // Too little room — push to next page
      doc.addPage()
      y = MARGIN
    }
    // Re-check available height after potential page break
    const avail2 = PAGE_H - y - MARGIN - 10
    if (finalH > avail2) {
      // Fit height to page, shrink width proportionally
      finalH = avail2
      finalW = finalH * ratio
      // Clamp width to content area
      if (finalW > CONTENT_W) {
        finalW = CONTENT_W
        finalH = finalW / ratio
      }
    }
  }

  // Center horizontally when narrower than CONTENT_W
  const xPos = MARGIN + (CONTENT_W - finalW) / 2
  doc.addImage(dataUrl, 'PNG', xPos, y, finalW, finalH)
  return y + finalH + 6
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportPagesToPdf(pages: Page[], filename: string): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let first = true

  for (const page of pages) {
    if (!first) doc.addPage()
    first = false

    let y = MARGIN

    // ── Title ──
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(0, 0, 0)
    const safeTitle = (page.title || 'Untitled').replace(/[^\x00-\x7F]/g, '')
    const titleLines = doc.splitTextToSize(safeTitle || 'Untitled', CONTENT_W)
    doc.text(titleLines, MARGIN, y)
    y += titleLines.length * 9 + 2

    // ── Date ──
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(140, 140, 140)
    try {
      doc.text(new Date(page.updated_at).toLocaleDateString(), MARGIN, y)
    } catch {
      doc.text(page.updated_at ?? '', MARGIN, y)
    }
    y += 5.5
    doc.setTextColor(0, 0, 0)

    // ── Divider ──
    doc.setDrawColor(210, 210, 210)
    doc.line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 8

    const type = page.type

    // ── Note content ──
    if (type === 'note' || type === 'both') {
      const { data } = await supabase
        .from('note_contents')
        .select('content')
        .eq('page_id', page.id)
        .single()

      if (data?.content && Array.isArray(data.content) && data.content.length > 0) {
        const entries = extractBlocks(data.content as unknown[])
        for (const entry of entries) {
          y = ensureLine(doc, entry, y)
        }
      }
    }

    // ── Drawing ──
    if (type === 'drawing' || type === 'both') {
      if (type === 'both') y += 10

      const { data } = await supabase
        .from('drawing_contents')
        .select('elements, app_state, files')
        .eq('page_id', page.id)
        .single()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeElements = Array.isArray(data?.elements) ? (data.elements as any[]).filter((el: any) => !el.isDeleted) : []
      if (activeElements.length > 0) {
        try {
          const blob = await (excalidrawExportToBlob as Function)({
            elements: activeElements,
            appState: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...((data!.app_state as any) ?? {}),
              exportWithDarkMode: false,
              exportBackground: true,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            files: (data!.files as any) ?? {},
            mimeType: 'image/png',
          })

          const dataUrl = await blobToDataUrl(blob)
          const { w: imgNatW, h: imgNatH } = await getImageDimensions(dataUrl)
          y = addImageAspectFit(doc, dataUrl, imgNatW, imgNatH, y)
        } catch (err) {
          console.error('[PDF] Drawing export error:', err)
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(10)
          doc.setTextColor(180, 180, 180)
          doc.text('[Desenho indisponivel para exportacao]', MARGIN, y)
          doc.setTextColor(0, 0, 0)
          y += 7
        }
      }
    }

    // ── Todos ──
    if (type === 'todo') {
      const { data } = await supabase
        .from('todos')
        .select('*')
        .eq('page_id', page.id)
        .order('completed', { ascending: true })
        .order('sort_order', { ascending: true })

      if (data && data.length > 0) {
        doc.setFontSize(10)
        for (const todo of data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = todo as any
          const check = t.completed ? '[x]' : '[ ]'
          const prio = t.priority === 'high' ? ' (!)' : t.priority === 'medium' ? ' (-)' : ''
          const text = `${check} ${t.text ?? ''}${prio}`

          doc.setFont('helvetica', t.completed ? 'italic' : 'normal')
          doc.setTextColor(t.completed ? 150 : 0, t.completed ? 150 : 0, t.completed ? 150 : 0)

          const wrapped = doc.splitTextToSize(text, CONTENT_W)
          const bH = wrapped.length * 5.5
          if (y + bH > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN }
          doc.text(wrapped, MARGIN, y)
          y += bH + 3
        }
        doc.setTextColor(0, 0, 0)
        doc.setFont('helvetica', 'normal')
      }
    }
  }

  doc.save(filename)
}

// ─── Finance PDF export ───────────────────────────────────────────────────────

export interface FinancePdfData {
  transactions: FinanceTransaction[]
  accounts: FinanceAccount[]
  /** Needed for the balance table: contributions leave the bank without ever
   *  becoming a transaction. Optional so older callers keep compiling. */
  investmentMovements?: FinanceInvestmentMovement[]
  categories: FinanceCategory[]
  budgets: FinanceBudget[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  recurring: FinanceRecurring[]
  month: string
  userName: string
}

function finSafe(s: string): string {
  return s.replace(/[^\u0000-\u00FF]/g, '')
}

// Stored amounts are integer cents; format via the shared helper.
function finBRL(cents: number): string {
  return formatBRL(cents)
}

function finMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function finCheckPage(doc: jsPDF, y: number, needed = 10): number {
  if (y + needed > PAGE_H - MARGIN) {
    doc.addPage()
    return MARGIN
  }
  return y
}

function finSection(doc: jsPDF, title: string, y: number): number {
  y = finCheckPage(doc, y, 18)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(99, 102, 241)
  doc.text(finSafe(title), MARGIN, y)
  y += 4
  doc.setDrawColor(99, 102, 241)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  doc.setLineWidth(0.2)
  doc.setDrawColor(210, 210, 210)
  doc.setTextColor(0, 0, 0)
  return y + 7
}

type ColDef = { text: string; x: number; w: number; right?: boolean }

function finRow(
  doc: jsPDF,
  cols: ColDef[],
  y: number,
  opts?: { bold?: boolean; color?: [number, number, number] }
): number {
  y = finCheckPage(doc, y, 7)
  doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
  doc.setFontSize(9)
  if (opts?.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2])
  else doc.setTextColor(0, 0, 0)
  for (const col of cols) {
    const clipped = doc.splitTextToSize(finSafe(col.text), col.w - 1)[0] ?? ''
    if (col.right) {
      const tw = doc.getTextWidth(clipped)
      doc.text(clipped, col.x + col.w - 2 - tw, y)
    } else {
      doc.text(clipped, col.x, y)
    }
  }
  doc.setTextColor(0, 0, 0)
  return y + 5.5
}

function finHRule(doc: jsPDF, y: number): number {
  doc.setDrawColor(235, 235, 235)
  doc.setLineWidth(0.1)
  doc.line(MARGIN, y - 1, PAGE_W - MARGIN, y - 1)
  doc.setDrawColor(210, 210, 210)
  return y
}

// ── Canvas chart helpers ───────────────────────────────────────────────────────

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

/** Draws a donut chart on a canvas and returns the data URL */
function drawDonutChart(
  slices: { label: string; value: number; color: string }[],
  width: number,
  height: number
): string {
  const DPI = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * DPI
  canvas.height = height * DPI
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPI, DPI)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const total = slices.reduce((s, sl) => s + sl.value, 0)
  if (total === 0) return canvasToDataUrl(canvas)

  // Donut on left half, legend on right half
  const donutAreaW = width * 0.48
  const cx = donutAreaW / 2
  const cy = height / 2
  const outerR = Math.min(cx, cy) - 12
  const innerR = outerR * 0.52
  let angle = -Math.PI / 2

  for (const sl of slices) {
    const sweep = (sl.value / total) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, outerR, angle, angle + sweep)
    ctx.closePath()
    ctx.fillStyle = sl.color || '#999'
    ctx.fill()
    angle += sweep
  }

  // donut hole
  ctx.beginPath()
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // center label
  ctx.fillStyle = '#374151'
  ctx.font = `bold ${Math.round(outerR * 0.25)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Despesas', cx, cy - outerR * 0.15)
  ctx.fillText('por categ.', cx, cy + outerR * 0.15)

  // legend — right half
  const legendX = donutAreaW + 18
  const maxLegendH = height - 20
  const itemH = Math.max(24, maxLegendH / Math.max(slices.length, 1))
  let legendY = 20 + itemH / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const sl of slices) {
    const pct = ((sl.value / total) * 100).toFixed(1)
    ctx.fillStyle = sl.color || '#999'
    ctx.beginPath()
    ctx.arc(legendX, legendY, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#374151'
    ctx.font = `600 14px sans-serif`
    ctx.fillText(finSafe(sl.label).slice(0, 18), legendX + 14, legendY - 6)
    ctx.fillStyle = '#6b7280'
    ctx.font = `12px sans-serif`
    ctx.fillText(`${pct}%  ${finBRL(sl.value)}`, legendX + 14, legendY + 9)
    legendY += itemH
  }

  return canvasToDataUrl(canvas)
}

/** Draws a horizontal bar chart for top categories */
function drawTopCategoriesChart(
  items: { label: string; value: number; color: string }[],
  width: number
): string {
  const DPI = 2
  const rowH = 38
  const height = items.length * rowH + 40
  const canvas = document.createElement('canvas')
  canvas.width = width * DPI
  canvas.height = height * DPI
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPI, DPI)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const maxVal = Math.max(...items.map(i => i.value), 1)
  const labelW = 140
  const amtW = 115
  const barAreaW = width - labelW - amtW - 20

  // title row
  ctx.fillStyle = '#6b7280'
  ctx.font = '600 13px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('Categoria', 10, 18)
  ctx.textAlign = 'right'
  ctx.fillText('Total gasto', width - 10, 18)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const y = 38 + i * rowH
    const barW = Math.max(4, (item.value / maxVal) * barAreaW)

    // alternating row bg
    if (i % 2 === 0) {
      ctx.fillStyle = '#f9fafb'
      ctx.fillRect(0, y - 2, width, rowH)
    }

    // background track
    ctx.fillStyle = '#e5e7eb'
    ctx.beginPath()
    ctx.roundRect(labelW + 5, y + 6, barAreaW, rowH - 16, 4)
    ctx.fill()

    // colored bar
    ctx.fillStyle = item.color || '#6366f1'
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.roundRect(labelW + 5, y + 6, barW, rowH - 16, 4)
    ctx.fill()
    ctx.globalAlpha = 1

    // label
    ctx.fillStyle = '#374151'
    ctx.font = '600 13px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(finSafe(item.label).slice(0, 20), 10, y + rowH / 2)

    // amount
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 13px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(finBRL(item.value), width - 10, y + rowH / 2)
  }

  return canvasToDataUrl(canvas)
}

/** Draws a grouped bar chart (income vs expense) for last N months */
function drawMonthlyBarsChart(
  months: { label: string; income: number; expense: number }[],
  width: number,
  height: number
): string {
  const DPI = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * DPI
  canvas.height = height * DPI
  const ctx = canvas.getContext('2d')!
  ctx.scale(DPI, DPI)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const padT = 30, padB = 36, padL = 50, padR = 16
  const chartH = height - padT - padB
  const chartW = width - padL - padR
  const n = months.length
  const groupW = chartW / n
  const barW = groupW * 0.32
  const gap = groupW * 0.06

  const maxVal = Math.max(...months.flatMap(m => [m.income, m.expense]), 1)

  // y-axis labels
  ctx.fillStyle = '#9ca3af'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const val = (maxVal * i / 4)
    const gy = padT + chartH - (i / 4) * chartH
    const label = val >= 1000 ? `${(val/1000).toFixed(1)}k` : val.toFixed(0)
    ctx.fillText(label, padL - 6, gy)
    ctx.strokeStyle = '#f3f4f6'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padL, gy)
    ctx.lineTo(padL + chartW, gy)
    ctx.stroke()
  }

  for (let i = 0; i < n; i++) {
    const m = months[i]
    const gx = padL + i * groupW + groupW / 2 - barW - gap / 2

    // income bar
    const incH = Math.max(2, (m.income / maxVal) * chartH)
    ctx.fillStyle = '#22c55e'
    ctx.globalAlpha = 0.88
    ctx.beginPath()
    ctx.roundRect(gx, padT + chartH - incH, barW, incH, [3, 3, 0, 0])
    ctx.fill()

    // expense bar
    const expH = Math.max(2, (m.expense / maxVal) * chartH)
    ctx.fillStyle = '#ef4444'
    ctx.globalAlpha = 0.88
    ctx.beginPath()
    ctx.roundRect(gx + barW + gap, padT + chartH - expH, barW, expH, [3, 3, 0, 0])
    ctx.fill()
    ctx.globalAlpha = 1

    // month label
    ctx.fillStyle = '#6b7280'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(m.label, padL + i * groupW + groupW / 2, padT + chartH + 7)
  }

  // legend top-right
  const legX = padL + chartW - 120
  const legY = 12
  ctx.fillStyle = '#22c55e'
  ctx.fillRect(legX, legY - 5, 12, 10)
  ctx.fillStyle = '#374151'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('Receitas', legX + 16, legY)
  ctx.fillStyle = '#ef4444'
  ctx.fillRect(legX + 72, legY - 5, 12, 10)
  ctx.fillStyle = '#374151'
  ctx.fillText('Despesas', legX + 88, legY)

  return canvasToDataUrl(canvas)
}

export async function exportFinanceToPdf({
  transactions,
  accounts,
  investmentMovements = [],
  categories,
  budgets,
  goals,
  contributions,
  recurring,
  month,
  userName,
}: FinancePdfData): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const catMap = new Map(categories.map(c => [c.id, c]))
  let y = MARGIN

  // ── Cover header ──────────────────────────────────────────────────────────
  // Accent bar
  doc.setFillColor(99, 102, 241)
  doc.rect(0, 0, PAGE_W, 2, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(30, 30, 50)
  doc.text('Controle Financeiro - Akool', MARGIN, y + 4)
  y += 12

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(140, 140, 140)
  const mLabel = finMonthLabel(month)
  const monthCap = `${mLabel.charAt(0).toUpperCase()}${mLabel.slice(1)}`
  const genDate = new Date().toLocaleDateString('pt-BR')
  const safeUser = finSafe(userName)
  doc.text(`${monthCap}  |  Gerado em ${genDate}  |  Por: ${safeUser}`, MARGIN, y)
  y += 5

  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  doc.setLineWidth(0.2)
  y += 10

  // ── 1. Resumo mensal ──────────────────────────────────────────────────────
  const monthTxs = transactions.filter(tx => tx.date.startsWith(month))
  const income = monthTxs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
  const expense = monthTxs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
  const balance = income - expense
  const colW = CONTENT_W / 3

  y = finSection(doc, 'Resumo Mensal', y)

  // Colored summary cards
  const cardH = 16
  const cardPad = 3
  const cards = [
    { label: 'Receitas', value: income, bg: [220, 252, 231] as [number,number,number], fg: [22, 163, 74] as [number,number,number] },
    { label: 'Despesas', value: expense, bg: [254, 226, 226] as [number,number,number], fg: [220, 38, 38] as [number,number,number] },
    { label: 'Saldo', value: balance, bg: balance >= 0 ? [219, 234, 254] as [number,number,number] : [254, 226, 226] as [number,number,number], fg: balance >= 0 ? [37, 99, 235] as [number,number,number] : [220, 38, 38] as [number,number,number] },
  ]
  for (let i = 0; i < cards.length; i++) {
    const cx = MARGIN + i * (colW + 2)
    doc.setFillColor(cards[i].bg[0], cards[i].bg[1], cards[i].bg[2])
    doc.roundedRect(cx, y, colW - 2, cardH, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(finSafe(cards[i].label), cx + cardPad, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(cards[i].fg[0], cards[i].fg[1], cards[i].fg[2])
    doc.text(finBRL(cards[i].value), cx + cardPad, y + 12)
  }
  y += cardH + 8

  // ── 2. Visao Geral — Charts ───────────────────────────────────────────────
  const expenseTxs = monthTxs.filter(tx => tx.type === 'expense')

  // Build category totals for donut + top bar chart
  const catTotals = new Map<string, number>()
  for (const tx of expenseTxs) {
    const cid = tx.category_id ?? '__none__'
    catTotals.set(cid, (catTotals.get(cid) ?? 0) + tx.amount)
  }
  const catSlices = [...catTotals.entries()]
    .map(([cid, val]) => {
      const cat = catMap.get(cid)
      return { label: cat?.name ?? 'Outros', value: val, color: cat?.color ?? '#6366f1' }
    })
    .sort((a, b) => b.value - a.value)

  if (catSlices.length > 0) {
    y = finSection(doc, 'Visao Geral do Mes', y)

    // Donut chart — square-ish canvas so the donut circle isn't distorted
    const donutW = 550
    const donutLegendItemH = Math.max(26, 20 / Math.max(catSlices.length, 1) + 20)
    const donutH = Math.max(donutW * 0.55, catSlices.length * donutLegendItemH + 30)
    const donutDataUrl = drawDonutChart(catSlices, donutW, donutH)
    const donutMmW = CONTENT_W
    const donutMmH = donutMmW * (donutH / donutW)
    y = finCheckPage(doc, y, donutMmH + 6)
    doc.addImage(donutDataUrl, 'PNG', MARGIN, y, donutMmW, donutMmH)
    y += donutMmH + 6
  }

  // Top categories horizontal bar chart (top 8)
  const topCats = catSlices.slice(0, 8)
  if (topCats.length > 0) {
    y = finSection(doc, 'Top Gastos por Categoria', y)
    const barCanvasW = 550
    const barRowH = 38
    const barDataUrl = drawTopCategoriesChart(topCats, barCanvasW)
    const barMmW = CONTENT_W
    const barMmH = barMmW * ((topCats.length * barRowH + 40) / barCanvasW)
    y = finCheckPage(doc, y, barMmH + 6)
    doc.addImage(barDataUrl, 'PNG', MARGIN, y, barMmW, barMmH)
    y += barMmH + 6
  }

  // Monthly evolution chart — last 6 months
  {
    const [my, mm] = month.split('-').map(Number)
    const monthsData: { label: string; income: number; expense: number }[] = []
    for (let i = 5; i >= 0; i--) {
      let nm = mm - i
      let ny = my
      while (nm <= 0) { nm += 12; ny-- }
      const ym = `${ny}-${String(nm).padStart(2, '0')}`
      const txs = transactions.filter(tx => tx.date.startsWith(ym))
      monthsData.push({
        label: new Date(ny, nm - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }),
        income: txs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0),
        expense: txs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0),
      })
    }
    const hasData = monthsData.some(m => m.income > 0 || m.expense > 0)
    if (hasData) {
      y = finSection(doc, 'Evolucao Mensal (6 meses)', y)
      const evCanvasW = 550
      const evCanvasH = 260
      const evDataUrl = drawMonthlyBarsChart(monthsData, evCanvasW, evCanvasH)
      const evMmW = CONTENT_W
      const evMmH = evMmW * (evCanvasH / evCanvasW)
      y = finCheckPage(doc, y, evMmH + 6)
      doc.addImage(evDataUrl, 'PNG', MARGIN, y, evMmW, evMmH)
      y += evMmH + 8
    }
  }

  // ── 3. Transacoes do mes ──────────────────────────────────────────────────
  y = finSection(doc, 'Transacoes do Mes', y)

  const TX = { date: { x: MARGIN, w: 24 }, desc: { x: MARGIN + 24, w: 68 }, cat: { x: MARGIN + 92, w: 42 }, tp: { x: MARGIN + 134, w: 16 }, amt: { x: MARGIN + 150, w: 30 } }

  y = finRow(doc, [
    { text: 'Data', ...TX.date },
    { text: 'Descricao', ...TX.desc },
    { text: 'Categoria', ...TX.cat },
    { text: 'T', ...TX.tp },
    { text: 'Valor', ...TX.amt, right: true },
  ], y, { bold: true, color: [80, 80, 80] })

  if (monthTxs.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(160, 160, 160)
    doc.text('Nenhuma transacao neste periodo.', MARGIN, y)
    doc.setTextColor(0, 0, 0)
    y += 6
  } else {
    const sorted = [...monthTxs].sort((a, b) => a.date.localeCompare(b.date))
    for (const tx of sorted) {
      y = finHRule(doc, y)
      const catName = catMap.get(tx.category_id ?? '')?.name ?? '-'
      const dateLabel = tx.date.split('-').reverse().join('/')
      const typeLabel = tx.type === 'income' ? 'R' : 'D'
      y = finRow(doc, [
        { text: dateLabel, ...TX.date },
        { text: tx.description, ...TX.desc },
        { text: catName, ...TX.cat },
        { text: typeLabel, ...TX.tp },
        { text: finBRL(tx.amount), ...TX.amt, right: true },
      ], y, { color: tx.type === 'income' ? [22, 163, 74] : [220, 38, 38] })
    }
  }
  y += 6

  // ── 4. Orcamentos ─────────────────────────────────────────────────────────
  const monthBudgets = budgets.filter(b => b.month === month)
  if (monthBudgets.length > 0) {
    y = finSection(doc, 'Orcamentos', y)
    const BG = { cat: { x: MARGIN, w: 68 }, lim: { x: MARGIN + 68, w: 38 }, sp: { x: MARGIN + 106, w: 38 }, rem: { x: MARGIN + 144, w: 36 } }
    y = finRow(doc, [
      { text: 'Categoria', ...BG.cat },
      { text: 'Limite', ...BG.lim, right: true },
      { text: 'Gasto', ...BG.sp, right: true },
      { text: 'Restante', ...BG.rem, right: true },
    ], y, { bold: true, color: [80, 80, 80] })
    for (const b of monthBudgets) {
      y = finHRule(doc, y)
      const catName = catMap.get(b.category_id)?.name ?? '-'
      const spent = monthTxs.filter(tx => tx.type === 'expense' && tx.category_id === b.category_id).reduce((s, tx) => s + tx.amount, 0)
      const remaining = b.amount_limit - spent
      y = finRow(doc, [
        { text: catName, ...BG.cat },
        { text: finBRL(b.amount_limit), ...BG.lim, right: true },
        { text: finBRL(spent), ...BG.sp, right: true },
        { text: finBRL(remaining), ...BG.rem, right: true },
      ], y, { color: remaining < 0 ? [220, 38, 38] : [0, 0, 0] })
    }
    y += 6
  }

  // ── 5. Contas ─────────────────────────────────────────────────────────────
  if (accounts.length > 0) {
    y = finSection(doc, 'Contas', y)
    const AC = { name: { x: MARGIN, w: 82 }, tp: { x: MARGIN + 82, w: 52 }, bal: { x: MARGIN + 134, w: 46 } }
    const typeLabels: Record<string, string> = { checking: 'Conta corrente', savings: 'Poupanca', credit: 'Cartao credito', cash: 'Dinheiro' }
    y = finRow(doc, [
      { text: 'Conta', ...AC.name },
      { text: 'Tipo', ...AC.tp },
      { text: 'Saldo', ...AC.bal, right: true },
    ], y, { bold: true, color: [80, 80, 80] })
    for (const acc of accounts) {
      y = finHRule(doc, y)
      const bal = accountBalance(acc, transactions, investmentMovements)
      y = finRow(doc, [
        { text: `${acc.icon ? finSafe(acc.icon) + ' ' : ''}${acc.name}`, ...AC.name },
        { text: typeLabels[acc.type] ?? acc.type, ...AC.tp },
        { text: finBRL(bal), ...AC.bal, right: true },
      ], y, { color: bal < 0 ? [220, 38, 38] : [0, 0, 0] })
    }
    y += 6
  }

  // ── 6. Metas ──────────────────────────────────────────────────────────────
  if (goals.length > 0) {
    y = finSection(doc, 'Metas', y)
    const GL = { name: { x: MARGIN, w: 65 }, tgt: { x: MARGIN + 65, w: 36 }, acc: { x: MARGIN + 101, w: 36 }, pct: { x: MARGIN + 137, w: 22 }, st: { x: MARGIN + 159, w: 21 } }
    y = finRow(doc, [
      { text: 'Meta', ...GL.name },
      { text: 'Alvo', ...GL.tgt, right: true },
      { text: 'Acumulado', ...GL.acc, right: true },
      { text: '%', ...GL.pct, right: true },
      { text: 'Status', ...GL.st },
    ], y, { bold: true, color: [80, 80, 80] })
    for (const g of goals) {
      y = finHRule(doc, y)
      const accumulated = contributions.filter(c => c.goal_id === g.id).reduce((s, c) => s + c.amount, 0)
      const pct = g.target_amount > 0 ? Math.round((accumulated / g.target_amount) * 100) : 0
      const statusLabel = g.status === 'active' ? 'Ativa' : g.status === 'completed' ? 'Concluida' : 'Cancelada'
      y = finRow(doc, [
        { text: g.name, ...GL.name },
        { text: finBRL(g.target_amount), ...GL.tgt, right: true },
        { text: finBRL(accumulated), ...GL.acc, right: true },
        { text: `${pct}%`, ...GL.pct, right: true },
        { text: statusLabel, ...GL.st },
      ], y)
    }
    y += 6
  }

  // ── 7. Recorrentes ────────────────────────────────────────────────────────
  const activeRec = recurring.filter(r => r.active)
  if (activeRec.length > 0) {
    y = finSection(doc, 'Recorrentes Ativas', y)
    const RC = { desc: { x: MARGIN, w: 90 }, tp: { x: MARGIN + 90, w: 28 }, amt: { x: MARGIN + 118, w: 36 }, day: { x: MARGIN + 154, w: 26 } }
    y = finRow(doc, [
      { text: 'Descricao', ...RC.desc },
      { text: 'Tipo', ...RC.tp },
      { text: 'Valor', ...RC.amt, right: true },
      { text: 'Dia', ...RC.day, right: true },
    ], y, { bold: true, color: [80, 80, 80] })
    for (const rec of activeRec) {
      y = finHRule(doc, y)
      const typeLabel = rec.type === 'income' ? 'Receita' : 'Despesa'
      const amtLabel = rec.is_variable ? 'Variavel' : (rec.amount != null ? finBRL(rec.amount) : '-')
      y = finRow(doc, [
        { text: rec.description, ...RC.desc },
        { text: typeLabel, ...RC.tp },
        { text: amtLabel, ...RC.amt, right: true },
        { text: `Dia ${rec.day_of_month}`, ...RC.day, right: true },
      ], y)
    }
  }

  doc.save(`financas-${month}.pdf`)
}

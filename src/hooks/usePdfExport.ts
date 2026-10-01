import { jsPDF } from 'jspdf'
import type { TFn } from '../lib/optimistic'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Page } from '../types'
import type { ProjectCardSnapshot } from '../lib/projectImport'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { CONTENT_W, MARGIN, PAGE_H, PAGE_W } from '../lib/pdf/layout'

// PDF de páginas (notas, desenhos, tarefas). O do financeiro mora em
// lib/financePdf.ts (PERF-006): juntos, exportar as finanças baixava o
// Excalidraw e o chunk do editor. Aqui o Excalidraw só carrega quando alguma
// página exportada tem desenho.

// ─── Block text extraction ────────────────────────────────────────────────────

type LineStyle = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'code' | 'blank'

interface LineEntry {
  text: string
  style: LineStyle
}

/** Texto que a fonte padrão do jsPDF consegue desenhar: sem acentos e só ASCII. */
export function pdfSafe(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7F]/g, '')
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((c: { text?: unknown } | null) => (typeof c?.text === 'string' ? c.text : '')).join('')
}

// UX-011: os rótulos do PDF saem no idioma de quem exporta (`t` vem de quem
// chama; o jsPDF roda fora dos componentes).
const CARD_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])

/** Bloco do BlockNote como fica guardado no jsonb (só o que o PDF lê). */
interface StoredBlock {
  type?: string
  content?: unknown
  props?: { level?: number; checked?: boolean; snapshot?: string }
  children?: unknown[]
}

// Serialises a `projectCard` block's snapshot into printable lines: title,
// board · column context, priority/due meta, description and checklist.
function extractProjectCard(b: StoredBlock, t: TFn): LineEntry[] {
  // Snapshot gravado pelo próprio bloco (buildCardSnapshot); campos podem faltar em blocos antigos.
  let snap: Partial<ProjectCardSnapshot> = {}
  try { snap = JSON.parse(b.props?.snapshot || '{}') } catch { snap = {} }

  const lines: LineEntry[] = []
  lines.push({ text: snap.title || t('projects_table_card'), style: 'h3' })

  const context = [snap.boardName, snap.columnName].filter(Boolean).join(' · ')
  if (context) lines.push({ text: context, style: 'p' })

  const meta: string[] = []
  if (snap.priority) {
    const label = CARD_PRIORITIES.has(snap.priority) ? t(`projects_priority_${snap.priority}`) : snap.priority
    meta.push(`${t('projects_priority')}: ${label}`)
  }
  if (snap.dueDate) meta.push(`${t('projects_due_date')}: ${snap.dueDate}`)
  if (snap.completed) meta.push(t('pdf_card_completed'))
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

function extractBlocks(blocks: unknown[], t: TFn): LineEntry[] {
  const lines: LineEntry[] = []
  for (const block of blocks) {
    const b = (block ?? {}) as StoredBlock
    const type: string = b.type ?? 'paragraph'
    const text = inlineText(b.content)

    if (type === 'heading') {
      const level = b.props?.level ?? 1
      lines.push({ text, style: (`h${Math.min(level, 3)}`) as LineStyle })
    } else if (type === 'bulletListItem' || type === 'numberedListItem') {
      lines.push({ text: `- ${text}`, style: 'li' })
    } else if (type === 'checkListItem') {
      const checked = b.props?.checked ? '[x]' : '[ ]'
      lines.push({ text: `${checked} ${text}`, style: 'li' })
    } else if (type === 'codeBlock') {
      lines.push({ text, style: 'code' })
    } else if (type === 'projectCard') {
      lines.push(...extractProjectCard(b, t))
    } else if (type === 'image' || type === 'diagram') {
      // skip unsupported block types
    } else {
      if (text.trim()) lines.push({ text, style: 'p' })
      else lines.push({ text: '', style: 'blank' })
    }

    if (Array.isArray(b.children) && b.children.length > 0) {
      lines.push(...extractBlocks(b.children, t))
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
  return ny
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

// ─── Page contents (PERF-006: in batches, not queries per page) ───────────────

interface NoteRow { page_id: string; content: unknown }
interface DrawingRow { page_id: string; elements: unknown; app_state: unknown; files: unknown }
interface TodoRow { page_id: string; text?: string | null; completed?: boolean | null; priority?: string | null }

export interface PageContents {
  notes: Map<string, NoteRow>
  drawings: Map<string, DrawingRow>
  todos: Map<string, TodoRow[]>
}

// Keeps the `page_id=in.(…)` query string well under proxy URL limits.
const IDS_PER_QUERY = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Rows grouped by page_id, keeping the order they came in. */
export function groupByPage<T extends { page_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const list = out.get(row.page_id)
    if (list) list.push(row)
    else out.set(row.page_id, [row])
  }
  return out
}

/**
 * Everything the export reads, with one query per table per 100 pages, all in
 * parallel. It used to be one or two sequential queries per page. A failed
 * query leaves that content empty, as before.
 */
export async function fetchPageContents(
  client: SupabaseClient,
  pages: Pick<Page, 'id' | 'type'>[],
): Promise<PageContents> {
  const idsOf = (types: Page['type'][]) => pages.filter(p => types.includes(p.type)).map(p => p.id)
  const select = async <T>(ids: string[], run: (batch: string[]) => PromiseLike<{ data: unknown }>): Promise<T[]> => {
    const results = await Promise.all(chunk(ids, IDS_PER_QUERY).map(run))
    return results.flatMap(r => (r.data as T[] | null) ?? [])
  }
  const [notes, drawings, todos] = await Promise.all([
    select<NoteRow>(idsOf(['note', 'both']), batch =>
      client.from('note_contents').select('page_id, content').in('page_id', batch)),
    select<DrawingRow>(idsOf(['drawing', 'both']), batch =>
      client.from('drawing_contents').select('page_id, elements, app_state, files').in('page_id', batch)),
    select<TodoRow>(idsOf(['todo']), batch =>
      client.from('todos').select('*').in('page_id', batch)
        .order('completed', { ascending: true })
        .order('sort_order', { ascending: true })),
  ])
  return {
    notes: new Map(notes.map(n => [n.page_id, n])),
    drawings: new Map(drawings.map(d => [d.page_id, d])),
    todos: groupByPage(todos),
  }
}

type ExcalidrawExportToBlob = typeof import('@excalidraw/excalidraw').exportToBlob

/** jsonb de objeto (app_state, files) ou vazio. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportPagesToPdf(pages: Page[], filename: string, t: TFn): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const contents = await fetchPageContents(supabase, pages)
  // The Excalidraw bundle only loads if some exported page has a drawing.
  let excalidraw: Promise<ExcalidrawExportToBlob> | null = null
  const loadExcalidraw = () =>
    (excalidraw ??= import('@excalidraw/excalidraw').then(m => m.exportToBlob))
  let first = true

  for (const page of pages) {
    if (!first) doc.addPage()
    first = false

    let y = MARGIN

    // ── Title ──
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(0, 0, 0)
    // A fonte padrão do jsPDF não tem acentos: tira só os acentos
    // ("Relatório" → "Relatorio"), em vez de apagar a letra inteira.
    const safeTitle = pdfSafe(page.title || t('page_header_untitled'))
    const titleLines = doc.splitTextToSize(safeTitle || pdfSafe(t('page_header_untitled')), CONTENT_W)
    doc.text(titleLines, MARGIN, y)
    y += titleLines.length * 9 + 2

    // ── Date ──
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(140, 140, 140)
    if (page.updated_at) {
      try {
        doc.text(new Date(page.updated_at).toLocaleDateString(), MARGIN, y)
      } catch {
        doc.text(page.updated_at, MARGIN, y)
      }
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
      const data = contents.notes.get(page.id)

      if (data?.content && Array.isArray(data.content) && data.content.length > 0) {
        const entries = extractBlocks(data.content as unknown[], t)
        for (const entry of entries) {
          y = ensureLine(doc, entry, y)
        }
      }
    }

    // ── Drawing ──
    if (type === 'drawing' || type === 'both') {
      if (type === 'both') y += 10

      const data = contents.drawings.get(page.id)

      // O jsonb é gravado pelo DrawingCanvas, no formato do próprio Excalidraw.
      const activeElements = data && Array.isArray(data.elements)
        ? (data.elements as NonDeletedExcalidrawElement[]).filter(el => !el.isDeleted)
        : []
      if (data && activeElements.length > 0) {
        try {
          const exportToBlob = await loadExcalidraw()
          const blob = await exportToBlob({
            elements: activeElements,
            appState: {
              ...(asRecord(data.app_state) as Partial<AppState>),
              exportWithDarkMode: false,
              exportBackground: true,
            },
            files: asRecord(data.files) as BinaryFiles,
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
      const data = contents.todos.get(page.id) ?? []

      if (data.length > 0) {
        doc.setFontSize(10)
        for (const todo of data) {
          const check = todo.completed ? '[x]' : '[ ]'
          const prio = todo.priority === 'high' ? ' (!)' : todo.priority === 'medium' ? ' (-)' : ''
          const text = `${check} ${todo.text ?? ''}${prio}`

          doc.setFont('helvetica', todo.completed ? 'italic' : 'normal')
          doc.setTextColor(todo.completed ? 150 : 0, todo.completed ? 150 : 0, todo.completed ? 150 : 0)

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

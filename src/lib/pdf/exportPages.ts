import { jsPDF } from 'jspdf'
import { localeOf, type Lang } from '../../i18n/translations'
import type { TFn } from '../optimistic'
import { supabase } from '../supabase'
import type { Page } from '../../types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { CONTENT_W, MARGIN, PAGE_H, PAGE_W } from './layout'
import { extractBlocks, pdfSafe } from './noteBlocks'
import { ensureLine } from './textRender'
import { addImageAspectFit, blobToDataUrl, getImageDimensions } from './images'
import { fetchPageContents } from './pageContents'

export { pdfSafe } from './noteBlocks'
export { fetchPageContents, groupByPage, type PageContents } from './pageContents'

// PDF de páginas (notas, desenhos, tarefas). O do financeiro mora em
// lib/financePdf.ts (PERF-006): juntos, exportar as finanças baixava o
// Excalidraw e o chunk do editor. Aqui o Excalidraw só carrega quando alguma
// página exportada tem desenho. ARCH-005: extração dos blocos, render de
// texto, imagens e busca do conteúdo vivem nos arquivos ao lado.

type ExcalidrawExportToBlob = typeof import('@excalidraw/excalidraw').exportToBlob

/** jsonb de objeto (app_state, files) ou vazio. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function exportPagesToPdf(pages: Page[], filename: string, t: TFn, lang: Lang = 'pt-BR'): Promise<void> {
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
        doc.text(new Date(page.updated_at).toLocaleDateString(localeOf(lang)), MARGIN, y)
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
          doc.text(pdfSafe(t('pdf_drawing_unavailable')), MARGIN, y)
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

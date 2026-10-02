import type { jsPDF } from 'jspdf'
import { CONTENT_W, MARGIN, PAGE_H } from './layout'
import type { LineEntry, LineStyle } from './noteBlocks'

// ARCH-005: desenha as linhas extraídas da nota no jsPDF, com quebra de página.

const LINE_H: Record<LineStyle, number> = { h1: 8, h2: 7, h3: 6.5, p: 5.5, li: 5.5, code: 5, blank: 3 }
const FONT_SIZE: Record<LineStyle, number> = { h1: 16, h2: 14, h3: 12, p: 10, li: 10, code: 9, blank: 10 }

/** Desenha a linha em `y`; devolve o próximo `y`, ou -1 se não coube na página. */
export function renderLine(doc: jsPDF, entry: LineEntry, y: number): number {
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

/** Como renderLine, mas abre página nova quando a linha não cabe. */
export function ensureLine(doc: jsPDF, entry: LineEntry, y: number): number {
  let ny = renderLine(doc, entry, y)
  if (ny === -1) {
    doc.addPage()
    ny = renderLine(doc, entry, MARGIN)
  }
  return ny
}

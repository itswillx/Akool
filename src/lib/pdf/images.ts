import type { jsPDF } from 'jspdf'
import { CONTENT_W, MARGIN, PAGE_H } from './layout'

// ARCH-005: imagens (o desenho exportado pelo Excalidraw) no PDF.

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
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
export function addImageAspectFit(
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

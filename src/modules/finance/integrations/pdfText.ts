// Browser-only PDF text extraction on top of pdfjs-dist. Kept apart from the
// pure parsers in src/lib so those stay unit-testable in node. Both imports are
// dynamic on purpose: pdfjs (~1MB) only downloads when someone actually
// imports a statement (chunk 'pdfjs' in vite.config manualChunks).

export class PdfPasswordError extends Error {
  // wrongPassword=false: the file needs a password and none was given;
  // true: the given password was rejected.
  readonly wrongPassword: boolean
  constructor(wrongPassword: boolean) {
    super('pdf-password')
    this.name = 'PdfPasswordError'
    this.wrongPassword = wrongPassword
  }
}

// Returns the document as text lines: per page, text items grouped into rows
// by their Y coordinate (±2), each row's items sorted by X and joined with a
// space — the shape parseC6Statement expects.
export async function extractPdfLines(data: ArrayBuffer, password?: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  // pdfjs transfers the buffer to its worker (detaching it), and the caller may
  // retry with another password over the same bytes — so hand over a copy.
  const bytes = new Uint8Array(data.slice(0))

  const task = pdfjs.getDocument({ data: bytes, password })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (err) {
    const e = err as { name?: string; code?: number }
    if (e?.name === 'PasswordException') {
      // code 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      throw new PdfPasswordError(e.code === 2)
    }
    throw err
  }

  try {
    const lines: string[] = []
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      const rows: { y: number; items: { x: number; str: string }[] }[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const y = item.transform[5]
        let row = rows.find(r => Math.abs(r.y - y) <= 2)
        if (!row) { row = { y, items: [] }; rows.push(row) }
        row.items.push({ x: item.transform[4], str: item.str })
      }
      rows.sort((a, b) => b.y - a.y) // PDF Y grows upward → top of page first
      for (const row of rows) {
        lines.push(row.items.sort((a, b) => a.x - b.x).map(i => i.str.trim()).join(' '))
      }
    }
    return lines
  } finally {
    await task.destroy()
  }
}

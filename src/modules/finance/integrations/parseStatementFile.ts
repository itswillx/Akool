import { detectStatementFormat, type ParsedStatement } from '../../../lib/statementImport'
import { decodeOfxBytes, parseOfx } from '../../../lib/ofxParser'
import { parseC6Statement } from '../../../lib/c6PdfParser'
import { extractPdfLines, PdfPasswordError } from './pdfText'

export type ParseFileError = 'needs_password' | 'wrong_password' | 'unrecognized' | 'invalid_ofx' | 'empty'
export type ParseFileResult =
  | { ok: true; statement: ParsedStatement }
  | { ok: false; error: ParseFileError }

// File → format sniff → the right parser. All errors come back as tagged
// results (the modal turns them into i18n messages); nothing throws.
export async function parseStatementFile(file: File, password?: string): Promise<ParseFileResult> {
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    return { ok: false, error: 'unrecognized' }
  }
  const format = detectStatementFormat(file.name, new Uint8Array(buf))

  if (format === 'ofx') {
    const statement = parseOfx(decodeOfxBytes(buf))
    if (statement.warnings.includes('invalid_ofx')) return { ok: false, error: 'invalid_ofx' }
    if (statement.txs.length === 0) return { ok: false, error: 'empty' }
    return { ok: true, statement }
  }

  if (format === 'pdf') {
    let lines: string[]
    try {
      lines = await extractPdfLines(buf, password)
    } catch (err) {
      if (err instanceof PdfPasswordError) {
        return { ok: false, error: err.wrongPassword ? 'wrong_password' : 'needs_password' }
      }
      return { ok: false, error: 'unrecognized' }
    }
    const statement = parseC6Statement(lines)
    if (statement.txs.length === 0) {
      // A C6 statement with no rows is "empty"; any other PDF is not a format we know.
      const looksLikeC6 = Boolean(statement.accountHint) || lines.some(l => /extrato/i.test(l))
      return { ok: false, error: looksLikeC6 ? 'empty' : 'unrecognized' }
    }
    return { ok: true, statement }
  }

  return { ok: false, error: 'unrecognized' }
}

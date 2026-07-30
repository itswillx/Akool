import type { ParsedStatement, ParsedTx } from './statementImport'
import { classifyInternal } from './statementImport'

// Generic OFX parser. Brazilian banks export either OFX 1.x (SGML: header of
// KEY:VALUE lines, tags without closing pairs) or OFX 2.x (XML). Both are
// covered by extracting <STMTTRN> blocks and reading `<TAG>value` pairs where
// the value runs to end-of-line or the next tag — no DOM parsing involved.

// Banks commonly emit latin-1 despite claiming otherwise, so try strict UTF-8
// first and fall back to windows-1252 (superset of ISO-8859-1) on failure.
export function decodeOfxBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

// TRNAMT is machine-formatted: decimal point, no thousands grouping — but a few
// banks use a decimal comma, so accept that too. Returns SIGNED cents.
export function parseOfxAmount(raw: string): number {
  let s = raw.trim()
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.')
  const value = parseFloat(s)
  return Number.isFinite(value) ? Math.round(value * 100) : NaN
}

function tagValues(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of block.matchAll(/<(\w+)>([^<\r\n]*)/g)) {
    const value = m[2].trim()
    if (value && !map.has(m[1].toUpperCase())) map.set(m[1].toUpperCase(), value)
  }
  return map
}

function ofxDate(raw: string | undefined): string | undefined {
  const digits = raw?.match(/^\d{8}/)?.[0]
  if (!digits) return undefined
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

export function parseOfx(text: string): ParsedStatement {
  const warnings: string[] = []
  const txs: ParsedTx[] = []

  if (!/<OFX>/i.test(text)) {
    return { format: 'ofx', txs, warnings: ['invalid_ofx'] }
  }

  // Split into <STMTTRN> blocks; SGML has no </STMTTRN>, so a block runs until
  // the next <STMTTRN> or the transaction list ends.
  const blocks: string[] = []
  const re = /<STMTTRN>/gi
  let m: RegExpExecArray | null
  const starts: number[] = []
  while ((m = re.exec(text)) !== null) starts.push(m.index)
  starts.forEach((start, i) => {
    const rawEnd = i + 1 < starts.length ? starts[i + 1] : text.length
    const block = text.slice(start, rawEnd)
    const closer = block.search(/<\/STMTTRN>|<\/BANKTRANLIST>/i)
    blocks.push(closer > -1 ? block.slice(0, closer) : block)
  })

  if (blocks.length === 0) {
    return { format: 'ofx', txs, warnings: ['invalid_ofx'] }
  }

  const seenFitIds = new Set<string>()
  for (const block of blocks) {
    const tags = tagValues(block)
    const date = ofxDate(tags.get('DTPOSTED'))
    const signedCents = parseOfxAmount(tags.get('TRNAMT') ?? '')
    const description = tags.get('MEMO') ?? tags.get('NAME') ?? ''
    if (!date || !Number.isFinite(signedCents) || signedCents === 0 || !description) {
      warnings.push(`ofx_skipped: ${block.slice(0, 80).replace(/\s+/g, ' ')}`)
      continue
    }
    const fitId = tags.get('FITID')
    if (fitId) {
      if (seenFitIds.has(fitId)) {
        warnings.push(`ofx_duplicate_fitid: ${fitId}`)
        continue
      }
      seenFitIds.add(fitId)
    }
    const type = signedCents < 0 ? 'expense' : 'income'
    const sourceKind = tags.get('TRNTYPE')
    const internalReason = classifyInternal(description, sourceKind, type)
    txs.push({
      date,
      amount: Math.abs(signedCents),
      type,
      description,
      sourceKind,
      fitId,
      internal: internalReason !== null,
      internalReason: internalReason ?? undefined,
    })
  }

  const acctId = text.match(/<ACCTID>\s*([^<\r\n]+)/i)?.[1]?.trim()
  const dates = txs.map(t => t.date).sort()
  return {
    format: 'ofx',
    accountHint: acctId ? `Conta ${acctId}` : undefined,
    periodStart: ofxDate(text.match(/<DTSTART>\s*(\d+)/i)?.[1]) ?? dates[0],
    periodEnd: ofxDate(text.match(/<DTEND>\s*(\d+)/i)?.[1]) ?? dates[dates.length - 1],
    txs,
    warnings,
  }
}

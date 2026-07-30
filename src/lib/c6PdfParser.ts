import type { ParsedStatement, ParsedTx } from './statementImport'
import { classifyInternal } from './statementImport'
import { toCents } from './money'

// Parser for C6 Bank account statements ("Extrato da sua conta") exported as
// PDF. Receives the document as plain text lines (already extracted and grouped
// by Y coordinate — see modules/finance/integrations/pdfText.ts) so this stays
// pure and unit-testable without pdfjs.
//
// Statement shape:
//   Agência: 1 • Conta: 92578713
//   Maio 2026 ( 01/05/2026 - 31/05/2026 ) Entradas: R$ ... • Saídas: R$ ...
//   DD/MM DD/MM <Tipo> <Descrição> [-]R$ N.NNN,NN
// Transaction lines have no year — it comes from the month section header.
// Long descriptions wrap across lines, with the amount on the last one.

// Longest first so 'Entrada PIX' wins over 'Entradas'-style prefix overlap.
const C6_KINDS = [
  'Débito de Cartão',
  'Devolução PIX',
  'Entrada PIX',
  'Saída PIX',
  'Outros gastos',
  'Pagamento',
  'Entradas',
  'Entrada',
  'Saída',
].sort((a, b) => b.length - a.length)

const TX_START = /^(\d{2})\/(\d{2})\s+\d{2}\/\d{2}\s+(.*)$/
const SECTION = /\(\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*\d{2}\/\d{2}\/\d{4}\s*\)/
const AMOUNT_END = /(-?)\s*R\$\s*([\d.]+,\d{2})\s*$/
const SKIP = [
  /^Saldo do dia\b/i,
  /^Data$/i,
  /^lan[çc]amento$/i,
  /^cont[áa]bil\b/i,
  /^Data\s+lan[çc]amento\b/i,
]

interface PendingTx {
  date: string
  sourceKind?: string
  descParts: string[]
  startLine: string
}

export function parseC6Statement(lines: string[]): ParsedStatement {
  const warnings: string[] = []
  const txs: ParsedTx[] = []
  let accountHint: string | undefined
  let currentYear: number | null = null
  let pending: PendingTx | null = null

  const finalize = (p: PendingTx, sign: string, amountRaw: string) => {
    const cents = toCents(amountRaw)
    if (cents <= 0) {
      warnings.push(`c6_bad_amount: ${p.startLine}`)
      return
    }
    const type = sign === '-' ? 'expense' : 'income'
    const description = p.descParts.join(' ').replace(/\s{2,}/g, ' ').trim() || p.sourceKind || ''
    const internalReason = classifyInternal(description, p.sourceKind, type)
    txs.push({
      date: p.date,
      amount: cents,
      type,
      description,
      sourceKind: p.sourceKind,
      internal: internalReason !== null,
      internalReason: internalReason ?? undefined,
    })
  }

  const abortPending = (reason: string) => {
    if (pending) {
      warnings.push(`c6_incomplete_tx (${reason}): ${pending.startLine}`)
      pending = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const section = line.match(SECTION)
    if (section) {
      abortPending('new_section')
      currentYear = parseInt(section[3], 10)
      continue
    }

    if (!accountHint) {
      const acc = line.match(/Ag[êe]ncia:\s*(\d+).*Conta:\s*(\d+)/i)
      if (acc) { accountHint = `Agência ${acc[1]} • Conta ${acc[2]}`; continue }
    }

    if (SKIP.some(re => re.test(line))) { abortPending('noise'); continue }

    const start = line.match(TX_START)
    if (start) {
      abortPending('new_tx')
      if (currentYear === null) { warnings.push(`c6_tx_before_section: ${line}`); continue }
      const [, dd, mm, rest] = start
      const date = `${currentYear}-${mm}-${dd}`
      const kind = C6_KINDS.find(k => rest.startsWith(k))
      const afterKind = kind ? rest.slice(kind.length).trim() : rest
      if (!kind) warnings.push(`c6_unknown_kind: ${line}`)
      pending = { date, sourceKind: kind, descParts: [], startLine: line }
      const amount = afterKind.match(AMOUNT_END)
      if (amount) {
        const desc = afterKind.slice(0, afterKind.length - amount[0].length).trim()
        if (desc) pending.descParts.push(desc)
        finalize(pending, amount[1], amount[2])
        pending = null
      } else if (afterKind) {
        pending.descParts.push(afterKind)
      }
      continue
    }

    if (pending) {
      // Continuation of a wrapped description; the amount closes it.
      const amount = line.match(AMOUNT_END)
      if (amount) {
        const desc = line.slice(0, line.length - amount[0].length).trim()
        if (desc) pending.descParts.push(desc)
        finalize(pending, amount[1], amount[2])
        pending = null
      } else {
        pending.descParts.push(line)
      }
      continue
    }

    // Anything else (headers, footer, marketing) is silently ignored — the
    // statement is full of institutional noise and warning on it helps no one.
  }
  abortPending('eof')

  const dates = txs.map(t => t.date).sort()
  return {
    format: 'c6-pdf',
    accountHint,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    txs,
    warnings,
  }
}

import type { FinanceTransaction } from '../types'
import { classifyInvestment } from './investmentClassifier'

// Shared types and pure logic for bank-statement import (C6 PDF + generic OFX).
// Everything here is framework-agnostic and unit-tested in node; parsing of the
// actual file bytes lives in the format parsers (c6PdfParser/ofxParser) and the
// browser-only pdf extraction in modules/finance/integrations.

// "Internal" movements shuffle money the user already tracks elsewhere (card
// bill payments, investment transfers, refunds, bank fees). Importing them as
// regular income/expense would inflate the month's totals, so the preview
// flags them and leaves them unchecked by default.
export type InternalReason = 'card_payment' | 'investment' | 'refund' | 'fee'

export interface ParsedTx {
  date: string                 // 'YYYY-MM-DD'
  amount: number               // integer cents, always > 0 (type carries the sign)
  type: 'income' | 'expense'
  description: string
  sourceKind?: string          // statement's own label ('Saída PIX', TRNTYPE...) — preview display only
  fitId?: string               // OFX FITID; intra-file dedup only, never persisted
  internal: boolean
  internalReason?: InternalReason
}

export interface ParsedStatement {
  format: 'c6-pdf' | 'ofx'
  accountHint?: string
  periodStart?: string
  periodEnd?: string
  txs: ParsedTx[]
  warnings: string[]
}

export type StatementFormat = 'pdf' | 'ofx' | 'unknown'

// Sniff by extension first, then by content head, so a .ofx exported with a
// generic name (or a PDF with the wrong extension) still routes correctly.
export function detectStatementFormat(fileName: string, head: Uint8Array): StatementFormat {
  const name = fileName.toLowerCase()
  const headText = new TextDecoder('latin1').decode(head.slice(0, 512))
  if (name.endsWith('.pdf') || headText.startsWith('%PDF')) return 'pdf'
  if (name.endsWith('.ofx') || /OFXHEADER|<OFX>/i.test(headText)) return 'ofx'
  return 'unknown'
}

// ─── Counterparty normalization ───────────────────────────────────────────────

// Statement descriptions carry boilerplate around the actual counterparty:
// "Pix enviado para GOOD BOM", "GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA. Cartão
// 6403". Stripping it lets transactions group by merchant/person and lets the
// category of a previously categorized transaction be suggested for new ones.
const COUNTERPARTY_PREFIXES = [
  /^pix\s+(enviado\s+para|recebido(\s+c6)?\s+de)\s+/i,
  /^devol\s+recebida\s+pix\s+de\s+/i,
  /^pagamento\s+(de|para|efetuado)\s+/i,
]

export function normalizeCounterparty(desc: string): string {
  let s = desc.trim()
  for (const re of COUNTERPARTY_PREFIXES) s = s.replace(re, '')
  s = s.replace(/\.?\s*cart[aã]o\s+\d{4}\s*$/i, '')       // ". Cartão 6403"
  s = s.replace(/\s+\S+\s+BRA\s*$/i, '')                  // trailing "<city> BRA"
  s = s.replace(/\d{2}\.\d{3}\.\d{3}(\/\d{4}-?\d{2})?/g, '') // CNPJ fragments ("63.685.850 LETICIA")
  s = s.replace(/\d{6,}/g, '')                            // CPFs and glued ids ("54598088Vanessa")
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s.toUpperCase()
}

// ─── Internal-movement classification ─────────────────────────────────────────

export function classifyInternal(
  desc: string,
  sourceKind: string | undefined,
  type: 'income' | 'expense',
): InternalReason | null {
  const d = desc.trim()
  if (/PGTO\s*FAT\s*CARTAO/i.test(d)) return 'card_payment'
  // Delegated so there is a single set of investment patterns in the codebase:
  // the classifier recognizes a superset of the two rules that used to live
  // here (CDB and B3) and also extracts the institution, product and direction
  // the import needs to file the movement into a position.
  if (classifyInvestment(d, sourceKind, type)) return 'investment'
  if (sourceKind === 'Devolução PIX') return 'refund'
  if (/ESTORN|DEVOLU|RECUSAD|^EST\s/i.test(d)) return 'refund'
  if (/TARIFA/i.test(d)) return 'fee'
  return null
}

// ─── Duplicate detection against already-saved transactions ───────────────────

// Heuristic key: same day + same signed amount + same normalized counterparty.
// No schema change (no FITID column), so re-importing an overlapping period
// flags likely duplicates instead of guaranteeing uniqueness.
//
// The index counts occurrences instead of just holding keys: two identical
// purchases on the same day (two R$ 12,00 coffees at the same merchant) share a
// key, and a plain Set would flag the second one as a duplicate of the first —
// leaving it unchecked and silently dropping real money from the import. With
// counts, N identical statement lines only flag min(N, alreadySaved) of them.
type ExistingTxLike = Pick<FinanceTransaction, 'date' | 'amount' | 'type' | 'description'>

/** Remaining occurrences per dedup key. Consumed as rows are flagged. */
export type ExistingTxIndex = Map<string, number>

function dedupKey(date: string, type: 'income' | 'expense', amount: number, description: string): string {
  return `${date}|${type}|${amount}|${normalizeCounterparty(description)}`
}

export function buildExistingTxIndex(existing: ExistingTxLike[]): ExistingTxIndex {
  const index: ExistingTxIndex = new Map()
  for (const tx of existing) {
    const key = dedupKey(tx.date, tx.type, tx.amount, tx.description)
    index.set(key, (index.get(key) ?? 0) + 1)
  }
  return index
}

// Consumes one occurrence when it matches, so the caller must feed the parsed
// rows in order and only once — which is what the preview does, mapping over
// `statement.txs` a single time.
export function isLikelyDuplicate(tx: ParsedTx, index: ExistingTxIndex): boolean {
  const key = dedupKey(tx.date, tx.type, tx.amount, tx.description)
  const remaining = index.get(key) ?? 0
  if (remaining <= 0) return false
  index.set(key, remaining - 1)
  return true
}

// ─── Grouping for the "categorize now" step ───────────────────────────────────

export interface CategorizationGroup {
  key: string                  // `${normalized}|${type}`
  label: string                // normalized counterparty, for display
  type: 'income' | 'expense'
  txIndexes: number[]          // indexes into the parsed txs array
  total: number                // cents, sum of the group's transactions
  suggestedCategoryId: string | null
}

export function groupKeyFor(tx: ParsedTx): string {
  return `${normalizeCounterparty(tx.description)}|${tx.type}`
}

// Most recent categorized transaction wins per normalized counterparty+type.
// `existing` comes ordered however the app stores it, so sort by date here.
export function buildHistorySuggestions(
  existing: Pick<FinanceTransaction, 'date' | 'type' | 'description' | 'category_id'>[],
): Map<string, string> {
  const sorted = [...existing].sort((a, b) => b.date.localeCompare(a.date))
  const map = new Map<string, string>()
  for (const tx of sorted) {
    const catId = tx.category_id
    if (!catId) continue
    const key = `${normalizeCounterparty(tx.description)}|${tx.type}`
    if (!map.has(key)) map.set(key, catId)
  }
  return map
}

export function groupForCategorization(
  txs: ParsedTx[],
  selectedIdx: Set<number>,
  suggestions: Map<string, string>,
): CategorizationGroup[] {
  const groups = new Map<string, CategorizationGroup>()
  txs.forEach((tx, i) => {
    if (!selectedIdx.has(i)) return
    const key = groupKeyFor(tx)
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        label: normalizeCounterparty(tx.description) || tx.description.trim().toUpperCase(),
        type: tx.type,
        txIndexes: [],
        total: 0,
        suggestedCategoryId: suggestions.get(key) ?? null,
      }
      groups.set(key, g)
    }
    g.txIndexes.push(i)
    g.total += tx.amount
  })
  return [...groups.values()]
}

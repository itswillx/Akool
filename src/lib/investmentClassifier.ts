// Recognizes investment movements inside a bank-statement line and says what
// kind of movement it is, at which institution, in which product.
//
// Until now the statement importer only knew "this is an investment" for two
// patterns (CDB and B3) and used that knowledge to UNCHECK the row, so the
// money that left the checking account simply vanished from the app. This
// module is the other half: it extracts enough structure to file the movement
// into a position, so the balance stays honest.
//
// Pure and dependency-free: no dates parsed, no DOM, no i18n. Tested in node.

export type InvestmentAssetClass =
  | 'fixed_income' | 'treasury' | 'savings' | 'fund'
  | 'equity' | 'pension' | 'crypto' | 'other'

export type InvestmentMovementKind =
  | 'contribution'   // money left the account into the product
  | 'redemption'     // money came back from the product
  | 'yield'          // interest/dividends credited
  | 'tax'            // IR/IOF/come-cotas withheld
  | 'fee'            // custody/management fee

export interface InvestmentMatch {
  /** '' when the statement line names no recognizable institution. */
  institution: string
  /** '' when only the institution was recognized. */
  product: string
  assetClass: InvestmentAssetClass
  movementKind: InvestmentMovementKind
  /** Stable identity of the position, e.g. 'c6|cdb'. Used to upsert. */
  matchKey: string
  /**
   * 'high' — a product token matched, or an institution matched together with
   * an explicit verb. Safe to check automatically in the import preview.
   * 'low'  — recognized only by a name that doubles as an ordinary merchant, or
   * the wording contradicts the sign. Shown unchecked for the user to confirm.
   */
  confidence: 'high' | 'low'
}

// ─── Token tables ─────────────────────────────────────────────────────────────

// Order matters: the first product match wins, so more specific patterns come
// first (TESOURO before the generic FUNDO, which would swallow "FUNDO DE
// INVESTIMENTO EM TESOURO").
const PRODUCTS: { re: RegExp; product: string; assetClass: InvestmentAssetClass }[] = [
  { re: /\bTESOURO\s+SELIC\b/i, product: 'TESOURO SELIC', assetClass: 'treasury' },
  { re: /\bTESOURO\s+IPCA\b/i, product: 'TESOURO IPCA', assetClass: 'treasury' },
  { re: /\bTESOURO\s+PREFIXADO\b/i, product: 'TESOURO PREFIXADO', assetClass: 'treasury' },
  { re: /\bTESOURO(\s+DIRETO)?\b/i, product: 'TESOURO DIRETO', assetClass: 'treasury' },
  { re: /\b(LFT|LTN|NTN-?B)\b/i, product: 'TESOURO DIRETO', assetClass: 'treasury' },
  { re: /\bCDB\b/i, product: 'CDB', assetClass: 'fixed_income' },
  { re: /\bRDB\b/i, product: 'RDB', assetClass: 'fixed_income' },
  { re: /\bLCI\b/i, product: 'LCI', assetClass: 'fixed_income' },
  { re: /\bLCA\b/i, product: 'LCA', assetClass: 'fixed_income' },
  { re: /\bLCD\b/i, product: 'LCD', assetClass: 'fixed_income' },
  { re: /\bCRI\b/i, product: 'CRI', assetClass: 'fixed_income' },
  { re: /\bCRA\b/i, product: 'CRA', assetClass: 'fixed_income' },
  { re: /\bCOE\b/i, product: 'COE', assetClass: 'fixed_income' },
  { re: /\bDEB[EÊ]NTURE/i, product: 'DEBENTURE', assetClass: 'fixed_income' },
  { re: /\bPOUPAN[CÇ]A\b/i, product: 'POUPANCA', assetClass: 'savings' },
  { re: /\b(PGBL|VGBL)\b/i, product: 'PREVIDENCIA', assetClass: 'pension' },
  { re: /\bPREVID[EÊ]NCIA\b/i, product: 'PREVIDENCIA', assetClass: 'pension' },
  { re: /\bFII\b/i, product: 'FII', assetClass: 'equity' },
  { re: /\b(B3|CBLC|BOVESPA)\b/i, product: 'B3', assetClass: 'equity' },
  { re: /\b(FIC|FIM|FIA|FIDC)\b/i, product: 'FUNDO', assetClass: 'fund' },
  { re: /\bFUNDO\b/i, product: 'FUNDO', assetClass: 'fund' },
  { re: /\b(BITCOIN|CRIPTO|BINANCE|MERCADO\s+BITCOIN)\b/i, product: 'CRIPTO', assetClass: 'crypto' },
]

// Institutions whose name is distinctive enough to stand on its own, versus
// ones that double as ordinary merchant names ("TORO PIZZARIA", "CLEAR").
const INSTITUTIONS: { re: RegExp; name: string; ambiguous?: boolean }[] = [
  { re: /\bNU\s?INVEST\b/i, name: 'NUINVEST' },
  { re: /\bXP\s+INVEST/i, name: 'XP' },
  { re: /\bBTG\s+PACTUAL\b/i, name: 'BTG' },
  { re: /\bINTER\s+DTVM\b/i, name: 'INTER' },
  { re: /\bGENIAL\s+INVEST/i, name: 'GENIAL' },
  { re: /\b[OÓ]RAMA\b/i, name: 'ORAMA' },
  { re: /\bWARREN\b/i, name: 'WARREN' },
  { re: /\bAVENUE\b/i, name: 'AVENUE' },
  { re: /\bRICO\s+INVEST/i, name: 'RICO' },
  // The user's own bank names half the lines in its own statement, so it can
  // only supply the institution label once a product token is present.
  { re: /\bC6\b/i, name: 'C6', ambiguous: true },
  // Bare names that are also plausible shop names — only trusted alongside a
  // product token or an explicit verb.
  { re: /\bXP\b/i, name: 'XP', ambiguous: true },
  { re: /\bBTG\b/i, name: 'BTG', ambiguous: true },
  { re: /\bRICO\b/i, name: 'RICO', ambiguous: true },
  { re: /\bCLEAR\b/i, name: 'CLEAR', ambiguous: true },
  { re: /\bTORO\b/i, name: 'TORO', ambiguous: true },
  { re: /\bMODAL\b/i, name: 'MODAL', ambiguous: true },
  { re: /\bGENIAL\b/i, name: 'GENIAL', ambiguous: true },
  // Generic broker suffixes: strong signals, but they name no house.
  { re: /\b(DTVM|CCTVM|CTVM)\b/i, name: '', ambiguous: false },
  { re: /\bCORRETORA\b/i, name: '', ambiguous: false },
]

const YIELD_RE = /\b(RENDIMENTO|RENDIMENTOS|JUROS\s+SOBRE\s+CAPITAL|JCP|DIVIDENDO|PROVENTO|AMORTIZA[CÇ][AÃ]O|REMUNERA[CÇ][AÃ]O)/i
const TAX_RE = /\b(IOF|IRRF|COME[-\s]?COTAS|IMPOSTO\s+DE\s+RENDA)\b|\bIR\s+(SOBRE|RESGATE|RENDIMENTO)/i
const FEE_RE = /\bTAXA\s+(DE\s+)?(CUSTODIA|CUST[OÓ]DIA|ADMINISTRA[CÇ][AÃ]O)/i

const IN_RE = /\b(APLICA[CÇ][AÃ]O|APLICACAO|APLIC\b|INVESTIMENTO\s+EM|COMPRA\s+DE\s+(ATIVO|T[IÍ]TULO)|SUBSCRI[CÇ][AÃ]O)/i
const OUT_RE = /\b(RESGATE|RESG\b|LIQUIDA[CÇ][AÃ]O|VENCIMENTO|VENDA\s+DE\s+ATIVO|RETIRADA)/i

// Lines that belong to other internal categories and must never be read as
// investments, however many broker-ish words they happen to contain.
const NEVER_RE = /PGTO\s*FAT\s*CARTAO/i

function slug(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Stable position identity. Derived only from tokens — never from amount, date
 *  or a numeric counterparty — so the same product matches month after month. */
export function investmentMatchKey(institution: string, product: string, assetClass: InvestmentAssetClass): string {
  return `${slug(institution) || 'outros'}|${slug(product) || slug(assetClass)}`
}

/** Dedup identity of an imported movement, mirroring the statement dedup key. */
export function investmentImportKey(
  date: string,
  kind: InvestmentMovementKind,
  amount: number,
  description: string,
): string {
  return `${date}|${kind}|${amount}|${description.trim().toUpperCase().replace(/\s+/g, ' ')}`
}

export function classifyInvestment(
  desc: string,
  _sourceKind: string | undefined,
  type: 'income' | 'expense',
): InvestmentMatch | null {
  const d = desc.trim()
  if (!d || NEVER_RE.test(d)) return null

  const productHit = PRODUCTS.find(p => p.re.test(d))
  const institutionHit = INSTITUTIONS.find(i => i.re.test(d))
  const hasVerb = IN_RE.test(d) || OUT_RE.test(d)

  // Without a product token the line must carry a dedicated-broker signal, and
  // a house name that doubles as a shop name ("TORO PIZZARIA", "CLEAR") needs
  // an explicit verb on top of it.
  if (!productHit) {
    if (!institutionHit) return null
    if (institutionHit.ambiguous && !hasVerb) return null
  }

  const isYield = YIELD_RE.test(d)
  const isTax = TAX_RE.test(d)
  const isFee = FEE_RE.test(d)

  // Tax and fee lines only count as investment when the same line also names a
  // product or a house — otherwise "TARIFA DEP BOLETO" would be swept in.
  if ((isTax || isFee) && !productHit && !institutionHit) return null

  let movementKind: InvestmentMovementKind
  let confidence: InvestmentMatch['confidence'] = productHit ? 'high' : 'low'

  if (isYield) {
    movementKind = 'yield'
  } else if (isTax) {
    movementKind = 'tax'
  } else if (isFee) {
    movementKind = 'fee'
  } else {
    // The sign is a fact of the ledger; the wording is just text. When they
    // disagree the sign wins and the row drops to 'low' so the user confirms —
    // this is what keeps the account arithmetic consistent with reality.
    const bySign: InvestmentMovementKind = type === 'expense' ? 'contribution' : 'redemption'
    const byWord: InvestmentMovementKind | null =
      IN_RE.test(d) ? 'contribution' : OUT_RE.test(d) ? 'redemption' : null
    movementKind = bySign
    if (byWord && byWord !== bySign) confidence = 'low'
    if (!productHit && hasVerb && institutionHit) confidence = 'high'
  }

  const institution = institutionHit?.name ?? ''
  const product = productHit?.product ?? ''
  const assetClass = productHit?.assetClass ?? 'other'

  return {
    institution,
    product,
    assetClass,
    movementKind,
    matchKey: investmentMatchKey(institution, product, assetClass),
    confidence,
  }
}

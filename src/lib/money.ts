// Money helpers. Amounts are persisted and summed as integer cents so we never
// accumulate binary floating-point drift (e.g. 0.1 + 0.2 !== 0.3). Parse user
// input with `toCents`, render with `formatBRL`, and only drop back to a decimal
// number via `fromCents` when a non-cents boundary requires it. Pure and
// framework-agnostic so they can be unit-tested in isolation.

// Parse a user-typed amount into integer cents. Accepts pt-BR ("1.234,56"),
// plain ("1234.56"), en ("1,234.56"), or a numeric value already in reais.
// Returns 0 for blank/invalid input.
export function toCents(input: string | number): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : 0
  }
  let s = (input ?? '').trim().replace(/\s/g, '')
  if (!s) return 0
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // Both separators present: the rightmost one is the decimal separator and
    // the other groups thousands. "1.234,56" -> "1234.56"; "1,234.56" -> "1234.56".
    s = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // Only a comma: treat it as the decimal separator (pt-BR).
    s = s.replace(',', '.')
  }
  // Only a dot (or no separator) is already JS-parseable.
  const value = parseFloat(s)
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

// Convert integer cents back to a decimal number in reais (123456 -> 1234.56).
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

// Format integer cents as Brazilian currency (123456 -> "R$ 1.234,56").
export function formatBRL(cents: number): string {
  return fromCents(cents).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

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
    // Only commas: a single one is the pt-BR decimal separator; more than one
    // can only be en thousands grouping ("1,234,567").
    s = s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (lastDot > -1) {
    // Only dots: more than one is pt-BR thousands grouping ("1.234.567" —
    // parseFloat would silently stop at the second dot). A single dot followed
    // by exactly 3 digits also reads as pt-BR thousands ("1.500" -> R$ 1.500,00),
    // except with a leading zero ("0.500" stays half a real). Anything else
    // keeps the dot as a decimal separator ("1234.56").
    const firstDot = s.indexOf('.')
    if (firstDot !== lastDot || /^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, '')
    }
  }
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

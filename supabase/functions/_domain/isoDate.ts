// API-027: datas de calendário 'YYYY-MM-DD'. A aritmética é em UTC, então não
// há salto de horário de verão. Aqui não há relógio: o "hoje" vem sempre de
// quem chama. O app usa o relógio do aparelho (localDateKey, REL-007). No
// Deno, o fuso local é UTC, e um `new Date()` daqui viraria o dia seguinte às
// 21h em Brasília. Em _domain, o eslint barra o relógio (`new Date()`,
// `Date()`, `Date.now`) e a hora local: getters e setters locais, `Date.parse`
// e `new Date` por partes ou com texto sem Z nem offset depois da hora
// (literal, template ou concatenação com cauda literal, como
// `dia + 'T00:00:00'`). A data sem hora é UTC, mas também é barrada. `new Date(variavel)` e `dia + variavel` ele não vê: por isso o dia
// 'YYYY-MM-DD' passa sempre por toUTC.

const DAY_MS = 86_400_000

/** Meia-noite UTC de `iso`, em ms. */
export function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function isoFromUTC(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Dias inteiros de `a` até `b` (b − a). Negativo se `b` vem antes. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS)
}

export function addDays(iso: string, n: number): string {
  return isoFromUTC(toUTC(iso) + n * DAY_MS)
}

/** Segunda-feira da semana de `iso` (a semana vai de segunda a domingo). */
export function mondayOf(iso: string): string {
  const dow = new Date(toUTC(iso)).getUTCDay() // 0 = domingo … 6 = sábado
  return addDays(iso, -((dow + 6) % 7))
}

/** Card aberto com prazo antes de `today`. */
export function isOverdue(card: { due_date: string | null; completed: boolean }, today: string): boolean {
  return !!(card.due_date && !card.completed && card.due_date < today)
}

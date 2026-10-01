// REL-007: o "dia" do login diário é o do relógio de quem usa. Com
// `toISOString()`, o dia é o UTC, que em Brasília vira às 21h.

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` no fuso do aparelho. */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Meia-noite local de um `YYYY-MM-DD` (`new Date('YYYY-MM-DD')` seria meia-noite UTC). */
export function localDateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Lê `YYYY-MM-DD` como data de calendário (`new Date('YYYY-MM-DD')` seria meia-noite UTC). */
function calendarDays(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null
}

/** Dias de calendário de `from` até `to` (ambos `YYYY-MM-DD`); null se algum for inválido. */
export function localDaysBetween(from: string, to: string): number | null {
  const a = calendarDays(from)
  const b = calendarDays(to)
  return a === null || b === null ? null : b - a
}

/** Milissegundos até a próxima meia-noite local. */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
}

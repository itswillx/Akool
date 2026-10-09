import { localeOf } from '../i18n/translations'
import type { Lang } from '../i18n/translations'
import { localDateKey, localDaysBetween } from './localDate'

// NOTIF-001: tempo relativo e grupos por dia, no idioma do app ("há 5 minutos",
// "ontem"). Antes a central montava "5m"/"2h" à mão, sempre em português.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const formatters = new Map<string, Intl.RelativeTimeFormat>()
function relativeFormat(lang: Lang, numeric: 'auto' | 'always'): Intl.RelativeTimeFormat {
  const locale = localeOf(lang)
  const id = `${locale}:${numeric}`
  let format = formatters.get(id)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric, style: 'long' })
    formatters.set(id, format)
  }
  return format
}

/**
 * "agora", "há 5 minutos", "há 1 dia", "há 3 semanas". Números sempre (não
 * "ontem"/"mês passado"): "ontem" contaria 24 h e brigaria com o grupo Ontem,
 * que é pelo dia do calendário. Datas no futuro (relógio adiantado) viram "agora".
 */
export function relativeTime(date: Date, now: Date, lang: Lang): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  if (seconds < 45) return relativeFormat(lang, 'auto').format(0, 'second')
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relativeFormat(lang, 'always').format(-Math.floor(seconds / size), unit)
  }
  return relativeFormat(lang, 'always').format(-1, 'minute')
}

export type DayGroup = 'today' | 'yesterday' | 'week' | 'earlier'

/** Grupo pela data local (a virada do dia é a do aparelho, como no login diário). */
export function dayGroup(date: Date, now: Date): DayGroup {
  const days = localDaysBetween(localDateKey(date), localDateKey(now)) ?? 0
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return 'week'
  return 'earlier'
}

/** Data e hora completas, para o detalhe e o title do tempo relativo. */
export function exactDateTime(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

/** Um dia do calendário ('AAAA-MM-DD'), sem hora nem fuso: '2026-10-08' é 8 de outubro em qualquer lugar. */
export function exactDay(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`))
}

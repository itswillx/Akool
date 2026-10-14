import { addDays } from '../../../../supabase/functions/_domain/isoDate'
import { localDateKey } from '../../../lib/localDate'

// API-028: o teto dos inputs de data da venda (StatusConfirmModal e
// SaleModal). O gatilho private.store_sale_rules recusa sold_on depois de
// amanhã em São Paulo. Num aparelho adiantado (Noronha, Lisboa), nas horas
// depois da meia-noite local o amanhã do aparelho já é o depois de amanhã de
// São Paulo, e o input oferecia um dia que o servidor recusa. O teto é o menor
// dos dois: num aparelho atrasado (Manaus, Acre) continua o amanhã dele.

// formatToParts, e não o format do en-CA: a ordem das partes do format muda
// entre versões do ICU.
const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** O dia de hoje em São Paulo (YYYY-MM-DD), o mesmo relógio do gatilho. */
export function saoPauloToday(now: Date = new Date()): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => SAO_PAULO_DAY.formatToParts(now).find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** O teto da data da venda: o menor entre o amanhã do aparelho e o de São Paulo.
 *  O dia seguinte é o addDays do _domain (aritmética de calendário em UTC). */
export function saleDateMax(now: Date = new Date()): string {
  const device = addDays(localDateKey(now), 1)
  const saoPaulo = addDays(saoPauloToday(now), 1)
  return device < saoPaulo ? device : saoPaulo
}

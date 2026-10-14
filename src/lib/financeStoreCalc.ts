import { customerHistory as customerHistoryOn } from '../../supabase/functions/_domain/financeStoreCalc'
import type { StoreSaleLike } from '../../supabase/functions/_domain/storeTypes'
import { localDateKey } from './localDate'

// Pure calculations for the "Loja" submodule (finance store / resale): stock
// derived from purchases − sold − reserved, average cost, sale money and the
// monthly numbers. Money in integer cents.
//
// API-028: moram em supabase/functions/_domain/financeStoreCalc.ts (a API usa
// as mesmas, e o SQL das RPCs store_* tem a mesma conta, presa por
// _domain/fixtures/storeParity.json). Aqui ficam os nomes que os consumidores
// importam e o wrapper do customerHistory, com o dia de criação no fuso do
// aparelho (o padrão do createdDayLocal de src/lib/projectStats.ts).

export {
  averageUnitCost,
  customerStats,
  monthAggregates,
  productStock,
  purchaseTotal,
  saleItemsTotal,
  saleNetReceived,
  saleProfit,
  saleRevenue,
  stockCapital,
  uniqueItemState,
} from '../../supabase/functions/_domain/financeStoreCalc'
export type {
  CustomerStats,
  MonthAggregates,
  ProductStock,
  UniqueItemState,
} from '../../supabase/functions/_domain/financeStoreCalc'

/** Dia de calendário do `created_at` (instante em UTC do banco) no fuso do aparelho. */
export const saleCreatedDayLocal = (createdAt: string): string => localDateKey(new Date(createdAt))

/**
 * Vendas do cliente, da mais recente para a mais antiga. A venda ainda em
 * negociação (sem `sold_on`) entra pelo dia em que foi criada, no fuso do
 * aparelho: o dia UTC punha a criada às 22:30 de São Paulo no dia seguinte.
 */
export function customerHistory<T extends Pick<StoreSaleLike, 'customer_id' | 'sold_on' | 'created_at'>>(
  customerId: string,
  sales: readonly T[],
  createdDay: (createdAt: string) => string = saleCreatedDayLocal,
): T[] {
  return customerHistoryOn(customerId, sales, createdDay)
}

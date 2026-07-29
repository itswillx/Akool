// Pure calculations for the "Loja" submodule (finance store / resale). Money
// is in integer cents everywhere; quantities are integers (units of hardware),
// so sums never accumulate float drift.
//
// The central design decision: stock on hand is DERIVED, never stored. A
// product's availability is purchased − sold − reserved, where "sold" counts
// sale items whose sale reached at least 'sold' and "reserved" counts the ones
// still in 'negotiating'. Cancelling a sale returns its units automatically.
//
// Dates are 'YYYY-MM-DD' strings compared and sliced as text, never parsed
// with `new Date(string)` (UTC shift in UTC-3).

import type {
  FinanceStoreCustomer,
  FinanceStoreProduct,
  FinanceStorePurchase,
  FinanceStoreSale,
  FinanceStoreSaleItem,
  FinanceStoreSaleStatus,
} from '../types'

type PurchaseLike = Pick<FinanceStorePurchase, 'quantity' | 'unit_cost' | 'other_costs'>
type SaleItemLike = Pick<FinanceStoreSaleItem, 'quantity' | 'unit_price' | 'unit_cost_at_sale'>
type SaleMoneyLike = Pick<FinanceStoreSale, 'shipping_charged' | 'shipping_cost' | 'fees'>

/** Sale statuses that consume stock for good (the unit left the shelf). */
const CONSUMED: readonly FinanceStoreSaleStatus[] = ['sold', 'shipped', 'delivered']

// Total money that left the pocket in one purchase: the whole lot plus its
// freight/taxes. All integers, no rounding needed.
export function purchaseTotal(p: PurchaseLike): number {
  return p.quantity * p.unit_cost + p.other_costs
}

export interface ProductStock {
  purchased: number
  /** Units in sales that reached at least 'sold' (not cancelled). */
  sold: number
  /** Units held by sales still in 'negotiating'. */
  reserved: number
  /** purchased − sold − reserved. */
  available: number
}

// Derived stock for one product. Needs the sales list to know each sale item's
// status; items of cancelled sales count as returned to the shelf.
export function productStock(
  productId: string,
  purchases: Pick<FinanceStorePurchase, 'product_id' | 'quantity'>[],
  saleItems: Pick<FinanceStoreSaleItem, 'product_id' | 'sale_id' | 'quantity'>[],
  sales: Pick<FinanceStoreSale, 'id' | 'status'>[],
): ProductStock {
  const statusOf = new Map(sales.map(s => [s.id, s.status]))
  let purchased = 0
  for (const p of purchases) if (p.product_id === productId) purchased += p.quantity
  let sold = 0
  let reserved = 0
  for (const si of saleItems) {
    if (si.product_id !== productId) continue
    const status = statusOf.get(si.sale_id)
    if (status === undefined) continue
    if (CONSUMED.includes(status)) sold += si.quantity
    else if (status === 'negotiating') reserved += si.quantity
  }
  return { purchased, sold, reserved, available: purchased - sold - reserved }
}

export type UniqueItemState = 'in_stock' | 'reserved' | 'sold'

// State of a kind='unique' product, read off the same derivation. A unit that
// was both sold and (buggy data) reserved reads as sold — money talks.
export function uniqueItemState(stock: ProductStock): UniqueItemState {
  if (stock.sold > 0) return 'sold'
  if (stock.reserved > 0) return 'reserved'
  return 'in_stock'
}

// Average unit cost of everything ever purchased for a product, freight
// included, rounded once to cents. Zero when nothing was bought yet. Used as
// the default `unit_cost_at_sale` snapshot when a sale item is created.
export function averageUnitCost(
  productId: string,
  purchases: Pick<FinanceStorePurchase, 'product_id' | 'quantity' | 'unit_cost' | 'other_costs'>[],
): number {
  let total = 0
  let qty = 0
  for (const p of purchases) {
    if (p.product_id !== productId) continue
    total += purchaseTotal(p)
    qty += p.quantity
  }
  return qty > 0 ? Math.round(total / qty) : 0
}

export function saleItemsTotal(items: SaleItemLike[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
}

// Gross revenue: items plus the freight charged to the customer.
export function saleRevenue(sale: SaleMoneyLike, items: SaleItemLike[]): number {
  return saleItemsTotal(items) + sale.shipping_charged
}

// What actually lands in the account (gross minus the channel's fees). This is
// the amount of the linked income transaction.
export function saleNetReceived(sale: SaleMoneyLike, items: SaleItemLike[]): number {
  return saleRevenue(sale, items) - sale.fees
}

// Profit of a sale: revenue minus fees, minus the freight I paid, minus the
// cost snapshot of every unit that left. Cancelled sales are the caller's
// business — this computes what the numbers on the sale say.
export function saleProfit(sale: SaleMoneyLike, items: SaleItemLike[]): number {
  const cost = items.reduce((sum, i) => sum + i.quantity * i.unit_cost_at_sale, 0)
  return saleNetReceived(sale, items) - sale.shipping_cost - cost
}

// Capital sitting on the shelf: available units × average cost, across every
// non-archived product. The number the overview shows as "capital parado".
export function stockCapital(
  products: Pick<FinanceStoreProduct, 'id' | 'archived'>[],
  purchases: Pick<FinanceStorePurchase, 'product_id' | 'quantity' | 'unit_cost' | 'other_costs'>[],
  saleItems: Pick<FinanceStoreSaleItem, 'product_id' | 'sale_id' | 'quantity'>[],
  sales: Pick<FinanceStoreSale, 'id' | 'status'>[],
): number {
  let total = 0
  for (const p of products) {
    if (p.archived) continue
    const stock = productStock(p.id, purchases, saleItems, sales)
    if (stock.available <= 0) continue
    total += stock.available * averageUnitCost(p.id, purchases)
  }
  return total
}

export interface MonthAggregates {
  revenue: number
  cost: number
  profit: number
  count: number
}

// Consolidated numbers for one 'YYYY-MM': every sale whose `sold_on` falls in
// the month and whose status reached at least 'sold'. Negotiating sales have
// no `sold_on` yet and cancelled ones are excluded outright.
export function monthAggregates(
  ym: string,
  sales: FinanceStoreSale[],
  saleItems: FinanceStoreSaleItem[],
): MonthAggregates {
  const out: MonthAggregates = { revenue: 0, cost: 0, profit: 0, count: 0 }
  for (const sale of sales) {
    if (sale.status === 'cancelled' || sale.status === 'negotiating') continue
    if (!sale.sold_on || sale.sold_on.slice(0, 7) !== ym) continue
    const items = saleItems.filter(i => i.sale_id === sale.id)
    out.revenue += saleRevenue(sale, items)
    out.cost += sale.shipping_cost + sale.fees
      + items.reduce((sum, i) => sum + i.quantity * i.unit_cost_at_sale, 0)
    out.profit += saleProfit(sale, items)
    out.count += 1
  }
  return out
}

// Sales of one customer, newest first by `sold_on` (falling back to the
// `created_at` DAY for sales still in negotiation, so both sides compare as
// plain 'YYYY-MM-DD'). Cancelled sales stay in the history — they tell a
// story too.
export function customerHistory(
  customerId: string,
  sales: FinanceStoreSale[],
): FinanceStoreSale[] {
  const dayOf = (s: FinanceStoreSale) => s.sold_on ?? s.created_at.slice(0, 10)
  return sales
    .filter(s => s.customer_id === customerId)
    .sort((a, b) => dayOf(b).localeCompare(dayOf(a)))
}

export interface CustomerStats {
  /** Sales that reached at least 'sold'. */
  count: number
  /** Total revenue of those sales, in cents. */
  total: number
}

export function customerStats(
  customer: Pick<FinanceStoreCustomer, 'id'>,
  sales: FinanceStoreSale[],
  saleItems: FinanceStoreSaleItem[],
): CustomerStats {
  let count = 0
  let total = 0
  for (const sale of sales) {
    if (sale.customer_id !== customer.id) continue
    if (sale.status === 'cancelled' || sale.status === 'negotiating') continue
    count += 1
    total += saleRevenue(sale, saleItems.filter(i => i.sale_id === sale.id))
  }
  return { count, total }
}

import { describe, expect, it } from 'vitest'
import {
  averageUnitCost,
  customerHistory,
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
} from './financeStoreCalc.ts'
import { isStoreSaleStatus, type StoreProductLike, type StorePurchaseLike, type StoreSaleItemLike, type StoreSaleLike } from './storeTypes.ts'

// API-028: os testes de src/lib/financeStoreCalc.test.ts vieram para cá com o
// porte. As fábricas montam só o que os cálculos leem (os *Like de
// storeTypes.ts); a paridade com o SQL fica em storeParity.test.ts.

const product = (over: Partial<StoreProductLike> = {}): StoreProductLike => ({ id: 'p1', archived: false, ...over })

const purchase = (over: Partial<StorePurchaseLike> = {}): StorePurchaseLike => ({
  product_id: 'p1',
  quantity: 1,
  unit_cost: 0,
  other_costs: 0,
  // 'received' é o default da coluna e o que preserva o comportamento anterior
  // ao funil de compra; os testes que ligam para 'quoting' o fazem explicitamente.
  status: 'received',
  ...over,
})

const sale = (over: Partial<StoreSaleLike> = {}): StoreSaleLike => ({
  id: 's1',
  status: 'negotiating',
  customer_id: null,
  sold_on: null,
  created_at: '2026-07-01T00:00:00Z',
  shipping_charged: 0,
  shipping_cost: 0,
  fees: 0,
  ...over,
})

const saleItem = (over: Partial<StoreSaleItemLike> = {}): StoreSaleItemLike => ({
  sale_id: 's1',
  product_id: 'p1',
  quantity: 1,
  unit_price: 0,
  unit_cost_at_sale: 0,
  ...over,
})

/** Dia UTC do instante: o suficiente quando os testes não cruzam a meia-noite. */
const utcDay = (createdAt: string) => createdAt.slice(0, 10)

describe('purchaseTotal', () => {
  it('adds the freight of the lot to quantity × unit cost', () => {
    expect(purchaseTotal(purchase({ quantity: 3, unit_cost: 10_000, other_costs: 1_500 }))).toBe(31_500)
  })
})

describe('productStock', () => {
  it('derives available from purchases minus consumed and reserved units', () => {
    const purchases = [purchase({ quantity: 5 }), purchase({ quantity: 5 })]
    const sales = [
      sale({ id: 's1', status: 'delivered' }),
      sale({ id: 's2', status: 'negotiating' }),
    ]
    const items = [
      saleItem({ sale_id: 's1', quantity: 4 }),
      saleItem({ sale_id: 's2', quantity: 2 }),
    ]
    expect(productStock('p1', purchases, items, sales)).toEqual({
      purchased: 10, sold: 4, reserved: 2, available: 4,
    })
  })

  it('returns units of a cancelled sale to the shelf', () => {
    const purchases = [purchase({ quantity: 1 })]
    const items = [saleItem({ quantity: 1 })]
    const before = productStock('p1', purchases, items, [sale({ status: 'sold' })])
    expect(before.available).toBe(0)
    const after = productStock('p1', purchases, items, [sale({ status: 'cancelled' })])
    expect(after).toEqual({ purchased: 1, sold: 0, reserved: 0, available: 1 })
  })

  it('ignores purchases and sale items of other products', () => {
    const purchases = [purchase({ quantity: 2 }), purchase({ product_id: 'p2', quantity: 9 })]
    const items = [saleItem({ product_id: 'p2', quantity: 9 })]
    expect(productStock('p1', purchases, items, [sale({ status: 'sold' })]).available).toBe(2)
  })

  it('ignores items whose sale is not in the list (sale not visible)', () => {
    expect(productStock('p1', [purchase({ quantity: 2 })], [saleItem({ sale_id: 'other' })], [sale()]).available).toBe(2)
  })
})

describe('uniqueItemState', () => {
  it('maps the derived stock to the unit lifecycle', () => {
    expect(uniqueItemState({ purchased: 1, sold: 0, reserved: 0, available: 1 })).toBe('in_stock')
    expect(uniqueItemState({ purchased: 1, sold: 0, reserved: 1, available: 0 })).toBe('reserved')
    expect(uniqueItemState({ purchased: 1, sold: 1, reserved: 0, available: 0 })).toBe('sold')
  })
})

describe('averageUnitCost', () => {
  it('averages across lots with different prices, freight included', () => {
    const purchases = [
      purchase({ quantity: 2, unit_cost: 10_000, other_costs: 1_000 }), // 21_000
      purchase({ quantity: 1, unit_cost: 16_000 }), // 16_000
    ]
    expect(averageUnitCost('p1', purchases)).toBe(Math.round(37_000 / 3))
  })

  it('is zero when nothing was bought yet', () => {
    expect(averageUnitCost('p1', [])).toBe(0)
  })

  it('ignores a quoting purchase — the money did not leave yet', () => {
    const purchases = [
      purchase({ quantity: 1, unit_cost: 10_000 }),
      purchase({ quantity: 1, unit_cost: 90_000, status: 'quoting' }),
    ]
    expect(averageUnitCost('p1', purchases)).toBe(10_000)
  })

  it('counts a purchased-but-not-received lot: it is already mine', () => {
    expect(averageUnitCost('p1', [purchase({ quantity: 1, unit_cost: 10_000, status: 'purchased' })])).toBe(10_000)
  })

  it('rounds the exact half up, like div(2t + q, 2q) in SQL', () => {
    expect(averageUnitCost('p1', [purchase({ quantity: 2, unit_cost: 2, other_costs: 1 })])).toBe(3)
  })
})

describe('purchase funnel and stock', () => {
  it('keeps quoting units off the shelf', () => {
    const purchases = [purchase({ quantity: 2 }), purchase({ quantity: 5, status: 'quoting' })]
    expect(productStock('p1', purchases, [], [])).toEqual({ purchased: 2, sold: 0, reserved: 0, available: 2 })
  })

  it('counts a purchased lot that has not arrived yet', () => {
    expect(productStock('p1', [purchase({ quantity: 3, status: 'purchased' })], [], []).available).toBe(3)
  })

  it('counts a row with no status at all (rows older than the column)', () => {
    // Compat: linhas anteriores à migration chegam sem `status` e não podem
    // sumir do estoque.
    expect(productStock('p1', [{ product_id: 'p1', quantity: 4 }], [], []).available).toBe(4)
    expect(averageUnitCost('p1', [{ product_id: 'p1', quantity: 2, unit_cost: 5_000, other_costs: 0 }])).toBe(5_000)
  })

  it('leaves quoting money out of the capital sitting on the shelf', () => {
    expect(stockCapital([product()], [purchase({ quantity: 1, unit_cost: 999_999, status: 'quoting' })], [], [])).toBe(0)
  })
})

describe('sale money', () => {
  const s = sale({ shipping_charged: 3_000, shipping_cost: 2_500, fees: 4_000 })
  const items = [
    saleItem({ quantity: 1, unit_price: 150_000, unit_cost_at_sale: 100_000 }),
    saleItem({ quantity: 2, unit_price: 20_000, unit_cost_at_sale: 12_000 }),
  ]

  it('computes gross revenue with the freight charged to the customer', () => {
    expect(saleItemsTotal(items)).toBe(190_000)
    expect(saleRevenue(s, items)).toBe(193_000)
  })

  it('nets out the channel fees for the linked transaction amount', () => {
    expect(saleNetReceived(s, items)).toBe(189_000)
  })

  it('computes profit against the cost snapshot, freight paid and fees', () => {
    // 193_000 − 4_000 − 2_500 − (100_000 + 24_000)
    expect(saleProfit(s, items)).toBe(62_500)
  })

  it('net can be zero or negative (the server refuses an income then)', () => {
    expect(saleNetReceived(sale({ fees: 500 }), [saleItem({ unit_price: 0 })])).toBe(-500)
  })
})

describe('stockCapital', () => {
  it('sums available × average cost, skipping archived products', () => {
    const products = [product(), product({ id: 'p2', archived: true })]
    const purchases = [
      purchase({ quantity: 2, unit_cost: 50_000 }),
      purchase({ product_id: 'p2', quantity: 1, unit_cost: 999_999 }),
    ]
    const items = [saleItem({ quantity: 1, unit_cost_at_sale: 50_000 })]
    expect(stockCapital(products, purchases, items, [sale({ status: 'sold' })])).toBe(50_000)
  })

  it('never counts negative availability as negative capital', () => {
    const items = [saleItem({ quantity: 2 })] // sold more than purchased (dirty data)
    expect(stockCapital([product()], [purchase({ quantity: 1 })], items, [sale({ status: 'sold' })])).toBe(0)
  })
})

describe('monthAggregates', () => {
  it('aggregates sales sold in the month and excludes cancelled and negotiating', () => {
    const sales = [
      sale({ id: 's1', status: 'delivered', sold_on: '2026-07-05', fees: 1_000 }),
      sale({ id: 's2', status: 'sold', sold_on: '2026-07-20', shipping_cost: 500 }),
      sale({ id: 's3', status: 'cancelled', sold_on: '2026-07-21' }),
      sale({ id: 's4', status: 'sold', sold_on: '2026-06-30' }),
      sale({ id: 's5', status: 'negotiating' }),
      sale({ id: 's6', status: 'shipped', sold_on: null }),
    ]
    const items = [
      saleItem({ sale_id: 's1', unit_price: 100_000, unit_cost_at_sale: 60_000 }),
      saleItem({ sale_id: 's2', unit_price: 50_000, unit_cost_at_sale: 30_000 }),
      saleItem({ sale_id: 's3', unit_price: 999_999 }),
      saleItem({ sale_id: 's4', unit_price: 999_999 }),
      saleItem({ sale_id: 's6', unit_price: 999_999 }),
    ]
    expect(monthAggregates('2026-07', sales, items)).toEqual({
      revenue: 150_000,
      cost: 60_000 + 1_000 + 30_000 + 500,
      profit: 39_000 + 19_500,
      count: 2,
    })
  })
})

describe('customerHistory', () => {
  it('orders newest first, using the creation day for sales without sold_on', () => {
    const sales = [
      sale({ id: 's1', customer_id: 'k1', sold_on: '2026-06-01', status: 'delivered' }),
      sale({ id: 's2', customer_id: 'k1', sold_on: '2026-07-10', status: 'sold' }),
      sale({ id: 's3', customer_id: 'k1', sold_on: null, created_at: '2026-07-20T00:00:00Z' }),
      sale({ id: 's4', customer_id: 'k2', sold_on: '2026-07-15' }),
    ]
    expect(customerHistory('k1', sales, utcDay).map(s => s.id)).toEqual(['s3', 's2', 's1'])
  })

  it('keeps the original order for same-day sales (consistent comparator)', () => {
    const sales = [
      sale({ id: 's1', customer_id: 'k1', sold_on: '2026-07-10', status: 'sold' }),
      sale({ id: 's2', customer_id: 'k1', sold_on: null, created_at: '2026-07-10T15:00:00Z' }),
    ]
    expect(customerHistory('k1', sales, utcDay).map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('the creation day comes from the caller: 22:30 in São Paulo stays on the same day', () => {
    // Criada em 10/09 às 22:30 de São Paulo = 11/09 01:30 UTC.
    const sales = [
      sale({ id: 'vendida-10', customer_id: 'k1', status: 'sold', sold_on: '2026-09-10' }),
      sale({ id: 'negociando-10', customer_id: 'k1', created_at: '2026-09-11T01:30:00.123456+00:00' }),
    ]
    const saoPaulo = (createdAt: string) => (createdAt.startsWith('2026-09-11T01') ? '2026-09-10' : createdAt.slice(0, 10))
    expect(customerHistory('k1', sales, saoPaulo).map(s => s.id)).toEqual(['vendida-10', 'negociando-10'])
    // O dia UTC (o slice de antes) punha a negociação à frente.
    expect(customerHistory('k1', sales, utcDay).map(s => s.id)).toEqual(['negociando-10', 'vendida-10'])
  })

  it('does not reorder the list it received', () => {
    const sales = [sale({ id: 'a', customer_id: 'k1', sold_on: '2026-01-01' }), sale({ id: 'b', customer_id: 'k1', sold_on: '2026-02-01' })]
    customerHistory('k1', sales, utcDay)
    expect(sales.map(s => s.id)).toEqual(['a', 'b'])
  })
})

describe('customerStats', () => {
  it('counts and totals only sales that reached at least sold', () => {
    const sales = [
      sale({ id: 's1', customer_id: 'k1', status: 'delivered', shipping_charged: 1_000 }),
      sale({ id: 's2', customer_id: 'k1', status: 'negotiating' }),
      sale({ id: 's3', customer_id: 'k1', status: 'cancelled' }),
      sale({ id: 's4', customer_id: 'k2', status: 'sold' }),
    ]
    const items = [
      saleItem({ sale_id: 's1', unit_price: 80_000 }),
      saleItem({ sale_id: 's2', unit_price: 999_999 }),
      saleItem({ sale_id: 's4', unit_price: 999_999 }),
    ]
    expect(customerStats({ id: 'k1' }, sales, items)).toEqual({ count: 1, total: 81_000 })
  })
})

describe('isStoreSaleStatus', () => {
  it('only the five statuses of the CHECK', () => {
    expect(['negotiating', 'sold', 'shipped', 'delivered', 'cancelled'].every(isStoreSaleStatus)).toBe(true)
    expect(isStoreSaleStatus('paid')).toBe(false)
    expect(isStoreSaleStatus('')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type {
  FinanceStoreCustomer,
  FinanceStoreProduct,
  FinanceStorePurchase,
  FinanceStoreSale,
  FinanceStoreSaleItem,
} from '../types'
import {
  purchaseTotal,
  productStock,
  uniqueItemState,
  averageUnitCost,
  saleItemsTotal,
  saleRevenue,
  saleNetReceived,
  saleProfit,
  stockCapital,
  monthAggregates,
  customerHistory,
  customerStats,
} from './financeStoreCalc'

// Factories carrying only the fields the calculations read; the rest of the row
// is filled with inert defaults so the objects still satisfy the domain types.
const product = (over: Partial<FinanceStoreProduct> = {}): FinanceStoreProduct => ({
  id: 'p1',
  user_id: 'u1',
  workspace_id: null,
  kind: 'unique',
  name: 'RTX 3070',
  category: 'GPU',
  condition: 'used',
  serial_number: '',
  notes: '',
  target_price: 0,
  archived: false,
  attachments: [],
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const purchase = (over: Partial<FinanceStorePurchase> = {}): FinanceStorePurchase => ({
  id: 'c1',
  user_id: 'u1',
  workspace_id: null,
  product_id: 'p1',
  supplier_id: null,
  quantity: 1,
  unit_cost: 0,
  other_costs: 0,
  date: '2026-07-10',
  account_id: null,
  transaction_id: null,
  notes: '',
  attachments: [],
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const sale = (over: Partial<FinanceStoreSale> = {}): FinanceStoreSale => ({
  id: 's1',
  user_id: 'u1',
  workspace_id: null,
  customer_id: null,
  status: 'negotiating',
  channel: 'olx',
  sold_on: null,
  shipping_method: '',
  tracking_code: '',
  expected_delivery_on: null,
  delivered_on: null,
  shipping_charged: 0,
  shipping_cost: 0,
  fees: 0,
  account_id: null,
  transaction_id: null,
  notes: '',
  attachments: [],
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const saleItem = (over: Partial<FinanceStoreSaleItem> = {}): FinanceStoreSaleItem => ({
  id: 'si1',
  user_id: 'u1',
  workspace_id: null,
  sale_id: 's1',
  product_id: 'p1',
  product_name: 'RTX 3070',
  quantity: 1,
  unit_price: 0,
  unit_cost_at_sale: 0,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const customer = (over: Partial<FinanceStoreCustomer> = {}): FinanceStoreCustomer => ({
  id: 'k1',
  user_id: 'u1',
  workspace_id: null,
  name: 'João',
  phone: '',
  city: '',
  channel: 'olx',
  notes: '',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

describe('purchaseTotal', () => {
  it('adds the freight of the lot to quantity × unit cost', () => {
    expect(purchaseTotal(purchase({ quantity: 3, unit_cost: 10_000, other_costs: 1_500 }))).toBe(31_500)
  })
})

describe('productStock', () => {
  it('derives available from purchases minus consumed and reserved units', () => {
    const purchases = [purchase({ quantity: 5 }), purchase({ id: 'c2', quantity: 5 })]
    const sales = [
      sale({ id: 's1', status: 'delivered' }),
      sale({ id: 's2', status: 'negotiating' }),
    ]
    const items = [
      saleItem({ id: 'si1', sale_id: 's1', quantity: 4 }),
      saleItem({ id: 'si2', sale_id: 's2', quantity: 2 }),
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
    const purchases = [purchase({ quantity: 2 }), purchase({ id: 'c2', product_id: 'p2', quantity: 9 })]
    const items = [saleItem({ product_id: 'p2', quantity: 9 })]
    expect(productStock('p1', purchases, items, [sale({ status: 'sold' })]).available).toBe(2)
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
      purchase({ id: 'c2', quantity: 1, unit_cost: 16_000 }),           // 16_000
    ]
    expect(averageUnitCost('p1', purchases)).toBe(Math.round(37_000 / 3))
  })

  it('is zero when nothing was bought yet', () => {
    expect(averageUnitCost('p1', [])).toBe(0)
  })
})

describe('sale money', () => {
  const s = sale({ shipping_charged: 3_000, shipping_cost: 2_500, fees: 4_000 })
  const items = [
    saleItem({ quantity: 1, unit_price: 150_000, unit_cost_at_sale: 100_000 }),
    saleItem({ id: 'si2', quantity: 2, unit_price: 20_000, unit_cost_at_sale: 12_000 }),
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
})

describe('stockCapital', () => {
  it('sums available × average cost, skipping archived products', () => {
    const products = [product(), product({ id: 'p2', archived: true })]
    const purchases = [
      purchase({ quantity: 2, unit_cost: 50_000 }),
      purchase({ id: 'c2', product_id: 'p2', quantity: 1, unit_cost: 999_999 }),
    ]
    const sales = [sale({ status: 'sold' })]
    const items = [saleItem({ quantity: 1, unit_cost_at_sale: 50_000 })]
    expect(stockCapital(products, purchases, items, sales)).toBe(50_000)
  })

  it('never counts negative availability as negative capital', () => {
    const products = [product()]
    const items = [saleItem({ quantity: 2 })] // sold more than purchased (dirty data)
    expect(stockCapital(products, [purchase({ quantity: 1 })], items, [sale({ status: 'sold' })])).toBe(0)
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
    ]
    const items = [
      saleItem({ id: 'si1', sale_id: 's1', unit_price: 100_000, unit_cost_at_sale: 60_000 }),
      saleItem({ id: 'si2', sale_id: 's2', unit_price: 50_000, unit_cost_at_sale: 30_000 }),
      saleItem({ id: 'si3', sale_id: 's3', unit_price: 999_999 }),
      saleItem({ id: 'si4', sale_id: 's4', unit_price: 999_999 }),
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
  it('orders newest first, using created_at for sales without sold_on', () => {
    const sales = [
      sale({ id: 's1', customer_id: 'k1', sold_on: '2026-06-01', status: 'delivered' }),
      sale({ id: 's2', customer_id: 'k1', sold_on: '2026-07-10', status: 'sold' }),
      sale({ id: 's3', customer_id: 'k1', sold_on: null, created_at: '2026-07-20T00:00:00Z' }),
      sale({ id: 's4', customer_id: 'k2', sold_on: '2026-07-15' }),
    ]
    expect(customerHistory('k1', sales).map(s => s.id)).toEqual(['s3', 's2', 's1'])
  })

  it('keeps the original order for same-day sales (consistent comparator)', () => {
    const sales = [
      sale({ id: 's1', customer_id: 'k1', sold_on: '2026-07-10', status: 'sold' }),
      sale({ id: 's2', customer_id: 'k1', sold_on: null, created_at: '2026-07-10T15:00:00Z' }),
    ]
    expect(customerHistory('k1', sales).map(s => s.id)).toEqual(['s1', 's2'])
  })
})

describe('customerStats', () => {
  it('counts and totals only sales that reached at least sold', () => {
    const sales = [
      sale({ id: 's1', customer_id: 'k1', status: 'delivered', shipping_charged: 1_000 }),
      sale({ id: 's2', customer_id: 'k1', status: 'negotiating' }),
      sale({ id: 's3', customer_id: 'k1', status: 'cancelled' }),
    ]
    const items = [
      saleItem({ sale_id: 's1', unit_price: 80_000 }),
      saleItem({ id: 'si2', sale_id: 's2', unit_price: 999_999 }),
    ]
    expect(customerStats(customer(), sales, items)).toEqual({ count: 1, total: 81_000 })
  })
})

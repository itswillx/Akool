import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  averageUnitCost,
  monthAggregates,
  productStock,
  saleItemsTotal,
  saleNetReceived,
  saleProfit,
  saleRevenue,
  stockCapital,
} from './financeStoreCalc.ts'
import { SALE_TRANSITIONS, canTransition } from './saleTransitions.ts'
import { STORE_SALE_STATUSES, type StorePurchaseStatus, type StoreSaleStatus } from './storeTypes.ts'

// API-028: paridade JS ⇄ SQL. fixtures/storeParity.json tem as linhas e os
// números esperados; aqui o financeStoreCalc do app tem de chegar neles, e o
// harness supabase/checks/api028-store-sales.sql traz o MESMO JSON entre
// "parity:begin" e "parity:end" e confere que store_product_figures chega
// também. O líquido, o lucro e o mês da linha de paridade do harness são
// contas do próprio harness: o líquido das RPCs é conferido no fluxo da seção
// 8 dele (uma venda com frete pago) e, aqui, pela forma da expressão nas 5
// RPCs. Este teste prende o JSON do harness igual ao arquivo, a lista de pares
// igual à do gatilho, os CHECKs de dinheiro e a expressão do líquido na
// migration.

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'storeParity.json')
const HARNESS = join(HERE, '..', '..', 'checks', 'api028-store-sales.sql')
const MIGRATION = join(HERE, '..', '..', 'migrations', '20261012120000_api028_store_sales_server.sql')

interface Parity {
  products: { key: string; kind: string; name: string; target_price: number; archived: boolean }[]
  purchases: { product: string; quantity: number; unit_cost: number; other_costs: number; status: StorePurchaseStatus }[]
  sales: { key: string; status: StoreSaleStatus; sold_on: string | null; shipping_charged: number; shipping_cost: number; fees: number }[]
  items: { sale: string; product: string | null; quantity: number; unit_price: number; unit_cost_at_sale: number }[]
  expected: {
    figures: Record<string, { purchased: number; sold: number; reserved: number; available: number; avg_unit_cost: number }>
    sales: Record<string, { items_total: number; revenue: number; net: number; profit: number }>
    stock_capital: number
    month: { ym: string; revenue: number; cost: number; profit: number; count: number }
  }
  transitions: [StoreSaleStatus, StoreSaleStatus][]
}

const parity = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Parity
const harness = readFileSync(HARNESS, 'utf8')
const migration = readFileSync(MIGRATION, 'utf8')

// As linhas do JSON na forma que os cálculos leem (a chave faz de id).
const purchases = parity.purchases.map(p => ({ product_id: p.product, quantity: p.quantity, unit_cost: p.unit_cost, other_costs: p.other_costs, status: p.status }))
const sales = parity.sales.map(s => ({ id: s.key, status: s.status, sold_on: s.sold_on, shipping_charged: s.shipping_charged, shipping_cost: s.shipping_cost, fees: s.fees }))
const items = parity.items.map(i => ({ sale_id: i.sale, product_id: i.product, quantity: i.quantity, unit_price: i.unit_price, unit_cost_at_sale: i.unit_cost_at_sale }))

/** O corpo de `create function private.<name>` até o `$$;` que o fecha. */
function functionBody(name: string): string {
  const start = migration.indexOf(`create function private.${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  return migration.slice(start, migration.indexOf('$$;', start))
}

describe('o financeStoreCalc chega nos números do storeParity.json', () => {
  it('estoque e custo médio de cada produto (store_product_figures)', () => {
    const got = Object.fromEntries(parity.products.map(p => {
      const stock = productStock(p.key, purchases, items, sales)
      return [p.key, { ...stock, avg_unit_cost: averageUnitCost(p.key, purchases) }]
    }))
    expect(got).toEqual(parity.expected.figures)
  })

  it('itens, receita, líquido e lucro de cada venda', () => {
    const got = Object.fromEntries(sales.map(s => {
      const own = items.filter(i => i.sale_id === s.id)
      return [s.id, { items_total: saleItemsTotal(own), revenue: saleRevenue(s, own), net: saleNetReceived(s, own), profit: saleProfit(s, own) }]
    }))
    expect(got).toEqual(parity.expected.sales)
  })

  it('capital parado e resultado do mês', () => {
    const products = parity.products.map(p => ({ id: p.key, archived: p.archived }))
    expect(stockCapital(products, purchases, items, sales)).toBe(parity.expected.stock_capital)
    const { ym, ...month } = parity.expected.month
    expect(monthAggregates(ym, sales, items)).toEqual(month)
  })

  it('os números cabem no inteiro seguro do JS (a conta em double é exata)', () => {
    const all = [
      ...Object.values(parity.expected.figures).flatMap(Object.values),
      ...Object.values(parity.expected.sales).flatMap(Object.values),
      parity.expected.stock_capital,
    ]
    expect(all.every(n => Number.isSafeInteger(n))).toBe(true)
  })

  it('a fixture cobre o meio exato, os terços, a cotação, o arquivado e o disponível negativo', () => {
    expect(parity.expected.figures.half.avg_unit_cost).toBe(3)
    expect(parity.expected.figures.third.avg_unit_cost).toBe(67)
    expect(parity.purchases.some(p => p.status === 'quoting')).toBe(true)
    expect(parity.products.some(p => p.archived)).toBe(true)
    expect(Object.values(parity.expected.figures).some(f => f.available < 0)).toBe(true)
    expect(new Set(parity.sales.map(s => s.status))).toEqual(new Set(STORE_SALE_STATUSES))
  })
})

describe('o harness traz o mesmo JSON', () => {
  it('o texto entre parity:begin e parity:end é o storeParity.json', () => {
    const begin = harness.indexOf('-- parity:begin')
    const end = harness.indexOf('-- parity:end')
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(begin)
    const block = harness.slice(begin, end)
    const json = block.slice(block.indexOf('$parity$') + '$parity$'.length, block.lastIndexOf('$parity$'))
    expect(JSON.parse(json)).toEqual(parity)
  })
})

describe('a máquina de estados do banco é a do domínio', () => {
  it('os 10 pares do fixture são os de SALE_TRANSITIONS', () => {
    const key = ([f, t]: readonly [string, string]) => `${f}>${t}`
    expect(parity.transitions.map(key).sort()).toEqual(SALE_TRANSITIONS.map(key).sort())
  })

  it('o gatilho store_sale_rules lista exatamente esses pares', () => {
    const body = functionBody('store_sale_rules')
    const anchor = body.indexOf('(old.status, new.status) not in (')
    expect(anchor).toBeGreaterThanOrEqual(0)
    const list = body.slice(anchor, body.indexOf(') then', anchor))
    const pairs = [...list.matchAll(/\('([a-z]+)', '([a-z]+)'\)/g)].map(m => `${m[1]}>${m[2]}`)
    expect(pairs).toHaveLength(10)
    expect(pairs.sort()).toEqual(SALE_TRANSITIONS.map(([f, t]) => `${f}>${t}`).sort())
    for (const from of STORE_SALE_STATUSES) {
      for (const to of STORE_SALE_STATUSES) expect(pairs.includes(`${from}>${to}`), `${from}>${to}`).toBe(canTransition(from, to))
    }
  })
})

describe('os CHECKs de dinheiro da migration', () => {
  it('dinheiro >= 0 nas 4 tabelas com valores, no padrão finance_store_<t>_money_nonneg', () => {
    const checks = [...migration.matchAll(/add constraint (finance_store_\w+_money_nonneg) check \(([^;]+)\);/g)]
      .map(m => [m[1], m[2]] as const)
    expect(Object.fromEntries(checks)).toEqual({
      finance_store_products_money_nonneg: 'target_price >= 0',
      finance_store_purchases_money_nonneg: 'unit_cost >= 0 and other_costs >= 0',
      finance_store_sales_money_nonneg: 'shipping_charged >= 0 and shipping_cost >= 0 and fees >= 0',
      finance_store_sale_items_money_nonneg: 'unit_price >= 0 and unit_cost_at_sale >= 0',
    })
  })

  it('o custo médio do SQL é div(2t + q, 2q): o Math.round do app para t >= 0', () => {
    expect(migration).toContain('div(2 * b.t + b.q, 2 * b.q)::bigint')
    for (const [t, q] of [[5, 2], [200, 3], [1, 3], [0, 4], [7, 7], [1_000_000_000_000_999, 1000]]) {
      expect(Math.floor((2 * t + q) / (2 * q)), `${t}/${q}`).toBe(Math.round(t / q))
    }
  })
})

describe('o líquido das RPCs na migration', () => {
  // O saleNetReceived do app: itens + frete cobrado - taxa. O frete pago
  // (shipping_cost) é custo da venda e entra no lucro, não no líquido.
  it('as 5 contas do líquido das RPCs são itens + frete cobrado - taxa, sem o frete pago', () => {
    const head = 'coalesce(sum(i.quantity::numeric * i.unit_price), 0)'
    const tails = [...migration.matchAll(/coalesce\(sum\(i\.quantity::numeric \* i\.unit_price\), 0\)\s*([^,\n]*?)\s*(?:,|\binto\b)/g)]
      .map(m => m[1])
    expect(tails).toEqual(Array(5).fill('+ v_sale.shipping_charged - v_sale.fees'))
    const statements = migration.split(head).slice(1).map(rest => rest.slice(0, rest.indexOf(';')))
    expect(statements).toHaveLength(5)
    for (const st of statements) expect(st).not.toContain('shipping_cost')
  })
})

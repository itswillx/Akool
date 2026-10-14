// API-028: os tipos da Loja que os módulos de _domain usam (cálculos e
// transições de venda). _domain não importa src/types: src/lib/storeDomain.test.ts
// confere, pelo tsc, que estes tipos e os do app continuam iguais.
//
// Os *Like são o que cada cálculo lê de uma linha. A linha inteira do app
// (FinanceStoreSale, FinanceStoreSaleItem…) os satisfaz; a API passa a linha
// do banco, com o status já estreitado para as uniões abaixo.

export type StoreSaleStatus = 'negotiating' | 'sold' | 'shipped' | 'delivered' | 'cancelled'
export type StorePurchaseStatus = 'quoting' | 'purchased' | 'received'
export type StoreProductKind = 'unique' | 'stock'

/** A ordem do pipeline, como as colunas do quadro. */
export const STORE_SALE_STATUSES: readonly StoreSaleStatus[] = ['negotiating', 'sold', 'shipped', 'delivered', 'cancelled']

/** Estados em que a unidade saiu da prateleira de vez (e a venda tem data). */
export const STORE_CONSUMED_STATUSES: readonly StoreSaleStatus[] = ['sold', 'shipped', 'delivered']

export function isStoreSaleStatus(value: string): value is StoreSaleStatus {
  return (STORE_SALE_STATUSES as readonly string[]).includes(value)
}

/** Dinheiro de uma compra, em centavos: o lote inteiro mais o frete dele. */
export interface StorePurchaseMoney {
  quantity: number
  unit_cost: number
  other_costs: number
}

/**
 * Compra como os cálculos de estoque leem. `status` ausente conta como
 * comprometida: protege linhas anteriores à coluna e quem passa só as colunas
 * de que precisa.
 */
export interface StorePurchaseLike extends StorePurchaseMoney {
  product_id: string
  status?: StorePurchaseStatus
}

/** Dinheiro de um item de venda: preço negociado e o custo congelado na venda. */
export interface StoreSaleItemMoney {
  quantity: number
  unit_price: number
  unit_cost_at_sale: number
}

/** O que o estoque lê de um item: de qual venda e de qual produto. */
export interface StoreSaleItemRef {
  sale_id: string
  product_id: string | null
  quantity: number
}

export interface StoreSaleItemLike extends StoreSaleItemMoney, StoreSaleItemRef {}

/** Dinheiro da venda que não é de item: frete cobrado, frete pago e taxas. */
export interface StoreSaleMoney {
  shipping_charged: number
  shipping_cost: number
  fees: number
}

export interface StoreSaleLike extends StoreSaleMoney {
  id: string
  status: StoreSaleStatus
  customer_id: string | null
  /** 'YYYY-MM-DD'; nula em negociação. */
  sold_on: string | null
  /** Instante do banco (timestamptz em texto). */
  created_at: string
}

export interface StoreProductLike {
  id: string
  archived: boolean
}

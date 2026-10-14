import type { StoreSaleStatus } from './storeTypes.ts'

// Transições do pipeline de venda. Antes ficavam só no navegador
// (src/modules/finance/store/saleTransitions.ts); desde o API-028 o gatilho
// private.store_sale_rules recusa (P0001) qualquer par fora de
// SALE_TRANSITIONS, e o app e a API leem a mesma tabela daqui. O par
// "mesmo status" não é transição. fixtures/storeParity.json prende a lista
// contra o gatilho (storeParity.test.ts e o harness do API-028).

/** Passo para a frente. O cancelamento é oferecido à parte. */
export const NEXT_STATUS: Partial<Record<StoreSaleStatus, StoreSaleStatus>> = {
  negotiating: 'sold',
  sold: 'shipped',
  shipped: 'delivered',
}

export const PREV_STATUS: Partial<Record<StoreSaleStatus, StoreSaleStatus>> = {
  sold: 'negotiating',
  shipped: 'sold',
  delivered: 'shipped',
  cancelled: 'negotiating',
}

/** Estados de onde ainda faz sentido cancelar. */
export const CANCELLABLE: readonly StoreSaleStatus[] = ['negotiating', 'sold', 'shipped']

/**
 * Os 10 pares (de, para) que o banco aceita: os 3 passos à frente, os 4 para
 * trás e os 3 cancelamentos. Derivados das tabelas acima, na mesma ordem.
 */
export const SALE_TRANSITIONS: readonly (readonly [StoreSaleStatus, StoreSaleStatus])[] = [
  ...Object.entries(NEXT_STATUS).map(([from, to]) => [from as StoreSaleStatus, to] as const),
  ...Object.entries(PREV_STATUS).map(([from, to]) => [from as StoreSaleStatus, to] as const),
  ...CANCELLABLE.map(from => [from, 'cancelled'] as const),
]

export type ConfirmAction = 'sold' | 'cancelled' | 'reopen' | 'income'

/**
 * Uma transição vizinha: um passo à frente, um passo atrás, ou cancelar.
 *
 * Saltos (`negotiating → delivered`) são recusados de propósito: o modal de
 * confirmação não sabe descrever uma transição composta, e a cascata criaria e
 * apagaria transações em sequência.
 */
export function canTransition(from: StoreSaleStatus, to: StoreSaleStatus): boolean {
  return SALE_TRANSITIONS.some(([f, t]) => f === from && t === to)
}

/**
 * Qual confirmação a transição exige, ou null quando pode ser aplicada direto.
 *
 * O que pede confirmação é o que mexe no dinheiro:
 * - virar 'sold' pode CRIAR a receita (com data e categoria escolhidas);
 * - voltar para 'negotiating' com transação APAGA a receita;
 * - cancelar apaga a receita e devolve o estoque (por derivação).
 *
 * `hasTransaction` é `!!sale.transaction_id`: reabrir uma venda que nunca gerou
 * receita não tem efeito colateral e não precisa perguntar nada. Reabrir uma
 * cancelada também não pergunta: o servidor confere o estoque e recusa
 * (P0001) se a unidade já saiu em outra venda.
 */
export function confirmActionFor(
  from: StoreSaleStatus,
  to: StoreSaleStatus,
  hasTransaction: boolean,
): ConfirmAction | null {
  if (to === 'sold' && from === 'negotiating') return 'sold'
  if (to === 'cancelled') return 'cancelled'
  if (to === 'negotiating' && hasTransaction) return 'reopen'
  return null
}

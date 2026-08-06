import type { FinanceStoreSaleStatus } from '../../../types'

// Transições do pipeline de venda, extraídas do SalesView para que a lista e o
// kanban compartilhem exatamente as mesmas regras — inclusive quais transições
// exigem confirmação por mexerem em `finance_transactions`.

/** Passo para a frente. O cancelamento é oferecido à parte. */
export const NEXT_STATUS: Partial<Record<FinanceStoreSaleStatus, FinanceStoreSaleStatus>> = {
  negotiating: 'sold',
  sold: 'shipped',
  shipped: 'delivered',
}

export const PREV_STATUS: Partial<Record<FinanceStoreSaleStatus, FinanceStoreSaleStatus>> = {
  sold: 'negotiating',
  shipped: 'sold',
  delivered: 'shipped',
  cancelled: 'negotiating',
}

export const NEXT_LABEL: Record<'sold' | 'shipped' | 'delivered', 'finance_store_mark_sold' | 'finance_store_mark_shipped' | 'finance_store_mark_delivered'> = {
  sold: 'finance_store_mark_sold',
  shipped: 'finance_store_mark_shipped',
  delivered: 'finance_store_mark_delivered',
}

/** Estados de onde ainda faz sentido cancelar. */
export const CANCELLABLE: readonly FinanceStoreSaleStatus[] = ['negotiating', 'sold', 'shipped']

export type ConfirmAction = 'sold' | 'cancelled' | 'reopen' | 'income'

/**
 * Uma transição vizinha: um passo à frente, um passo atrás, ou cancelar.
 *
 * Saltos (`negotiating → delivered`) são recusados de propósito: o modal de
 * confirmação não sabe descrever uma transição composta, e a cascata criaria e
 * apagaria transações em sequência.
 */
export function canTransition(from: FinanceStoreSaleStatus, to: FinanceStoreSaleStatus): boolean {
  if (from === to) return false
  if (NEXT_STATUS[from] === to) return true
  if (PREV_STATUS[from] === to) return true
  return to === 'cancelled' && CANCELLABLE.includes(from)
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
 * receita não tem efeito colateral e não precisa perguntar nada.
 */
export function confirmActionFor(
  from: FinanceStoreSaleStatus,
  to: FinanceStoreSaleStatus,
  hasTransaction: boolean,
): ConfirmAction | null {
  if (to === 'sold' && from === 'negotiating') return 'sold'
  if (to === 'cancelled') return 'cancelled'
  if (to === 'negotiating' && hasTransaction) return 'reopen'
  return null
}

// Transições do pipeline de venda, compartilhadas pela lista e pelo kanban.
// API-028: a tabela mora em supabase/functions/_domain/saleTransitions.ts,
// a mesma que o gatilho private.store_sale_rules aplica no banco (par fora
// dela dá P0001). Aqui fica só o que é do app: as chaves de tradução.

export {
  CANCELLABLE, NEXT_STATUS, PREV_STATUS, SALE_TRANSITIONS, canTransition, confirmActionFor,
} from '../../../../supabase/functions/_domain/saleTransitions'
export type { ConfirmAction } from '../../../../supabase/functions/_domain/saleTransitions'

export const NEXT_LABEL: Record<'sold' | 'shipped' | 'delivered', 'finance_store_mark_sold' | 'finance_store_mark_shipped' | 'finance_store_mark_delivered'> = {
  sold: 'finance_store_mark_sold',
  shipped: 'finance_store_mark_shipped',
  delivered: 'finance_store_mark_delivered',
}

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { stockCapital } from '../../lib/financeStoreCalc'
import type {
  FinanceStoreProduct, FinanceStorePurchase, FinanceStoreSale, FinanceStoreSaleItem,
} from '../../types'

// Read-only bridge from the store submodule to the finance overview:
// deliberately separate from the full hook so the overview does not pay for
// loading customers and sale pipelines it will never render.
//
// It answers the question the overview could not answer before: net worth was
// only the sum of account balances, so money sitting in unsold stock was
// invisible.
//
// Já trouxe também o total de Obras (gasto conciliado × não conciliado). O
// submódulo foi removido e as obras viraram metas, cujo acumulado sai das
// contribuições — não há mais um bolso fora do fluxo de caixa para reportar.

export interface AllocationSummary {
  /** Available units × average cost, across non-archived products. */
  stockCapital: number
  loading: boolean
  reload: () => Promise<void>
}

export function useAllocationSummary(userId: string | undefined): AllocationSummary {
  const [stock, setStock] = useState(0)
  const [loading, setLoading] = useState(true)

  // Returns the computed values instead of writing state, so both the effect
  // (which must ignore a late response) and the manual reload can use it.
  const fetchSummary = useCallback(async () => {
    if (!userId) return null
    const [prod, pur, saleItems, sales] = await Promise.all([
      supabase.from('finance_store_products').select('id,archived'),
      supabase.from('finance_store_purchases').select('product_id,quantity,unit_cost,other_costs'),
      supabase.from('finance_store_sale_items').select('product_id,sale_id,quantity'),
      supabase.from('finance_store_sales').select('id,status'),
    ])
    return {
      stockCapital: stockCapital(
        (prod.data as Pick<FinanceStoreProduct, 'id' | 'archived'>[]) ?? [],
        (pur.data as Pick<FinanceStorePurchase, 'product_id' | 'quantity' | 'unit_cost' | 'other_costs'>[]) ?? [],
        (saleItems.data as Pick<FinanceStoreSaleItem, 'product_id' | 'sale_id' | 'quantity'>[]) ?? [],
        (sales.data as Pick<FinanceStoreSale, 'id' | 'status'>[]) ?? [],
      ),
    }
  }, [userId])

  const apply = (data: Awaited<ReturnType<typeof fetchSummary>>) => {
    if (!data) return
    setStock(data.stockCapital)
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    // Keeps a late response from a previous user id (or an unmounted panel)
    // from writing into fresh state.
    fetchSummary().then(data => { if (!cancelled) apply(data) })
    return () => { cancelled = true }
  }, [fetchSummary])

  const reload = useCallback(async () => { apply(await fetchSummary()) }, [fetchSummary])

  return { stockCapital: stock, loading, reload }
}

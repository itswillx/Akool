import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { projectsCashSplit, type ProjectsCashSplit } from '../../lib/financeProjectCalc'
import { stockCapital } from '../../lib/financeStoreCalc'
import type {
  FinanceProject, FinanceProjectExpense,
  FinanceStoreProduct, FinanceStorePurchase, FinanceStoreSale, FinanceStoreSaleItem,
} from '../../types'

// Read-only bridge from the works and store submodules to the finance overview,
// following useProjectsSummary: deliberately separate from the full hooks so the
// overview does not pay for loading stages, quotes, customers and sale pipelines
// it will never render.
//
// It answers the question the overview could not answer before: net worth was
// only the sum of account balances, so money sitting in a works project or in
// unsold stock was invisible — and the works total sat next to the cash flow
// with nothing saying the two describe the same money.

export interface AllocationSummary {
  projects: ProjectsCashSplit
  projectCount: number
  /** Available units × average cost, across non-archived products. */
  stockCapital: number
  loading: boolean
  reload: () => Promise<void>
}

export function useAllocationSummary(userId: string | undefined): AllocationSummary {
  const [projects, setProjects] = useState<ProjectsCashSplit>({ total: 0, linked: 0, unlinked: 0 })
  const [projectCount, setProjectCount] = useState(0)
  const [stock, setStock] = useState(0)
  const [loading, setLoading] = useState(true)

  // Returns the computed values instead of writing state, so both the effect
  // (which must ignore a late response) and the manual reload can use it.
  const fetchSummary = useCallback(async () => {
    if (!userId) return null
    const [pr, ex, prod, pur, saleItems, sales] = await Promise.all([
      supabase.from('finance_projects').select('id,status'),
      supabase.from('finance_project_expenses').select('project_id,amount,transaction_id'),
      supabase.from('finance_store_products').select('id,archived'),
      supabase.from('finance_store_purchases').select('product_id,quantity,unit_cost,other_costs'),
      supabase.from('finance_store_sale_items').select('product_id,sale_id,quantity'),
      supabase.from('finance_store_sales').select('id,status'),
    ])
    const projectRows = (pr.data as Pick<FinanceProject, 'id' | 'status'>[]) ?? []
    const expenseRows = (ex.data as Pick<FinanceProjectExpense, 'project_id' | 'amount' | 'transaction_id'>[]) ?? []
    return {
      projects: projectsCashSplit(projectRows, expenseRows),
      projectCount: projectRows.filter(p => p.status === 'active' || p.status === 'planning').length,
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
    setProjects(data.projects)
    setProjectCount(data.projectCount)
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

  return { projects, projectCount, stockCapital: stock, loading, reload }
}

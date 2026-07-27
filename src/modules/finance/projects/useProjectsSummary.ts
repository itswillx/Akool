import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { activeProjectsSpent } from '../../../lib/financeProjectCalc'
import type { FinanceProject, FinanceProjectExpense } from '../../../types'

// Read-only, one-directional bridge from the works submodule to the finance
// overview: obra spending never becomes a finance_transaction, so the cash flow
// only ever sees this single consolidated number.
//
// Deliberately separate from useFinanceProjects: the overview must not pay for
// loading stages, items and quotes it will not render.
export function useProjectsSummary(userId: string | undefined) {
  const [total, setTotal] = useState(0)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('finance_projects').select('id,status'),
      supabase.from('finance_project_expenses').select('project_id,amount'),
    ]).then(([pr, ex]) => {
      if (cancelled) return
      const projects = (pr.data as Pick<FinanceProject, 'id' | 'status'>[]) ?? []
      const expenses = (ex.data as FinanceProjectExpense[]) ?? []
      setTotal(activeProjectsSpent(projects, expenses))
      setCount(projects.filter(p => p.status === 'active' || p.status === 'planning').length)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId])

  return { total, count, loading }
}

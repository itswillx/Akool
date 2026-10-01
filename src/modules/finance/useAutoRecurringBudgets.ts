// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import {
    missingAutoBudgets
} from '../../lib/financeCalc'
import { supabase } from '../../lib/supabase'
import { withCategory } from './financeLoad'
import type { useFinanceData } from './useFinanceData'

export function useAutoRecurringBudgets({ data, month }: { data: ReturnType<typeof useFinanceData>; month: string }) {
  const { user } = useAuth()
  const { recurring, budgets, familyBudgets, setBudgets, setFamilyBudgets } = data

  // Auto-create a budget for the viewed month from each active, fixed-amount
  // expense recurring that doesn't have one yet, so it counts toward expense
  // tracking without manual setup. Only ever inserts — never edits/removes a
  // budget once created, even if the recurring is later deactivated or its
  // amount changes, and never touches a budget that already exists (manual or
  // auto-created before) for that category/month/scope.
  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    const candidates = missingAutoBudgets(recurring, [...budgets, ...familyBudgets], month)
    if (candidates.length === 0) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('finance_budgets').insert(
        candidates.map(c => ({ ...c, user_id: userId, shared_with_user_id: null }))
      ).select()
      if (!error && !cancelled) {
        // Payload is fully known from the insert response — no reload needed.
        const rows = withCategory(data)
        setBudgets(prev => [...prev, ...rows.filter(b => !b.workspace_id)])
        setFamilyBudgets(prev => [...prev, ...rows.filter(b => b.workspace_id)])
      }
    })()
    return () => { cancelled = true }
  }, [user?.id, recurring, budgets, familyBudgets, month])
}

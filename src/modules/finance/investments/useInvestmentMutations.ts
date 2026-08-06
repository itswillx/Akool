import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { FinanceInvestment } from '../../../types'

// Write-only companion to the investments tab.
//
// Deliberately has no fetching of its own: positions and movements are already
// loaded by useFinanceData in FinancePanel, because the account balance depends
// on them. Loading them a second time here would double the queries and let the
// two copies disagree after a write. Mutations call `onChanged` (the panel's
// `reload`) instead of keeping local state.

export type PositionDraft = Pick<
  FinanceInvestment,
  'institution' | 'product' | 'asset_class' | 'account_id' | 'opening_balance' | 'archived' | 'notes'
>

export interface InvestmentMutations {
  savePosition: (position: FinanceInvestment, draft: PositionDraft) => Promise<void>
  deletePosition: (id: string) => Promise<void>
  deleteMovement: (id: string) => Promise<void>
  error: string | null
  clearError: () => void
  busy: boolean
}

export function useInvestmentMutations(onChanged: () => Promise<void> | void): InvestmentMutations {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // PromiseLike, not Promise: a supabase query builder is a thenable that only
  // becomes a promise when awaited.
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true)
    try {
      const { error: err } = await fn()
      if (err) { setError(err.message); return }
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return {
    error,
    busy,
    clearError: () => setError(null),

    savePosition: (position, draft) => run(() =>
      supabase.from('finance_investments')
        .update({ ...draft, updated_at: new Date().toISOString() })
        .eq('id', position.id)),

    // The movements cascade with the position (FK ON DELETE CASCADE), which is
    // what makes the derived balance return to zero instead of stranding rows.
    deletePosition: id => run(() =>
      supabase.from('finance_investments').delete().eq('id', id)),

    deleteMovement: id => run(() =>
      supabase.from('finance_investment_movements').delete().eq('id', id)),
  }
}

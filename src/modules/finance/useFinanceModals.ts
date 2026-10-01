// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useState } from 'react'
import type { FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceRecurring, FinanceRecurringEntry, FinanceTransaction } from '../../types'

// Estado dos modais do financeiro (qual está aberto e com que item).
export function useFinanceModals() {

  // Modals
  const [txModal, setTxModal] = useState<{ open: boolean; tx?: FinanceTransaction }>({ open: false })
  const [accModal, setAccModal] = useState<{ open: boolean; account?: FinanceAccount }>({ open: false })
  const [budgetModal, setBudgetModal] = useState<{ open: boolean; budget?: FinanceBudget }>({ open: false })
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: FinanceGoal }>({ open: false })
  const [contributionGoal, setContributionGoal] = useState<FinanceGoal | null>(null)
  const [catModal, setCatModal] = useState<{ open: boolean; category?: FinanceCategory }>({ open: false })
  const [recurringModal, setRecurringModal] = useState<{ open: boolean; item?: FinanceRecurring }>({ open: false })
  const [payModal, setPayModal] = useState<{ open: boolean; entry?: FinanceRecurringEntry; rec?: FinanceRecurring }>({ open: false })
  const [goalShareModal, setGoalShareModal] = useState<{ open: boolean; goal?: FinanceGoal }>({ open: false })
  const [importModal, setImportModal] = useState(false)
  // Full-column, all-time history for the import modal's duplicate detection
  // and merchant-history category suggestions (both need `description` and
  // history beyond the loaded month window) — fetched on demand when the
  // modal opens rather than kept in the hook's state.
  const [importHistoryTxs, setImportHistoryTxs] = useState<FinanceTransaction[]>([])
  return { txModal, setTxModal, accModal, setAccModal, budgetModal, setBudgetModal, goalModal, setGoalModal, contributionGoal, setContributionGoal, catModal, setCatModal, recurringModal, setRecurringModal, payModal, setPayModal, goalShareModal, setGoalShareModal, importModal, setImportModal, importHistoryTxs, setImportHistoryTxs }
}

// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { supabase } from '../../lib/supabase'
import type { FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceGoalShare, FinanceRecurring, FinanceRecurringEntry, FinanceTransaction } from '../../types'
import { fetchFullHistoryTx, type useFinanceData } from './useFinanceData'
import type { useFinanceModals } from './useFinanceModals'

// Gravações do financeiro (antes dentro do FinancePanel). Os corpos são os
// mesmos: as variáveis que eles usam vêm dos mesmos nomes abaixo.
export function useFinanceActions({ data, modals }: {
  data: ReturnType<typeof useFinanceData>
  modals: ReturnType<typeof useFinanceModals>
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const { showToast } = useToast()
  const { goals, contributions, partnerProfiles, recurringEntries, reload, ensureMonthLoaded, ensureMonthsLoaded, setAccounts, setCategories, setBudgets, setGoals, setContributions, setGoalShares, setPartnerProfiles, setRecurring, setRecurringEntries, setFamilyBudgets, setFamilyAccounts, setFamilyCategories, applyTxUpsert, applyTxRemove, resolvePartnerProfile, refetchTransactions, refetchRecurringAndEntries, workspace } = data
  const { txModal, accModal, budgetModal, goalModal, catModal, recurringModal, setPayModal, setImportHistoryTxs, setImportModal } = modals

  // Runs a mutation's write+local-patch; on failure, logs, toasts, and (for
  // modal-driven saves) rethrows so the modal's own catch keeps the form open
  // instead of closing on a failed write. Fire-and-forget list-row actions
  // pass no `rethrow` and just swallow the error after toasting.
  const withToast = async (write: () => Promise<void>, message: string, opts?: { rethrow?: boolean }) => {
    try {
      await write()
    } catch (err) {
      console.error('[Finance]', message, err)
      showToast('error', message)
      if (opts?.rethrow) throw err
    }
  }

  // Small local upsert-by-id used by the handlers below that don't already
  // have one from useFinanceData (applyTxUpsert/applyTxRemove cover
  // transactions; this covers the flat, single-bucket entities).
  const upsertById = <T extends { id: string }>(arr: T[], row: T) =>
    arr.some(x => x.id === row.id) ? arr.map(x => (x.id === row.id ? row : x)) : [...arr, row]

  // CRUD helpers — each applies the write's own response (or a plain local
  // patch) directly to state instead of calling `reload()` (~15+ queries).
  // See PERF-002: only `bulkImport` below still does a full reload, since a
  // statement import can touch many months/rows at once.
  const saveTx = async (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { data: row, error } = txModal.tx
      ? await supabase.from('finance_transactions').update(data).eq('id', txModal.tx.id).select().single()
      : await supabase.from('finance_transactions').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    // A create/edit can land outside the currently loaded month window (most
    // often an edit moving the date) — extend the window first so it doesn't
    // look like the write silently vanished.
    await ensureMonthLoaded(data.date.slice(0, 7))
    applyTxUpsert(row)
  }

  const deleteTx = async (id: string) => {
    const { error } = await supabase.from('finance_transactions').delete().eq('id', id)
    if (error) throw error
    applyTxRemove(id)
  }

  const quickAddTx = async (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { data: row, error } = await supabase.from('finance_transactions').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    await ensureMonthLoaded(data.date.slice(0, 7))
    applyTxUpsert(row)
  }

  // Single entry point for the statement import. Já roteava parte das linhas
  // para finance_investment_movements; com Investimentos removido, toda linha
  // importada é lançamento — o aporte reconhecido pelo classificador chega
  // marcado como transferência interna e nasce desmarcado.
  const bulkImport = async (
    rows: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>[],
  ) => {
    if (!user) return
    if (rows.length === 0) return
    const { error } = await supabase.from('finance_transactions').insert(rows.map(r => ({ ...r, user_id: user.id })))
    if (error) throw error
    // Statement rows can span arbitrary historical months.
    await ensureMonthsLoaded(rows.map(r => r.date.slice(0, 7)))
    // Bulk import genuinely touches many rows across many months — a full
    // reload stays cheaper and simpler than patching each row individually.
    await reload()
  }

  const bulkDeleteTx = async (ids: string[]) => {
    if (ids.length === 0) return
    await withToast(async () => {
      const { error } = await supabase.from('finance_transactions').delete().in('id', ids)
      if (error) throw error
      ids.forEach(applyTxRemove)
    }, t('finance_delete_error'))
  }

  // Accounts/budgets are dual-bucket: `accounts`/`budgets` hold everything the
  // user owns (any workspace_id), `familyAccounts`/`familyBudgets` hold
  // everything visible in the current workspace (any owner) — a
  // workspace-scoped row owned by the user appears in both.
  const saveAccount = async (data: Omit<FinanceAccount, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { data: row, error } = accModal.account
      ? await supabase.from('finance_accounts').update(data).eq('id', accModal.account.id).select().single()
      // Scope (workspace_id) comes from the modal's ScopePicker inside `data`.
      : await supabase.from('finance_accounts').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    const acc: FinanceAccount = row
    setAccounts(prev => upsertById(prev, acc))
    setFamilyAccounts(prev => {
      const stripped = prev.filter(a => a.id !== acc.id)
      return acc.workspace_id ? upsertById(stripped, acc) : stripped
    })
  }

  const deleteAccount = async (id: string) => {
    const { error } = await supabase.from('finance_accounts').delete().eq('id', id)
    if (error) throw error
    // Balances are derived from txAggOwn, not stored — no transactions
    // refetch needed. Filtering both buckets unconditionally is a no-op on
    // whichever one didn't have the row.
    setAccounts(prev => prev.filter(a => a.id !== id))
    setFamilyAccounts(prev => prev.filter(a => a.id !== id))
  }

  const saveBudget = async (data: { category_id: string; month: string; amount_limit: number; shared_with_user_id: string | null; workspace_id: string | null }) => {
    if (!user) return
    // Scope (workspace_id) comes from the modal's ScopePicker inside `data`.
    const { data: row, error } = budgetModal.budget
      ? await supabase.from('finance_budgets').update(data).eq('id', budgetModal.budget.id).select().single()
      : await supabase.from('finance_budgets').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    // A linha gravada tem a categoria que mandamos (a coluna só não é NOT NULL).
    const budget: FinanceBudget = { ...row, category_id: data.category_id }
    setBudgets(prev => upsertById(prev, budget))
    setFamilyBudgets(prev => {
      const stripped = prev.filter(b => b.id !== budget.id)
      return budget.workspace_id ? upsertById(stripped, budget) : stripped
    })
  }

  const saveGoalShare = async (goalId: string, sharedWithUserId: string) => {
    if (!user) return
    const { data: row, error } = await supabase.from('finance_goal_shares')
      .upsert({ goal_id: goalId, owner_id: user.id, shared_with_user_id: sharedWithUserId }, { onConflict: 'goal_id,shared_with_user_id' })
      .select().single()
    if (error) throw error
    let profile = partnerProfiles.find(p => p.id === sharedWithUserId)
    if (!profile) {
      const resolved = await resolvePartnerProfile(sharedWithUserId)
      if (resolved) { profile = resolved; setPartnerProfiles(prev => [...prev, resolved]) }
    }
    const withProfile: FinanceGoalShare = { ...row, profile }
    setGoalShares(prev => upsertById(prev, withProfile))
  }

  const deleteGoalShare = async (shareId: string) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_goal_shares').delete().eq('id', shareId)
      if (error) throw error
      setGoalShares(prev => prev.filter(s => s.id !== shareId))
    }, t('finance_delete_error'))
  }

  const deleteBudget = async (budget: FinanceBudget) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_budgets').delete().eq('id', budget.id)
      if (error) throw error
      setBudgets(prev => prev.filter(b => b.id !== budget.id))
      setFamilyBudgets(prev => prev.filter(b => b.id !== budget.id))
    }, t('finance_delete_error'))
  }

  // Goals aren't dual-bucket like accounts/budgets — `goals` is a single flat
  // array (RLS already scopes it to own + shared + workspace-visible rows).
  const saveGoal = async (data: Omit<FinanceGoal, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { data: row, error } = goalModal.goal
      ? await supabase.from('finance_goals').update(data).eq('id', goalModal.goal.id).select().single()
      : await supabase.from('finance_goals').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    setGoals(prev => upsertById(prev, row as FinanceGoal))
  }

  const deleteGoal = async (id: string) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_goals').delete().eq('id', id)
      if (error) throw error
      setGoals(prev => prev.filter(g => g.id !== id))
      // finance_goal_contributions.goal_id and finance_goal_shares.goal_id are
      // both ON DELETE CASCADE — mirror that locally.
      setContributions(prev => prev.filter(c => c.goal_id !== id))
      setGoalShares(prev => prev.filter(s => s.goal_id !== id))
    }, t('finance_delete_error'))
  }

  const updateGoalStatus = async (id: string, status: FinanceGoal['status']) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_goals').update({ status }).eq('id', id)
      if (error) throw error
      setGoals(prev => prev.map(g => (g.id === id ? { ...g, status } : g)))
    }, t('finance_save_error'))
  }

  const saveContribution = async (data: { goal_id: string; amount: number; note: string; date: string }) => {
    if (!user) return
    const { data: row, error } = await supabase.from('finance_goal_contributions').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    const contribution: FinanceGoalContribution = row
    setContributions(prev => [contribution, ...prev])
    // Auto-complete goal if accumulated >= target. This second write is
    // best-effort: if it fails, the contribution is still saved (matches
    // prior behavior) — just toast a distinct warning instead of throwing,
    // since the modal shouldn't treat the whole save as failed.
    const goal = goals.find(g => g.id === data.goal_id)
    if (goal && goal.status === 'active') {
      const total = contributions.filter(c => c.goal_id === data.goal_id).reduce((s, c) => s + c.amount, 0) + data.amount
      if (total >= goal.target_amount) {
        const { data: goalRow, error: goalErr } = await supabase.from('finance_goals').update({ status: 'completed' }).eq('id', data.goal_id).select().single()
        if (goalErr) {
          console.error('[Finance] goal auto-complete failed:', goalErr)
          showToast('error', t('finance_goal_complete_error'))
        } else {
          setGoals(prev => upsertById(prev, goalRow as FinanceGoal))
        }
      }
    }
  }

  const deleteContribution = async (id: string) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_goal_contributions').delete().eq('id', id)
      if (error) throw error
      // Preserve prior behavior: doesn't un-complete an auto-completed goal.
      setContributions(prev => prev.filter(c => c.id !== id))
    }, t('finance_delete_error'))
  }

  // Categories ARE single-bucket (unlike accounts/budgets): `categories` is
  // filtered `.is('workspace_id', null)` server-side, `familyCategories` is
  // the workspace-only complement — so a scope change on edit must move the
  // row between buckets, not just upsert into both.
  const saveCategory = async (data: Omit<FinanceCategory, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { data: row, error } = catModal.category
      ? await supabase.from('finance_categories').update(data).eq('id', catModal.category.id).select().single()
      // Scope (workspace_id) comes from the modal's ScopePicker inside `data`.
      : await supabase.from('finance_categories').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    const cat: FinanceCategory = row
    if (cat.workspace_id) {
      setFamilyCategories(prev => upsertById(prev, cat))
      setCategories(prev => prev.filter(c => c.id !== cat.id))
    } else {
      setCategories(prev => upsertById(prev, cat))
      setFamilyCategories(prev => prev.filter(c => c.id !== cat.id))
    }
  }

  const deleteCategory = async (id: string) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_categories').delete().eq('id', id)
      if (error) throw error
      setCategories(prev => prev.filter(c => c.id !== id))
      setFamilyCategories(prev => prev.filter(c => c.id !== id))
      // finance_budgets.category_id is ON DELETE CASCADE — mirror it locally
      // so no ghost budget survives referencing a category that's gone.
      setBudgets(prev => prev.filter(b => b.category_id !== id))
      setFamilyBudgets(prev => prev.filter(b => b.category_id !== id))
      // transactions[].category_id is ON DELETE SET NULL server-side and is
      // intentionally left stale here: accMap/catMap lookups (built from the
      // current categories array) simply miss the dangling id and render it
      // as "no category", same as null — a harmless, self-correcting gap.
    }, t('finance_delete_error'))
  }

  const saveRecurring = async (data: Omit<FinanceRecurring, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { data: row, error } = recurringModal.item
      ? await supabase.from('finance_recurring').update(data).eq('id', recurringModal.item.id).select().single()
      : await supabase.from('finance_recurring').insert({ ...data, user_id: user.id }).select().single()
    if (error) throw error
    setRecurring(prev => upsertById(prev, row as FinanceRecurring))
  }

  const deleteRecurring = async (id: string) => {
    const { error } = await supabase.from('finance_recurring').delete().eq('id', id)
    if (error) throw error
    setRecurring(prev => prev.filter(r => r.id !== id))
    // finance_recurring_entries.recurring_id is ON DELETE CASCADE — mirror it
    // locally instead of refetching.
    setRecurringEntries(prev => prev.filter(e => e.recurring_id !== id))
  }

  // Three sequential writes (tx insert → entry update → conditional recurring
  // deactivate). Not worth a 3-way manual rollback: a mid-sequence failure
  // leaves genuinely ambiguous server state, so on any failure this falls
  // back to a targeted refetch of just the touched entities to reconcile,
  // rather than reload()'s full ~15+ query sweep.
  const doMarkPaid = async (entry: FinanceRecurringEntry, rec: FinanceRecurring, amount: number) => {
    if (!user) return
    try {
      const { data: txRow, error: txErr } = await supabase
        .from('finance_transactions')
        .insert({ user_id: user.id, type: rec.type, amount, description: rec.description, date: entry.due_date, account_id: rec.account_id, category_id: rec.category_id })
        .select().single()
      if (txErr) throw txErr
      const tx: FinanceTransaction = txRow

      const { data: entryRow, error: entryErr } = await supabase.from('finance_recurring_entries')
        .update({ status: 'paid', amount, transaction_id: tx.id })
        .eq('id', entry.id)
        .select().single()
      if (entryErr) throw entryErr

      let updatedRec: FinanceRecurring | null = null
      if (rec.total_installments != null) {
        const paidBefore = recurringEntries.filter(e => e.recurring_id === rec.id && e.status === 'paid').length
        if (paidBefore + 1 >= rec.total_installments) {
          const { data: recRow, error: recErr } = await supabase.from('finance_recurring').update({ active: false }).eq('id', rec.id).select().single()
          if (recErr) throw recErr
          updatedRec = recRow
        }
      }

      // Defensive: entries are normally this month/next, already in range,
      // but a stale overdue entry could be paid from further back.
      await ensureMonthLoaded(entry.due_date.slice(0, 7))
      applyTxUpsert(tx)
      setRecurringEntries(prev => upsertById(prev, entryRow))
      if (updatedRec) setRecurring(prev => upsertById(prev, updatedRec))
    } catch (err) {
      console.error('[Finance] doMarkPaid failed:', err)
      showToast('error', t('finance_save_error'))
      // The sequence may have partially landed server-side — reconcile with
      // a couple of targeted queries instead of guessing which write(s) hit.
      await refetchTransactions()
      await refetchRecurringAndEntries()
      throw err
    }
  }

  const handleMarkPaid = (entry: FinanceRecurringEntry, rec: FinanceRecurring) => {
    if (rec.is_variable) {
      setPayModal({ open: true, entry, rec })
    } else {
      // Fixed-amount path: fired directly from a list row, nothing awaits or
      // catches it — doMarkPaid already toasts internally before rethrowing,
      // this just silences the resulting unhandled-rejection warning.
      doMarkPaid(entry, rec, rec.amount ?? 0).catch(() => {})
    }
  }

  const skipEntry = async (entryId: string) => {
    await withToast(async () => {
      const { error } = await supabase.from('finance_recurring_entries').update({ status: 'skipped' }).eq('id', entryId)
      if (error) throw error
      setRecurringEntries(prev => prev.map(e => (e.id === entryId ? { ...e, status: 'skipped' } : e)))
    }, t('finance_save_error'))
  }


  const openImportModal = async () => {
    if (!user) return
    const { own, workspaceOthers, error } = await fetchFullHistoryTx(user.id, workspace?.id ?? null)
    // Histórico parcial deixaria duplicatas passarem na detecção: não abre.
    if (error) {
      console.error('[finance] import history load failed', error)
      showToast('error', t('finance_tx_load_error'), { dedupeKey: 'finance-tx-load-error' })
      return
    }
    setImportHistoryTxs([...own, ...workspaceOthers])
    setImportModal(true)
  }

  return { openImportModal, saveTx, deleteTx, quickAddTx, bulkImport, bulkDeleteTx, saveAccount, deleteAccount, saveBudget, saveGoalShare, deleteGoalShare, deleteBudget, saveGoal, deleteGoal, updateGoalStatus, saveContribution, deleteContribution, saveCategory, deleteCategory, saveRecurring, deleteRecurring, doMarkPaid, handleMarkPaid, skipEntry }
}

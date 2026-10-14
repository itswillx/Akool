// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { fetchAllRows, type AllRowsResult, type ReadError } from '../../lib/fetchAllRows'
import {
FINANCE_TX_AGG_COLUMNS, type FinanceTxAgg
} from '../../lib/financeCalc'
import { deviceToday, materializeRecurring, type MaterializedRecurring } from '../../lib/data/financeRecurring'
import { firstError } from '../../lib/optimistic'
import { supabase } from '../../lib/supabase'
import type { FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceGoalShare, FinanceRecurring, FinanceRecurringEntry, FinanceTransaction, FinanceWorkspace, FinanceWorkspaceInvite, FinanceWorkspaceMember } from '../../types'
import { currentYM, nextMonth, prevMonth } from './financeFormat'
import { mergeById, mergePendingInvites, mergeRecurringEntries, needsCategoryBootstrap, splitMaterializedBudgets, withCategory } from './financeLoad'

// ─── On-demand full-history fetch ──────────────────────────────────────────────
// `useFinanceData` only keeps a month window + a lean aggregate in state now.
// The handful of consumers that genuinely need full-column, lifetime rows
// (PDF export; the import modal's duplicate detection and merchant-history
// category suggestions) fetch it themselves, on demand, instead of paying for
// it on every page load.
export async function fetchFullHistoryTx(userId: string, wsId: string | null) {
  const [ownRes, wsRes] = await Promise.all([
    fetchTx<FinanceTransaction>('*', 'user_id', userId),
    wsId ? fetchTx<FinanceTransaction>('*', 'workspace_id', wsId) : NO_TX,
  ])
  const own = ownRes.data ?? []
  const workspaceOthers = (wsRes.data ?? []).filter(tx => tx.user_id !== userId)
  return { own, workspaceOthers, error: ownRes.error ?? wsRes.error }
}

// REL-003: toda leitura de transações passa pelo fetchAllRows. Sem ele, o
// PostgREST corta em 1000 linhas sem erro, e saldo, gráfico e detecção de
// duplicata ficam errados. A ordem termina em `id` para as páginas não se
// sobreporem; `date`/`created_at` desc é a ordem que a aba Transações espera.
type TxScope = 'user_id' | 'shared_with_user_id' | 'workspace_id'

const NO_TX = Promise.resolve({ data: [], error: null } as AllRowsResult<never>)

function fetchTx<T>(columns: string, scope: TxScope, id: string, dates?: { from: string; before: string }) {
  return fetchAllRows<T>((from, to) => {
    let query = supabase.from('finance_transactions').select(columns).eq(scope, id)
    if (dates) query = query.gte('date', dates.from).lt('date', dates.before)
    return query
      .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to)
      .overrideTypes<T[], { merge: false }>()
  })
}

// ─── Partner profile type ─────────────────────────────────────────────────────

export interface PartnerProfile {
  id: string
  email: string
  display_name: string | null
  avatar_emoji?: string | null
  avatar_color?: string | null
  avatar_url?: string | null
}

// ─── Data hook ────────────────────────────────────────────────────────────────

export function useFinanceData() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [categories, setCategories] = useState<FinanceCategory[]>([])
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([])
  const [budgets, setBudgets] = useState<FinanceBudget[]>([])
  const [goals, setGoals] = useState<FinanceGoal[]>([])
  const [contributions, setContributions] = useState<FinanceGoalContribution[]>([])
  const [goalShares, setGoalShares] = useState<FinanceGoalShare[]>([])
  const [incomingGoalShares, setIncomingGoalShares] = useState<FinanceGoalShare[]>([])
  const [sharedTransactions, setSharedTransactions] = useState<FinanceTransaction[]>([])
  const [sharedBudgets, setSharedBudgets] = useState<FinanceBudget[]>([])
  const [partnerProfiles, setPartnerProfiles] = useState<PartnerProfile[]>([])
  const [recurring, setRecurring] = useState<FinanceRecurring[]>([])
  const [recurringEntries, setRecurringEntries] = useState<FinanceRecurringEntry[]>([])
  const [workspace, setWorkspace] = useState<FinanceWorkspace | null>(null)
  const [workspaceMembers, setWorkspaceMembers] = useState<FinanceWorkspaceMember[]>([])
  const [workspaceInvites, setWorkspaceInvites] = useState<FinanceWorkspaceInvite[]>([])
  const [pendingInvitesForMe, setPendingInvitesForMe] = useState<FinanceWorkspaceInvite[]>([])
  const [familyTransactions, setFamilyTransactions] = useState<FinanceTransaction[]>([])
  const [familyBudgets, setFamilyBudgets] = useState<FinanceBudget[]>([])
  const [familyAccounts, setFamilyAccounts] = useState<FinanceAccount[]>([])
  const [familyCategories, setFamilyCategories] = useState<FinanceCategory[]>([])
  // Lean, all-time projections (no description/photo_url) backing consumers
  // that need lifetime history — account balances, category counts/in-use,
  // monthly evolution charts — while `transactions`/`sharedTransactions`/
  // `familyTransactions` above hold only the currently loaded month window.
  const [txAggOwn, setTxAggOwn] = useState<FinanceTxAgg[]>([])
  const [txAggShared, setTxAggShared] = useState<FinanceTxAgg[]>([])
  const [txAggWorkspace, setTxAggWorkspace] = useState<FinanceTxAgg[]>([])
  const [loadedRange, setLoadedRangeState] = useState<{ min: string; max: string } | null>(null)
  const [loading, setLoading] = useState(true)
  // API-016: o mês da data do aparelho da última carga ou da última
  // materialização aplicada, ou seja, a janela do servidor (esse mês e o
  // seguinte) que está no estado. O mês visto decide por ele se pede os
  // orçamentos, e a virada do mês com a tela aberta se mede contra ele
  // (useViewedMonthBudgets), não contra o relógio.
  const [materializedYM, setMaterializedYM] = useState<string | null>(null)

  // REL-003: falha ao ler transações não vira "zero transações" em silêncio:
  // avisa e mantém na tela o que já estava carregado. Ref para `load` não
  // mudar de identidade (e recarregar tudo) quando o idioma troca.
  const { showToast } = useToast()
  const { t } = useLanguage()
  const notifyRef = useRef({ t, showToast })
  useEffect(() => { notifyRef.current = { t, showToast } }, [t, showToast])
  const warnTxLoadFailed = useCallback((error: ReadError) => {
    console.error('[finance] transactions load failed', error)
    notifyRef.current.showToast('error', notifyRef.current.t('finance_tx_load_error'), { dedupeKey: 'finance-tx-load-error' })
  }, [])

  // Keyed by the fields actually read, not by the `user` object: supabase-js
  // re-emits SIGNED_IN whenever the tab regains focus, handing AuthContext a
  // brand-new `user` instance for the same account. Depending on the object
  // would re-run this load, flip `loading` back to true and unmount every tab
  // below it — wiping their local state (see the auth callback in AuthContext).
  const userId = user?.id
  const userEmail = user?.email

  // Mirrors `loadedRange` synchronously: `load`/`ensureMonthLoaded` need the
  // current window at call time, but including the state value in their own
  // useCallback deps would change their identity (and retrigger effects)
  // every time the window changes. The ref sidesteps that without going stale.
  const loadedRangeRef = useRef<{ min: string; max: string } | null>(null)
  const setLoadedRange = useCallback((r: { min: string; max: string }) => {
    loadedRangeRef.current = r
    setLoadedRangeState(r)
  }, [])

  // One round trip per scope (own/shared/workspace), date-bounded — backs the
  // month-window consumers (Transactions tab, Overview's current/previous
  // month, Budgets).
  const fetchTxWindow = useCallback(async (minYM: string, maxYM: string, wsId: string | null) => {
    if (!userId) return { own: [], shared: [], workspace: [], error: null }
    const dates = { from: `${minYM}-01`, before: `${nextMonth(maxYM)}-01` }
    const [ownRes, sharedRes, wsRes] = await Promise.all([
      fetchTx<FinanceTransaction>('*', 'user_id', userId, dates),
      fetchTx<FinanceTransaction>('*', 'shared_with_user_id', userId, dates),
      wsId ? fetchTx<FinanceTransaction>('*', 'workspace_id', wsId, dates) : NO_TX,
    ])
    return {
      own: ownRes.data ?? [],
      shared: sharedRes.data ?? [],
      workspace: wsRes.data ?? [],
      error: ownRes.error ?? sharedRes.error ?? wsRes.error,
    }
  }, [userId])

  // Same three scopes, no date bound, minimal columns — backs the all-time
  // aggregate consumers without paying for `description`/`photo_url` on every
  // row of a lifetime's worth of transactions.
  const fetchTxAggregates = useCallback(async (wsId: string | null) => {
    if (!userId) return { own: [], shared: [], workspace: [], error: null }
    const [ownRes, sharedRes, wsRes] = await Promise.all([
      fetchTx<FinanceTxAgg>(FINANCE_TX_AGG_COLUMNS, 'user_id', userId),
      fetchTx<FinanceTxAgg>(FINANCE_TX_AGG_COLUMNS, 'shared_with_user_id', userId),
      wsId ? fetchTx<FinanceTxAgg>(FINANCE_TX_AGG_COLUMNS, 'workspace_id', wsId) : NO_TX,
    ])
    return {
      own: ownRes.data ?? [],
      shared: sharedRes.data ?? [],
      workspace: wsRes.data ?? [],
      error: ownRes.error ?? sharedRes.error ?? wsRes.error,
    }
  }, [userId])

  // Mirrors the server's `.order('date', desc).order('created_at', desc)` —
  // the Transactions tab groups adjacent same-date rows by array position
  // (no client-side sort at render time), so a patched-in-place row that
  // isn't resorted breaks that grouping.
  const sortTxDesc = (arr: FinanceTransaction[]) =>
    [...arr].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))

  const upsertById = <T extends { id: string }>(arr: T[], row: T) =>
    arr.some(x => x.id === row.id) ? arr.map(x => (x.id === row.id ? row : x)) : [row, ...arr]

  // Applies a transaction write's own response (`.select().single()`) directly
  // to state instead of refetching everything. Own bucket always gets it;
  // family bucket only if `workspace_id` is set — on an edit that changes
  // scope, the family bucket is stripped-then-conditionally-readded by id, so
  // no separate "previous row" is needed to know what to undo.
  const applyTxUpsert = useCallback((tx: FinanceTransaction) => {
    const agg: FinanceTxAgg = {
      id: tx.id, user_id: tx.user_id, account_id: tx.account_id, category_id: tx.category_id,
      type: tx.type, amount: tx.amount, date: tx.date, workspace_id: tx.workspace_id ?? null,
    }
    const inWindow = !loadedRangeRef.current
      || (tx.date.slice(0, 7) >= loadedRangeRef.current.min && tx.date.slice(0, 7) <= loadedRangeRef.current.max)

    setTxAggOwn(prev => upsertById(prev, agg))
    if (inWindow) setTransactions(prev => sortTxDesc(upsertById(prev, tx)))

    setTxAggWorkspace(prev => {
      const stripped = prev.filter(x => x.id !== tx.id)
      return tx.workspace_id ? upsertById(stripped, agg) : stripped
    })
    if (inWindow) {
      setFamilyTransactions(prev => {
        const stripped = prev.filter(x => x.id !== tx.id)
        return sortTxDesc(tx.workspace_id ? upsertById(stripped, tx) : stripped)
      })
    }
  }, [])

  // Removing by id is a harmless no-op on whichever bucket(s) didn't have the
  // row, so no "which bucket was it in" bookkeeping is needed on delete.
  const applyTxRemove = useCallback((id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id))
    setTxAggOwn(prev => prev.filter(t => t.id !== id))
    setFamilyTransactions(prev => prev.filter(t => t.id !== id))
    setTxAggWorkspace(prev => prev.filter(t => t.id !== id))
  }, [])

  // Single-id variant of the profile-batch-lookup inline in `load()` below —
  // used by `saveGoalShare` when the newly-shared partner isn't already in
  // `partnerProfiles`.
  const resolvePartnerProfile = useCallback(async (partnerId: string) => {
    const { data } = await supabase.from('profiles').select('id, email, display_name, avatar_emoji, avatar_color, avatar_url').eq('id', partnerId).maybeSingle()
    return data
  }, [])

  // Targeted transactions-only refresh (own/shared/workspace window + the
  // all-time aggregates), reusing the same two fetchers `load()` uses. Used
  // by the `finance_transactions_changed` listener (an external write from
  // the store submodule whose content isn't known here).
  const refetchTransactions = useCallback(async () => {
    if (!userId) return
    const wsId = workspace?.id ?? null
    const minYM = loadedRangeRef.current?.min ?? prevMonth(currentYM())
    const maxYM = loadedRangeRef.current?.max ?? nextMonth(currentYM())
    const [win, agg] = await Promise.all([fetchTxWindow(minYM, maxYM, wsId), fetchTxAggregates(wsId)])
    const error = win.error ?? agg.error
    if (error) { warnTxLoadFailed(error); return }
    setTransactions(win.own)
    setSharedTransactions(win.shared)
    setFamilyTransactions(win.workspace)
    setTxAggOwn(agg.own)
    setTxAggShared(agg.shared)
    setTxAggWorkspace(agg.workspace)
  }, [userId, workspace, fetchTxWindow, fetchTxAggregates, warnTxLoadFailed])

  // API-016: o que a materialização do servidor devolveu (os lançamentos da
  // janela e todos os orçamentos dos meses tratados), mesclado por id. Os da
  // pessoa vão para `budgets`; os do workspace aberto, de qualquer membro,
  // para os da família. Usado depois de salvar um recorrente e ao ver um mês
  // fora da janela e na virada do mês (useViewedMonthBudgets). `today` é o
  // p_today da chamada: toda chamada materializa a janela dele, que passa a
  // ser a do estado.
  const applyMaterialized = useCallback((result: MaterializedRecurring, today?: string) => {
    const { own, family } = splitMaterializedBudgets(result.budgets, userId, workspace?.id)
    setRecurringEntries(prev => mergeRecurringEntries(prev, result.entries))
    setBudgets(prev => mergeById(prev, own))
    setFamilyBudgets(prev => mergeById(prev, family))
    if (today) setMaterializedYM(today.slice(0, 7))
  }, [userId, workspace])

  // `silent` refreshes the data without flipping `loading` — flipping it would
  // unmount every tab below (see the userId comment above). Used when another
  // submodule (e.g. the store) writes a transaction and asks for a refresh.
  // PERF-003: a carga é feita em 3 idas e voltas (eram 7 a 8 em série), só o
  // load mais recente aplica o resultado, e qualquer erro vira o estado
  // `loadError` com "Tentar de novo" (antes, uma falha aparecia como saldo
  // zero). Numa recarga silenciosa, o erro vira aviso e a tela fica como está.
  const loadSeqRef = useRef(0)
  const [loadError, setLoadError] = useState(false)
  const failLoad = useCallback((error: ReadError, silent: boolean) => {
    console.error('[finance] load failed', error)
    if (silent) {
      notifyRef.current.showToast('error', notifyRef.current.t('finance_load_error'), { dedupeKey: 'finance-load-error' })
    } else {
      setLoadError(true)
      setLoading(false)
    }
  }, [])

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!userId) return
    const silent = !!opts?.silent
    const seq = ++loadSeqRef.current
    const stale = () => seq !== loadSeqRef.current
    if (!silent) { setLoading(true); setLoadError(false) }
    // A data do aparelho da carga: a mesma para os orçamentos lidos e a RPC.
    const today = deviceToday()

    // Reuse the already-loaded window on a reload (never shrink it back to
    // the default ±1 month); only a fresh mount has no window yet.
    const initialMin = loadedRangeRef.current?.min ?? prevMonth(currentYM())
    const initialMax = loadedRangeRef.current?.max ?? nextMonth(currentYM())

    // Lote 1: tudo o que não depende do workspace, junto com a membership (que
    // diz qual é o workspace) e os convites pendentes para mim. Os convites são
    // duas consultas parametrizadas, juntadas no cliente, em vez de um `.or()`
    // interpolado com o userId/e-mail.
    const personalCategories = () => supabase.from('finance_categories').select('*').eq('user_id', userId).is('workspace_id', null).order('type').order('name')
    const [memberRes, accs, catsFirst, buds, gls, ctbs, recs, rEnts, ownedShares, incShares, shBuds, byUserRes, byEmailRes] = await Promise.all([
      supabase.from('finance_workspace_members').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('finance_accounts').select('*').eq('user_id', userId).order('created_at'),
      personalCategories(),
      supabase.from('finance_budgets').select('*').eq('user_id', userId),
      supabase.from('finance_goals').select('*').order('deadline'),
      supabase.from('finance_goal_contributions').select('*').order('date', { ascending: false }),
      supabase.from('finance_recurring').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('finance_recurring_entries').select('*').eq('user_id', userId).order('due_date'),
      supabase.from('finance_goal_shares').select('*').eq('owner_id', userId),
      supabase.from('finance_goal_shares').select('*').eq('shared_with_user_id', userId),
      supabase.from('finance_budgets').select('*').eq('shared_with_user_id', userId),
      supabase.from('finance_workspace_invites').select('*').eq('status', 'pending').eq('invited_user_id', userId),
      supabase.from('finance_workspace_invites').select('*').eq('status', 'pending').eq('invited_email', userEmail ?? ''),
    ])
    if (stale()) return
    const firstBatchError = firstError([memberRes, accs, catsFirst, buds, gls, ctbs, recs, rEnts, ownedShares, incShares, shBuds, byUserRes, byEmailRes])
    if (firstBatchError) { failLoad(firstBatchError, silent); return }
    const wsId = memberRes.data?.workspace_id ?? null

    // Categorias padrão só na primeira vez (ver needsCategoryBootstrap).
    let personalCats = catsFirst.data ?? []
    if (needsCategoryBootstrap(personalCats)) {
      const boot = await supabase.rpc('bootstrap_finance_categories', { p_user_id: userId })
      const again = boot.error ? null : await personalCategories()
      if (stale()) return
      const bootError = boot.error ?? again?.error
      if (bootError) { failLoad(bootError, silent); return }
      personalCats = again?.data ?? []
    }

    // Lote 2: o que depende do workspace (transações e os dados do workspace).
    const none = Promise.resolve({ data: null, error: null })
    const [txWindow, txAgg, wsRes, membersRes, invitesRes, wsBudsRes, wsAccsRes, wsCatsFirst] = await Promise.all([
      fetchTxWindow(initialMin, initialMax, wsId),
      fetchTxAggregates(wsId),
      wsId ? supabase.from('finance_workspaces').select('*').eq('id', wsId).single() : none,
      wsId ? supabase.from('finance_workspace_members').select('*').eq('workspace_id', wsId) : none,
      wsId ? supabase.from('finance_workspace_invites').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }) : none,
      wsId ? supabase.from('finance_budgets').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId) : none,
      wsId ? supabase.from('finance_accounts').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId).order('created_at') : none,
      wsId ? supabase.from('finance_categories').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId).order('type').order('name') : none,
    ])
    if (stale()) return
    const secondBatchError = txWindow.error ?? txAgg.error ?? firstError([wsRes, membersRes, invitesRes, wsBudsRes, wsAccsRes, wsCatsFirst])
    if (secondBatchError) { failLoad(secondBatchError, silent); return }

    const ws = (wsRes.data) ?? null
    const wsMembers = (membersRes.data) ?? []
    const wsInvites = (invitesRes.data) ?? []
    const wsBuds = withCategory(wsBudsRes.data)
    const wsAccs = wsAccsRes.data ?? []
    let wsCats = wsCatsFirst.data ?? []
    if (wsId && needsCategoryBootstrap(wsCats)) {
      const boot = await supabase.rpc('bootstrap_workspace_categories', { p_workspace_id: wsId })
      const again = boot.error ? null : await supabase.from('finance_categories').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId).order('type').order('name')
      if (stale()) return
      const bootError = boot.error ?? again?.error
      if (bootError) { failLoad(bootError, silent); return }
      wsCats = again?.data ?? []
    }

    // Collect all partner IDs (include workspace members). Uses the all-time
    // aggregate sets (not the month window) so a partner whose only shared/
    // workspace transaction falls outside the loaded window still resolves.
    const partnerIdSet = new Set<string>()
    ;(ownedShares.data ?? []).forEach(s => partnerIdSet.add(s.shared_with_user_id))
    ;(incShares.data ?? []).forEach(s => partnerIdSet.add(s.owner_id))
    ;(ctbs.data ?? []).forEach(c => { if (c.user_id !== userId) partnerIdSet.add(c.user_id) })
    txAgg.shared.forEach(tx => partnerIdSet.add(tx.user_id))
    ;(shBuds.data ?? []).forEach(b => partnerIdSet.add(b.user_id))
    wsMembers.forEach(m => { if (m.user_id !== userId) partnerIdSet.add(m.user_id) })
    txAgg.workspace.forEach(tx => { if (tx.user_id !== userId) partnerIdSet.add(tx.user_id) })
    wsInvites.forEach(inv => { if (inv.invited_by !== userId) partnerIdSet.add(inv.invited_by) })
    partnerIdSet.delete(userId)

    // Lote 3: perfis dos parceiros e, com algum recorrente ativo, a
    // materialização no servidor (API-016): os lançamentos do mês e do seguinte
    // e os orçamentos automáticos, na data do aparelho. Ela devolve a janela
    // inteira (todos os lançamentos da pessoa e todos os orçamentos dos dois
    // meses que ela enxerga, criados agora ou antes), então o que o cron ou
    // outra aba criou depois do lote 1 também entra.
    const recItems = recs.data ?? []
    const existingEntries = rEnts.data ?? []
    const [profs, materialized] = await Promise.all([
      partnerIdSet.size > 0
        ? supabase.from('profiles').select('id, email, display_name, avatar_emoji, avatar_color, avatar_url').in('id', [...partnerIdSet])
        : Promise.resolve({ data: [] as PartnerProfile[], error: null }),
      recItems.some(r => r.active) ? materializeRecurring(today) : Promise.resolve(null),
    ])
    if (stale()) return
    if (profs.error) { failLoad(profs.error, silent); return }
    // REL-004: falha na materialização só vai para o log; a carga segue com o
    // que já existe e o cron cobre à noite.
    if (materialized?.error) console.error('[finance] recurring materialize failed', materialized.error)
    const fromServer: MaterializedRecurring = materialized?.data ?? { entries: [], budgets: [] }
    const serverBudgets = splitMaterializedBudgets(fromServer.budgets, userId, wsId)
    const profilesMap = new Map<string, PartnerProfile>()
    ;(profs.data ?? []).forEach(p => profilesMap.set(p.id, p))

    setAccounts(accs.data ?? [])
    setCategories(personalCats)
    setBudgets(mergeById(withCategory(buds.data), serverBudgets.own))
    setGoals(gls.data ?? [])
    setContributions(
      (ctbs.data ?? []).map(c =>
        ({ ...c, contributor_profile: c.user_id !== userId ? (profilesMap.get(c.user_id) ?? undefined) : undefined })
      )
    )
    setGoalShares(
      (ownedShares.data ?? []).map(s =>
        ({ ...s, profile: profilesMap.get(s.shared_with_user_id) ?? undefined })
      )
    )
    setIncomingGoalShares(incShares.data ?? [])
    setSharedBudgets(withCategory(shBuds.data))
    setPartnerProfiles([...profilesMap.values()])

    setTransactions(txWindow.own)
    setSharedTransactions(txWindow.shared)
    setFamilyTransactions(txWindow.workspace)
    setTxAggOwn(txAgg.own)
    setTxAggShared(txAgg.shared)
    setTxAggWorkspace(txAgg.workspace)
    setLoadedRange({ min: initialMin, max: initialMax })

    setWorkspace(ws)
    setWorkspaceMembers(wsMembers.map(m => ({ ...m, profile: m.user_id === userId ? { email: userEmail ?? '', display_name: null } : (profilesMap.get(m.user_id) ?? undefined) })))
    setWorkspaceInvites(wsInvites.map(inv => ({ ...inv, inviter_profile: profilesMap.get(inv.invited_by) ?? undefined })))
    setPendingInvitesForMe(mergePendingInvites(byUserRes.data, byEmailRes.data))
    setFamilyBudgets(mergeById(wsBuds, serverBudgets.family))
    setFamilyAccounts(wsAccs)
    setFamilyCategories(wsCats)

    setRecurring(recItems)
    setRecurringEntries(mergeRecurringEntries(existingEntries, fromServer.entries))
    // Mesmo se a materialização falhou: o estado tem os orçamentos lidos nesta
    // data, e a virada do mês se mede contra ela (e tenta de novo).
    setMaterializedYM(today.slice(0, 7))
    setLoadError(false)
    setLoading(false)
  }, [userId, userEmail, fetchTxWindow, fetchTxAggregates, setLoadedRange, failLoad])

  useEffect(() => { load() }, [load])

  // Extends the loaded window (never shrinks it) to cover `ym`, fetching only
  // when it isn't already covered. `workspace` (not a raw wsId) is a dep since
  // that's the only place the current workspace id is tracked between loads.
  const ensureMonthLoaded = useCallback(async (ym: string) => {
    const current = loadedRangeRef.current
    if (current && ym >= current.min && ym <= current.max) return
    const newMin = current && current.min < ym ? current.min : ym
    const newMax = current && current.max > ym ? current.max : ym
    const win = await fetchTxWindow(newMin, newMax, workspace?.id ?? null)
    if (win.error) { warnTxLoadFailed(win.error); return }
    setTransactions(win.own)
    setSharedTransactions(win.shared)
    setFamilyTransactions(win.workspace)
    setLoadedRange({ min: newMin, max: newMax })
  }, [workspace, fetchTxWindow, setLoadedRange, warnTxLoadFailed])

  // Extends the window to cover every month in the list in one shot (used by
  // the Network tab's up-to-12-month need) — extending to the min and max is
  // enough since the range fetched is always contiguous.
  const ensureMonthsLoaded = useCallback(async (months: string[]) => {
    if (months.length === 0) return
    const sorted = [...months].sort()
    await ensureMonthLoaded(sorted[0])
    await ensureMonthLoaded(sorted[sorted.length - 1])
  }, [ensureMonthLoaded])

  return {
    accounts, categories, transactions, budgets, goals, contributions, goalShares, incomingGoalShares, sharedTransactions, sharedBudgets, partnerProfiles, recurring, recurringEntries, workspace, workspaceMembers, workspaceInvites, pendingInvitesForMe, familyTransactions, familyBudgets, familyAccounts, familyCategories, txAggOwn, txAggShared, txAggWorkspace, loadedRange, loading, loadError, reload: load, ensureMonthLoaded, ensureMonthsLoaded,
    // Targeted patch/refetch surface for PERF-002: mutation handlers apply a
    // write's own response directly via these setters instead of calling
    // `reload` (which re-derives all ~20 arrays above from ~15+ queries).
    setAccounts, setCategories, setTransactions, setBudgets, setGoals, setContributions, setGoalShares, setSharedTransactions, setSharedBudgets, setPartnerProfiles, setRecurring, setRecurringEntries, setFamilyBudgets, setFamilyAccounts, setFamilyCategories, setTxAggOwn, setTxAggShared, setTxAggWorkspace,
    applyTxUpsert, applyTxRemove, resolvePartnerProfile, refetchTransactions, applyMaterialized, materializedYM,
  }
}

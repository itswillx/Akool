import { supabase } from '../supabase'
import { fetchAllRows } from '../fetchAllRows'
import { FINANCE_TX_AGG_COLUMNS, type FinanceTxAgg } from '../financeCalc'
import type { FinanceAccount, FinanceCategory, Todo } from '../../types'

// PERF-015: as consultas do Dashboard, num lugar só, para o react-query. São as
// mesmas de antes (Dashboard.tsx e DashboardProjects.tsx); a diferença é que
// erro vira exceção, para o useQuery tratar.

/** O PostgREST devolve um objeto de erro; o useQuery precisa de um Error. */
function asError(error: { message: string }): Error {
  return error instanceof Error ? error : Object.assign(new Error(error.message), error)
}

export interface DashboardFinanceRows {
  accounts: FinanceAccount[]
  transactions: FinanceTxAgg[]
  categories: FinanceCategory[]
}

export async function loadDashboardFinance(userId: string): Promise<DashboardFinanceRows> {
  const [accRes, txRes, catRes] = await Promise.all([
    supabase.from('finance_accounts').select('*').eq('user_id', userId),
    // REL-003: o histórico inteiro, paginado (o PostgREST corta em 1000 sem
    // erro), e só as colunas que o saldo e os totais usam.
    fetchAllRows<FinanceTxAgg>((from, to) => supabase.from('finance_transactions')
      .select(FINANCE_TX_AGG_COLUMNS).eq('user_id', userId)
      .order('id').range(from, to).overrideTypes<FinanceTxAgg[], { merge: false }>()),
    supabase.from('finance_categories').select('*').eq('user_id', userId),
  ])
  const error = accRes.error ?? txRes.error ?? catRes.error
  if (error) throw asError(error)
  return { accounts: accRes.data ?? [], transactions: txRes.data ?? [], categories: catRes.data ?? [] }
}

/** REL-003: todas as tarefas do usuário, paginadas (o total e o % saem daqui). */
export async function loadDashboardTodos(userId: string): Promise<Todo[]> {
  const { data, error } = await fetchAllRows<Todo>((from, to) => supabase
    .from('todos').select('*').eq('user_id', userId)
    .order('completed', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('id')
    .range(from, to))
  if (error) throw asError(error)
  return data
}

export interface DashboardBoardRow { id: string; name: string; icon: string; color: string; sort_order: number; is_shared: boolean }
export interface DashboardCardRow { id: string; board_id: string; title: string; completed: boolean; due_date: string | null }

export async function loadDashboardProjects(userId: string): Promise<{ boards: DashboardBoardRow[]; cards: DashboardCardRow[] }> {
  const [ownRes, sharedRes] = await Promise.all([
    supabase.from('project_boards').select('id, name, icon, color, sort_order').eq('user_id', userId).order('sort_order'),
    supabase.from('project_shares').select('project_boards(id, name, icon, color, sort_order)').eq('shared_with_user_id', userId),
  ])
  const own = (ownRes.data ?? []).map(b => ({ ...b, is_shared: false }))
  const shared = (sharedRes.data ?? []).flatMap(({ project_boards: b }) => (b ? [{ ...b, is_shared: true }] : []))
  const boards = [...own, ...shared.filter(s => !own.some(o => o.id === s.id))]
  if (boards.length === 0) return { boards, cards: [] }
  // REL-003: paginado; o PostgREST corta em 1000 sem erro.
  const { data: cards, error } = await fetchAllRows<DashboardCardRow>((from, to) => supabase
    .from('project_cards').select('id, board_id, title, completed, due_date')
    .in('board_id', boards.map(b => b.id))
    .order('id').range(from, to))
  if (error) throw asError(error)
  return { boards, cards }
}

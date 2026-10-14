import { supabase } from '../supabase'
import type { FinanceBudget, FinanceRecurring, FinanceRecurringEntry, FinanceTransaction } from '../../types'

// API-016: recorrentes no servidor (migration api016_finance_recurring_server).
// Os lançamentos do mês e do seguinte e os orçamentos automáticos nascem no
// banco (cron às 00:05 de São Paulo e esta RPC na carga); o mês visto na tela
// fora dessa janela ganha só os orçamentos dele, pela mesma RPC. Marcar como
// paga e pular são uma transação só. Quem chama lê `{ data, error }`, como nas
// outras funções de src/lib/data; `data` nulo (o smoke e clientes falsos) vira
// vazio.

export interface MaterializedRecurring {
  /** Todos os lançamentos da pessoa na janela (mês de hoje e o seguinte), não só os criados. */
  entries: FinanceRecurringEntry[]
  /**
   * Todos os orçamentos dos meses tratados (a janela e o mês visto) que a
   * pessoa enxerga, criados agora ou antes: os pessoais dela e os do workspace,
   * de qualquer membro. Quem mescla separa os da pessoa dos da família.
   */
  budgets: FinanceBudget[]
}

export interface RecurringEntryResult {
  entry: FinanceRecurringEntry | null
  /** Nula no "já pago" cuja transação foi apagada depois, e no pular. */
  transaction: FinanceTransaction | null
  recurring: FinanceRecurring | null
  alreadyPaid: boolean
}

function isRow(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isRow) as T[]) : []
}

function row<T>(value: unknown): T | null {
  return isRow(value) ? (value as T) : null
}

function field(data: unknown, key: string): unknown {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined
}

/** O retorno de finance_materialize_recurring; orçamento sem categoria fica de fora (ARCH-004). */
export function parseMaterialized(data: unknown): MaterializedRecurring {
  return {
    entries: rows<FinanceRecurringEntry>(field(data, 'entries')),
    budgets: rows<FinanceBudget>(field(data, 'budgets')).filter(b => typeof b.category_id === 'string'),
  }
}

/** O retorno de finance_mark_entry_paid e finance_skip_entry. */
export function parseEntryResult(data: unknown): RecurringEntryResult {
  return {
    entry: row<FinanceRecurringEntry>(field(data, 'entry')),
    transaction: row<FinanceTransaction>(field(data, 'transaction')),
    recurring: row<FinanceRecurring>(field(data, 'recurring')),
    alreadyPaid: field(data, 'already_paid') === true,
  }
}

/**
 * A data do aparelho, 'YYYY-MM-DD'. A tela calcula mês e atraso no fuso dele;
 * o servidor aceita até ±1 dia do hoje de São Paulo.
 */
export function deviceToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Gera o que falta dos recorrentes da pessoa (idempotente) e devolve a janela
 * inteira. Com `month` ('YYYY-MM', o mês visto na tela), soma só os orçamentos
 * automáticos desse mês: o servidor ignora mês a mais de 12 do atual, nunca
 * cria antes da criação do recorrente e nunca cria lançamento nele.
 */
export async function materializeRecurring(today: string = deviceToday(), month?: string) {
  const { data, error } = await supabase.rpc('finance_materialize_recurring',
    month ? { p_today: today, p_month: `${month}-01` } : { p_today: today })
  return { data: error ? null : parseMaterialized(data), error }
}

/**
 * Paga o lançamento numa transação só: cria a transação (no workspace do
 * recorrente, se a pessoa ainda for membro), marca o lançamento e encerra o
 * recorrente na última parcela. Sem valor, o servidor usa o do recorrente.
 */
export async function markRecurringEntryPaid(entryId: string, amountCents: number | null) {
  const { data, error } = await supabase.rpc('finance_mark_entry_paid',
    amountCents == null ? { p_entry: entryId } : { p_entry: entryId, p_amount_cents: amountCents })
  return { data: error ? null : parseEntryResult(data), error }
}

/** Pula o lançamento; pulada conta para encerrar o parcelado. */
export async function skipRecurringEntry(entryId: string) {
  const { data, error } = await supabase.rpc('finance_skip_entry', { p_entry: entryId })
  return { data: error ? null : parseEntryResult(data), error }
}

// PERF-003: peças puras da carga do financeiro (useFinanceData.load), testáveis
// sem Supabase.
import type { FinanceRecurring } from '../../types'

/**
 * Categorias padrão só na primeira vez. Antes, a RPC de bootstrap rodava em
 * todo load e, com ON CONFLICT DO NOTHING, recriava as categorias padrão que o
 * usuário tinha apagado ou renomeado.
 */
export function needsCategoryBootstrap(categories: readonly unknown[] | null | undefined): boolean {
  return (categories ?? []).length === 0
}

/** Convites pendentes (por id de usuário e por e-mail) juntos, sem repetir. */
export function mergePendingInvites<T extends { id: string }>(...lists: (T[] | null | undefined)[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const list of lists) {
    for (const invite of list ?? []) {
      if (seen.has(invite.id)) continue
      seen.add(invite.id)
      out.push(invite)
    }
  }
  return out
}

/**
 * API-016: linhas que o servidor devolveu junto das que já estavam, por id. A
 * do servidor vence (foi lida depois); as novas entram no fim. Sem nada novo,
 * devolve a mesma lista (o estado não muda).
 */
export function mergeById<T extends { id: string }>(existing: T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return existing
  const byId = new Map(incoming.map(row => [row.id, row]))
  const merged = existing.map(row => byId.get(row.id) ?? row)
  const known = new Set(existing.map(row => row.id))
  return [...merged, ...incoming.filter(row => !known.has(row.id))]
}

/**
 * Parcelas de recorrência que a materialização devolveu (a janela inteira, já
 * com o que o cron ou outra aba criou e o dia movido) junto das que já
 * existiam, por vencimento (a ordem do select).
 */
export function mergeRecurringEntries<T extends { id: string; due_date: string }>(existing: T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return existing
  return mergeById(existing, incoming).sort((a, b) => a.due_date.localeCompare(b.due_date))
}

/**
 * API-016: os orçamentos que a materialização devolveu, repartidos como na
 * carga. O servidor devolve todos os dos meses tratados que a pessoa enxerga:
 * os pessoais dela e os do workspace, de qualquer membro (o automático do
 * workspace sai em nome do dono do recorrente mais antigo). `own` vai para
 * `budgets`, que só tem linhas da pessoa (pessoais e as dela no workspace);
 * `family`, para `familyBudgets`, os do workspace aberto.
 */
export function splitMaterializedBudgets<T extends { user_id: string; workspace_id?: string | null }>(
  rows: readonly T[], userId: string | null | undefined, wsId: string | null | undefined,
): { own: T[]; family: T[] } {
  return {
    own: userId ? rows.filter(b => b.user_id === userId) : [],
    family: wsId ? rows.filter(b => b.workspace_id === wsId) : [],
  }
}

/** Até quantos meses do atual o mês visto pede orçamentos (o limite do servidor). */
const VIEWED_MONTH_REACH = 12

function monthIndex(ym: string): number {
  const [y, m] = ym.split('-').map(Number)
  return y * 12 + (m - 1)
}

/**
 * API-016: o mês visto na tela pede os orçamentos automáticos dele quando fica
 * fora da janela do servidor (o mês atual e o seguinte) e a até 12 meses do
 * atual, o mesmo limite que o servidor aplica (mais longe, ele ignora).
 * `current` é o mês da janela que está no estado (`materializedYM`), não o do
 * relógio: na virada com a tela aberta, eles diferem.
 */
export function viewedMonthNeedsBudgets(month: string, current: string): boolean {
  const offset = monthIndex(month) - monthIndex(current)
  return offset !== 0 && offset !== 1 && Math.abs(offset) <= VIEWED_MONTH_REACH
}

/**
 * API-016: os recorrentes que geram orçamento automático (a regra do servidor:
 * despesa ativa, fixa, com categoria e valor), numa chave estável. Vazia, não
 * há o que pedir; mudou (salvou, encerrou), o mês visto pede de novo.
 */
export function autoBudgetSourcesKey(recurring: readonly Pick<FinanceRecurring, 'id' | 'type' | 'active' | 'is_variable' | 'category_id' | 'amount' | 'total_installments' | 'workspace_id'>[]): string {
  return recurring
    .filter(r => r.active && r.type === 'expense' && !r.is_variable && r.category_id && (r.amount ?? 0) > 0)
    .map(r => [r.id, r.category_id, r.amount, r.total_installments ?? '', r.workspace_id ?? ''].join(':'))
    .sort()
    .join('|')
}

/**
 * ARCH-004: `finance_budgets.category_id` não é NOT NULL no banco (a FK é
 * ON DELETE CASCADE e o app sempre preenche; nenhuma linha nula hoje).
 * Orçamento sem categoria não tem o que medir, então fica fora da tela.
 */
export function withCategory<T extends { category_id: string | null }>(rows: readonly T[] | null | undefined): (T & { category_id: string })[] {
  return (rows ?? []).filter((row): row is T & { category_id: string } => row.category_id !== null)
}

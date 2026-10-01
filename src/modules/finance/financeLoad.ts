// PERF-003: peças puras da carga do financeiro (useFinanceData.load), testáveis
// sem Supabase.

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
 * Parcelas de recorrência recém-criadas junto das que já existiam, por
 * vencimento (a ordem do select). Evita reler a tabela depois do insert.
 */
export function mergeRecurringEntries<T extends { id: string; due_date: string }>(existing: T[], inserted: T[]): T[] {
  if (inserted.length === 0) return existing
  const ids = new Set(existing.map(e => e.id))
  return [...existing, ...inserted.filter(e => !ids.has(e.id))]
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
}

/**
 * ARCH-004: `finance_budgets.category_id` não é NOT NULL no banco (a FK é
 * ON DELETE CASCADE e o app sempre preenche; nenhuma linha nula hoje).
 * Orçamento sem categoria não tem o que medir, então fica fora da tela.
 */
export function withCategory<T extends { category_id: string | null }>(rows: readonly T[] | null | undefined): (T & { category_id: string })[] {
  return (rows ?? []).filter((row): row is T & { category_id: string } => row.category_id !== null)
}

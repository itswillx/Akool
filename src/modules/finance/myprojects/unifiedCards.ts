import { saleNetReceived } from '../../../lib/financeStoreCalc'
import { formatBRL } from '../../../lib/money'
import { goalPhase, salePhase, type FinancePhaseOrCancelled } from '../../../lib/financePhase'
import type { FinanceGoal, FinanceGoalContribution } from '../../../types'
import type { FinanceStoreStore } from '../store/useFinanceStore'
import type { ProjectsSection } from './section'

// Achata vendas e metas num card só, para o kanban unificado do Resumo. Sem JSX
// de propósito (mesma divisão de storeUi.ts): um arquivo que exporta
// componentes E funções quebra o fast refresh.

export type UnifiedKind = 'sale' | 'goal'

export interface UnifiedCard {
  /** Namespaced: dois UUIDs de tabelas diferentes colidiriam no dnd-kit. */
  id: string
  kind: UnifiedKind
  title: string
  subtitle: string
  icon: string
  accent: string
  /** Centavos. É o que o cabeçalho da coluna soma. */
  amount: number
  phase: FinancePhaseOrCancelled
  /** ISO — usado só para ordenar por atividade. */
  updatedAt: string
}

/** Onde cada tipo de card mora, para o clique navegar até lá. */
export const KIND_SECTION: Record<UnifiedKind, ProjectsSection> = {
  sale: 'store',
  goal: 'goals',
}

export function buildUnifiedCards(
  store: FinanceStoreStore,
  goals: FinanceGoal[],
  contributions: FinanceGoalContribution[],
  labels: { noCustomer: string; sale: string; goalTarget: (target: string) => string },
  colors: { sale: string },
): UnifiedCard[] {
  const sales: UnifiedCard[] = store.sales.map(sale => {
    const items = store.saleItems.filter(i => i.sale_id === sale.id)
    const customer = sale.customer_id ? store.customers.find(c => c.id === sale.customer_id) : null
    return {
      id: `sale:${sale.id}`,
      kind: 'sale',
      title: items.map(i => `${i.quantity}× ${i.product_name}`).join(', ') || labels.sale,
      subtitle: customer?.name ?? labels.noCustomer,
      icon: '🛒',
      accent: colors.sale,
      amount: saleNetReceived(sale, items),
      phase: salePhase(sale.status),
      updatedAt: sale.updated_at,
    }
  })

  const targets: UnifiedCard[] = goals.map(goal => {
    // Acumulado é derivado das contribuições, como toda posição neste módulo.
    const accumulated = contributions
      .filter(c => c.goal_id === goal.id)
      .reduce((sum, c) => sum + c.amount, 0)
    return {
      id: `goal:${goal.id}`,
      kind: 'goal',
      title: goal.name,
      // O alvo vai no subtítulo, não em `amount`: a coluna soma "valor
      // envolvido" — dinheiro que já está na jogada. Somar alvos daria um
      // número de intenção misturado com saldo real.
      subtitle: labels.goalTarget(formatBRL(goal.target_amount)),
      icon: goal.icon || '🎯',
      accent: goal.color,
      amount: accumulated,
      phase: goalPhase(goal, accumulated),
      // `finance_goals` não tem `updated_at`; a criação é o que existe.
      updatedAt: goal.created_at,
    }
  })

  return [...sales, ...targets]
}

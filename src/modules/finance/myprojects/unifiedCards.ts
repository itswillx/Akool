import { formatBRL } from '../../../lib/money'
import { goalPhase, type FinancePhaseOrCancelled } from '../../../lib/financePhase'
import type { FinanceGoal, FinanceGoalContribution } from '../../../types'
import type { ProjectsSection } from './section'

// Achata as metas num card só, para o kanban do Resumo. Sem JSX de propósito:
// um arquivo que exporta componentes E funções quebra o fast refresh. Até
// 14/10/2026 as vendas da Loja também entravam aqui (o módulo saiu do frontend).

export type UnifiedKind = 'goal'

export interface UnifiedCard {
  /** Namespaced (`goal:<id>`): o dnd-kit precisa de ids únicos entre tipos. */
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
  goal: 'goals',
}

export function buildUnifiedCards(
  goals: FinanceGoal[],
  contributions: FinanceGoalContribution[],
  labels: { goalTarget: (target: string) => string },
): UnifiedCard[] {
  return goals.map(goal => {
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
}

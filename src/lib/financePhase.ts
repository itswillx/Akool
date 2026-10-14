// Fase genérica de um "projeto" financeiro: hoje, uma meta de poupança. É o que
// dá as colunas do kanban do Resumo de "Projetos". As vendas da Loja também
// entravam aqui até a Loja sair do frontend (14/10/2026).
//
// Nada disso é armazenado: a fase é SEMPRE derivada do status que cada domínio
// já mantém. Uma coluna `phase` no banco divergiria dos números na primeira vez
// que alguém arrastasse um card sem mexer no dinheiro.
//
// Vive em `src/lib/` (e não em `modules/finance/`) porque cruza vários
// submódulos e precisa rodar nos testes, que usam o ambiente `node`.

import type { FinanceGoalStatus } from '../types'

export type FinancePhase = 'planned' | 'doing' | 'done'
export type FinancePhaseOrCancelled = FinancePhase | 'cancelled'

/** Ordem das colunas do board. 'cancelled' é a última e nasce oculta na UI. */
export const FINANCE_PHASES: FinancePhaseOrCancelled[] = ['planned', 'doing', 'done', 'cancelled']

/**
 * Meta de poupança: o status manda, e o valor acumulado desempata entre "é um
 * plano" e "já está andando".
 *
 * `accumulated` é a soma das contribuições — derivado, nunca armazenado. Uma
 * meta marcada como concluída fica em 'done' mesmo sem contribuição nenhuma:
 * a declaração do usuário ganha do número.
 */
export function goalPhase(
  goal: { status: FinanceGoalStatus },
  accumulated: number,
): FinancePhaseOrCancelled {
  if (goal.status === 'completed') return 'done'
  if (goal.status === 'cancelled') return 'cancelled'
  return accumulated > 0 ? 'doing' : 'planned'
}

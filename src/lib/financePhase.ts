// Fase genérica de um "projeto" financeiro: uma obra, uma posição de
// investimento, uma venda da loja ou uma meta de poupança. É o que permite o
// kanban unificado do Resumo de "Projetos" colocar os quatro domínios nas
// mesmas colunas.
//
// Nada disso é armazenado: a fase é SEMPRE derivada do status que cada domínio
// já mantém. Uma coluna `phase` no banco divergiria dos números na primeira vez
// que alguém arrastasse um card sem mexer no dinheiro.
//
// Vive em `src/lib/` (e não em `modules/finance/`) porque cruza vários
// submódulos e precisa rodar nos testes, que usam o ambiente `node`.

import type {
  FinanceGoalStatus,
  FinanceProjectStatus,
  FinanceStoreSaleStatus,
} from '../types'

export type FinancePhase = 'planned' | 'doing' | 'done'
export type FinancePhaseOrCancelled = FinancePhase | 'cancelled'

/** Ordem das colunas do board. 'cancelled' é a última e nasce oculta na UI. */
export const FINANCE_PHASES: FinancePhaseOrCancelled[] = ['planned', 'doing', 'done', 'cancelled']

/**
 * Obra. `paused` é 'doing', não 'planned': a obra já existe e já tem dinheiro
 * dentro — pausar não a devolve ao estado de plano.
 */
export function projectPhase(status: FinanceProjectStatus): FinancePhaseOrCancelled {
  switch (status) {
    case 'planning': return 'planned'
    case 'active':
    case 'paused': return 'doing'
    case 'done': return 'done'
    case 'cancelled': return 'cancelled'
  }
}

/**
 * Venda. `sold` e `shipped` são 'doing': o dinheiro entrou, mas a operação só
 * fecha na entrega — é ali que o produto deixa de ser responsabilidade minha.
 */
export function salePhase(status: FinanceStoreSaleStatus): FinancePhaseOrCancelled {
  switch (status) {
    case 'negotiating': return 'planned'
    case 'sold':
    case 'shipped': return 'doing'
    case 'delivered': return 'done'
    case 'cancelled': return 'cancelled'
  }
}

/**
 * Investimento. Não há status na tabela: a fase sai de `archived` mais a
 * posição aplicada, que é derivada em `financeInvestmentCalc.positionApplied`.
 *
 * Arquivado é 'done' mesmo com saldo — arquivar é uma declaração de intenção do
 * usuário, e ela ganha do número. Uma posição cadastrada sem nenhum aporte fica
 * em 'planned' (é o cold start do import de extrato).
 */
export function investmentPhase(inv: { archived: boolean }, applied: number): FinancePhase {
  if (inv.archived) return 'done'
  return applied > 0 ? 'doing' : 'planned'
}

/**
 * Meta de poupança. Mesmo formato do investimento: o status manda, e o valor
 * acumulado desempata entre "é um plano" e "já está andando".
 *
 * `accumulated` é a soma das contribuições — derivado, nunca armazenado. Uma
 * meta marcada como concluída fica em 'done' mesmo sem contribuição nenhuma:
 * a declaração do usuário ganha do número, como no investimento arquivado.
 */
export function goalPhase(
  goal: { status: FinanceGoalStatus },
  accumulated: number,
): FinancePhaseOrCancelled {
  if (goal.status === 'completed') return 'done'
  if (goal.status === 'cancelled') return 'cancelled'
  return accumulated > 0 ? 'doing' : 'planned'
}

// Progressão em etapas de um card de board: dado uma trilha ordenada de etapas
// e a etapa atual, diz o estado visual de cada bolinha.
//
// Deliberadamente separado de `studyProgress.ts`: lá o `stepState` opera sobre
// `ProgressCard` (checkpoints + quiz) e importa o domínio de Estudos inteiro, e
// "locked" significa progressão real bloqueada. Aqui a trilha é um status
// enumerado — a etapa futura é apenas futura, não trancada.
//
// Puro e sem React: o componente que desenha as bolinhas
// (`components/board/BoardStepper.tsx`) só consome estes estados.

export type StepState = 'completed' | 'current' | 'upcoming' | 'skipped'

export interface StepDef {
  id: string
  label: string
  color?: string
}

/**
 * Posição do status na trilha, ou -1 quando ele está FORA dela.
 *
 * O -1 é o caso importante: uma venda `cancelled` e um item de obra sem etapa
 * não estão "antes" nem "depois" de nada — saíram do caminho. Todo consumidor
 * precisa tratá-lo, então ele é o retorno, não uma exceção.
 */
export function stepIndexOf(steps: StepDef[], statusId: string): number {
  return steps.findIndex(s => s.id === statusId)
}

/**
 * Estado de cada bolinha. `currentIndex < 0` (fora da trilha) devolve tudo
 * 'skipped' — o stepper inteiro fica apagado em vez de fingir que o card está
 * na primeira etapa.
 */
export function stepStates(steps: StepDef[], currentIndex: number): StepState[] {
  if (currentIndex < 0) return steps.map(() => 'skipped')
  return steps.map((_, i) => {
    if (i < currentIndex) return 'completed'
    if (i === currentIndex) return 'current'
    return 'upcoming'
  })
}

/** True na última etapa da trilha — o componente desenha ✓ em vez do número. */
export function isTerminalStep(steps: StepDef[], currentIndex: number): boolean {
  return steps.length > 0 && currentIndex === steps.length - 1
}

/**
 * Fração 0..1 do trilho contínuo entre a primeira e a última bolinha. Uma
 * trilha de 4 etapas na 2ª (índice 1) preenche 1/3 — o denominador é o número
 * de CONECTORES, não de etapas, senão o trilho nunca chega ao fim.
 */
export function stepProgress(steps: StepDef[], currentIndex: number): number {
  if (currentIndex < 0 || steps.length < 2) return 0
  const clamped = Math.min(currentIndex, steps.length - 1)
  return clamped / (steps.length - 1)
}

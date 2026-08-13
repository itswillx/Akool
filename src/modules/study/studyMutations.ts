import { fieldsUnchanged, requireRows, revertFields, type WriteResult } from '../../lib/optimistic'
import type { StudyCard } from '../../types'

// Logica pura do "Recalcular cronograma" (REL-002), fora do hook para ficar
// testavel sem React. O reschedule escreve N linhas de uma vez, entao e a unica
// mutacao do modulo que pode falhar PELA METADE — e a que mais precisa que o
// rollback saiba distinguir quem gravou de quem nao gravou.

export interface ReschedulePlanItem {
  id: string
  /** O que este write tentou gravar. */
  applied: Partial<StudyCard>
  /** O valor anterior, para o rollback. */
  before: Partial<StudyCard>
}

/**
 * Monta o plano BY CARD ID a partir dos cards ja ordenados por sort_order, para
 * que a ordem do array no estado nunca possa dessincronizar o mapeamento.
 */
export function planReschedule(
  sorted: StudyCard[],
  dates: string[],
  updatedAt: string,
): ReschedulePlanItem[] {
  return sorted.map((card, i) => ({
    id: card.id,
    applied: { due_date: dates[i], updated_at: updatedAt },
    before: { due_date: card.due_date, updated_at: card.updated_at },
  }))
}

export function applyReschedule(list: StudyCard[], plan: ReschedulePlanItem[]): StudyCard[] {
  const appliedById = new Map(plan.map(item => [item.id, item.applied]))
  return list.map(card => {
    const applied = appliedById.get(card.id)
    return applied ? { ...card, ...applied } : card
  })
}

/** Um item so conta como falho se rejeitou, deu error, ou casou zero linhas (RLS). */
export function rescheduleFailures(
  plan: ReschedulePlanItem[],
  settled: PromiseSettledResult<WriteResult<{ id: string }[]>>[],
): ReschedulePlanItem[] {
  return plan.filter((_, i) => {
    const result = settled[i]
    if (!result || result.status === 'rejected') return true
    return requireRows(result.value).error != null
  })
}

/**
 * Rollback PARCIAL: reverte so os ids que falharam. Reverter tudo seria pior —
 * os writes que passaram ja estao no banco, e desfaze-los localmente faria o
 * estado mentir em MAIS linhas do que a falha causou (no proximo reload as
 * datas "voltariam sozinhas").
 */
export function revertReschedule(list: StudyCard[], failed: ReschedulePlanItem[]): StudyCard[] {
  return failed.reduce(
    (acc, item) => revertFields(acc, item.id, item.before, {
      onlyIf: card => fieldsUnchanged(card, item.applied),
    }),
    list,
  )
}

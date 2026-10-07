import type { ProjectCard } from '../../../types'

// Quem não pode ser pai ou dependência de um card, para não fechar um ciclo
// (o servidor recusa desde o API-013).

/** Todos os ids alcançáveis a partir de `start` pelas arestas `next`, sem ele. */
function reachable(start: string, next: Map<string, string[]>): Set<string> {
  const out = new Set<string>()
  const stack = [start]
  while (stack.length) {
    for (const id of next.get(stack.pop()!) ?? []) {
      if (!out.has(id)) { out.add(id); stack.push(id) }
    }
  }
  return out
}

/** Filhos, netos e assim por diante: nenhum deles pode virar pai do card. */
export function descendantIds(cardId: string, cards: Pick<ProjectCard, 'id' | 'parent_card_id'>[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const c of cards) if (c.parent_card_id) childrenOf.set(c.parent_card_id, [...(childrenOf.get(c.parent_card_id) ?? []), c.id])
  return reachable(cardId, childrenOf)
}

/** Quem já depende do card (direta ou indiretamente): nenhum deles pode virar dependência dele. */
export function dependentIds(cardId: string, cards: Pick<ProjectCard, 'id' | 'depends_on'>[]): Set<string> {
  const dependentsOf = new Map<string, string[]>()
  for (const c of cards) for (const d of c.depends_on) dependentsOf.set(d, [...(dependentsOf.get(d) ?? []), c.id])
  return reachable(cardId, dependentsOf)
}

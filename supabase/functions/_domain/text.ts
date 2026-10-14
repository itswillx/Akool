// API-027: texto para comparar e buscar. Mora em _domain porque a importação
// de backlog casa o tópico com a coluna por ele; o app reexporta por
// src/lib/graph.ts.

/** Sem acento, sem caixa e sem espaço nas pontas: "saude" acha "Saúde". */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

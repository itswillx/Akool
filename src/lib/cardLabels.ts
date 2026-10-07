// API-013: as regras de rótulo do gatilho project_cards_integrity
// (private.card_labels_ok): até 30 por card, cada um de 1 a 50 caracteres sem
// espaço nas pontas, e sem repetir ignorando a caixa. A caixa que a pessoa
// digitou fica; só a comparação ignora.

export const CARD_LABEL_MAX_LENGTH = 50
export const CARD_LABELS_MAX = 30

export const labelKey = (label: string) => label.toLowerCase()

/** Sem espaço nas pontas e com até 50 caracteres (conta como o Postgres: por code point). */
export function cleanCardLabel(raw: string): string {
  return [...raw.trim()].slice(0, CARD_LABEL_MAX_LENGTH).join('').trim()
}

export function hasCardLabel(labels: string[], label: string): boolean {
  const key = labelKey(label)
  return labels.some(l => labelKey(l) === key)
}

/** Acrescenta `raw` se couber; repetido (sem caixa), vazio ou além do limite devolve a mesma lista. */
export function addCardLabel(labels: string[], raw: string): string[] {
  const label = cleanCardLabel(raw)
  if (!label || labels.length >= CARD_LABELS_MAX || hasCardLabel(labels, label)) return labels
  return [...labels, label]
}

/** Uma lista que o servidor aceita: limpa, sem repetidos (fica o primeiro) e com até 30. */
export function normalizeCardLabels(labels: string[]): string[] {
  return labels.reduce<string[]>((out, raw) => addCardLabel(out, raw), [])
}

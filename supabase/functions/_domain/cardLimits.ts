// API-013: os limites do gatilho project_cards_integrity, num lugar só. O
// modal e a importação os seguem para o servidor não recusar no meio de uma
// edição. Os de rótulo ficam em ./cardLabels.
// API-027: moram em _domain (o app reexporta por src/lib/cardLimits.ts), e
// cardLimits.test.ts confere os números com a migration do API-013.

export const CHECKLIST_MAX_ITEMS = 500
export const CHECKLIST_MAX_TEXT = 2000
export const ATTACHMENTS_MAX = 50
export const DEPENDS_ON_MAX = 100

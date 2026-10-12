// API-013: as regras de rótulo do gatilho project_cards_integrity.
// API-027: moram em supabase/functions/_domain/cardLabels.ts (a API usa as mesmas).
export {
  addCardLabel, CARD_LABEL_MAX_LENGTH, CARD_LABELS_MAX, cleanCardLabel, hasCardLabel, labelKey, normalizeCardLabels,
} from '../../supabase/functions/_domain/cardLabels'

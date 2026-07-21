-- Roadmap rationale ("Por que agora"): one sentence explaining why this step
-- follows the previous one in the study roadmap. Parsed from the Claude
-- markdown contract or edited inline. NOT NULL DEFAULT '' so legacy and
-- manually created cards need no backfill. RLS untouched (existing
-- study_cards_* policies are row-scoped).

ALTER TABLE study_cards ADD COLUMN IF NOT EXISTS rationale text NOT NULL DEFAULT '';

COMMENT ON COLUMN study_cards.rationale IS
  'Why-now rationale for the roadmap step ("Ponto de partida — ..." on the first card). Empty for manual/legacy cards.';

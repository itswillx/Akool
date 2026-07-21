-- Certo/Errado quiz per card, parsed from the Claude markdown contract.
-- Embedded JSONB collection {id, statement, answer, userAnswer} (same pattern
-- as checkpoints/resources). userAnswer persists the user's pick so the score
-- survives reloads; null = not answered. NOT NULL DEFAULT '[]' so legacy and
-- manually created cards need no backfill. RLS untouched (existing
-- study_cards_* policies are row-scoped).

ALTER TABLE study_cards ADD COLUMN IF NOT EXISTS quiz jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN study_cards.quiz IS
  'Certo/Errado quiz: [{id, statement, answer: certo|errado, userAnswer: certo|errado|null}]. Empty for manual/legacy cards.';

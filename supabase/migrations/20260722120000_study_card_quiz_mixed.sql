-- Mixed quiz format: Certo/Errado items (legacy shape, no "kind" key) now
-- coexist with multiple-choice items ("kind": "choice"). No backfill needed:
-- old rows stay valid — the app treats a missing "kind" as boolean. Only the
-- column documentation changes.

COMMENT ON COLUMN study_cards.quiz IS
  'Mixed quiz. Boolean item: {id, statement, answer: certo|errado, userAnswer: certo|errado|null, kind?: "boolean", explanation?}. Choice item: {kind: "choice", id, statement, options: string[], answer: index of correct option, userAnswer: index|null, explanation?}. Empty for manual/legacy cards.';

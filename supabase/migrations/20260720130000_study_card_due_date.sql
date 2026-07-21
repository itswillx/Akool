-- Per-card schedule for the study module: when a topic has a target_date the
-- app distributes due dates across its cards ("Recalcular cronograma") and the
-- user can edit each card's date. Nullable on purpose — topics without a meta
-- keep due_date null on every card; appended cards start null. RLS untouched
-- (existing study_cards_* policies are row-scoped) and no index needed
-- (overdue is computed client-side).

ALTER TABLE study_cards ADD COLUMN IF NOT EXISTS due_date date;

COMMENT ON COLUMN study_cards.due_date IS
  'Optional card due date, distributed from the topic target_date or set manually. Compared as a local YYYY-MM-DD string in the app.';

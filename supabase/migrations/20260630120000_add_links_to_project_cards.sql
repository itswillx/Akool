-- Add a `links` column to project cards: an array of external web links the
-- user attaches to a card ({ id, url, title }). Additive and reversible; the
-- column inherits the table's existing RLS policies.
ALTER TABLE project_cards
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;

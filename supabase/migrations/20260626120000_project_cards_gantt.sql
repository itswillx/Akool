-- Gantt / timeline support for project cards.
-- Adds a start date (bar start; due_date remains the bar end), a parent link for
-- sub-task hierarchy, and a dependency list. All additive and backward-compatible.

ALTER TABLE project_cards
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS parent_card_id uuid REFERENCES project_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depends_on uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS project_cards_parent_idx ON project_cards (parent_card_id);

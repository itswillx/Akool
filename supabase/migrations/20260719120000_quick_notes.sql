-- Quick sticky notes shown on the dashboard. Additive and reversible.
-- Per-user data guarded by RLS (user_id = auth.uid()); linked_items is a
-- JSONB array of { id, type: 'page'|'card', targetId, title, boardId? }
-- snapshots, following the embedded-collection pattern of project_cards.

CREATE TABLE IF NOT EXISTS quick_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'yellow'
    CHECK (color IN ('yellow','green','pink','blue','purple')),
  linked_items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quick_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY quick_notes_select ON quick_notes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY quick_notes_insert ON quick_notes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY quick_notes_update ON quick_notes FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY quick_notes_delete ON quick_notes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS quick_notes_user_id_idx
  ON quick_notes (user_id, updated_at DESC);

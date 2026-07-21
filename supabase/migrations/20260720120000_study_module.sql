-- Study module ("Estudos"): topics created manually or imported from a
-- Claude-generated markdown plan. Cards embed checkpoints/resources as JSONB
-- snapshot collections ({id,text,completed} / {id,title,url}), following the
-- embedded-collection pattern of project_cards.checklist. Per-user data
-- guarded by RLS (user_id = auth.uid()) on every table (quick_notes pattern);
-- policies are intentionally flat (no joins) — a row pointing at another
-- user's topic_id stays invisible to both sides since selects are user-scoped.

CREATE TABLE IF NOT EXISTS study_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  area text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT '',
  objective text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','studying','paused','completed')),
  target_date date,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES study_topics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  checkpoints jsonb NOT NULL DEFAULT '[]',
  resources jsonb NOT NULL DEFAULT '[]',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES study_topics(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE study_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY study_topics_select ON study_topics FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY study_topics_insert ON study_topics FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY study_topics_update ON study_topics FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY study_topics_delete ON study_topics FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY study_cards_select ON study_cards FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY study_cards_insert ON study_cards FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY study_cards_update ON study_cards FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY study_cards_delete ON study_cards FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY study_logs_select ON study_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY study_logs_insert ON study_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY study_logs_update ON study_logs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY study_logs_delete ON study_logs FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS study_topics_user_id_idx
  ON study_topics (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS study_cards_topic_id_idx
  ON study_cards (topic_id, sort_order);

CREATE INDEX IF NOT EXISTS study_cards_user_id_idx
  ON study_cards (user_id);

CREATE INDEX IF NOT EXISTS study_logs_topic_id_idx
  ON study_logs (topic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS study_logs_user_id_idx
  ON study_logs (user_id);

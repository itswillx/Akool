-- REL-001: transactional backup restore, restore lock, pre-restore safety
-- backup, and an audit trail (also the table SEC-007 will reuse later for
-- other admin actions).

-- 1. Allow a 'pre_restore' backup type — createBackup() takes one of these
--    right before restoreBackup() overwrites data, as an automatic safety net.
ALTER TABLE site_backups DROP CONSTRAINT IF EXISTS site_backups_type_check;
ALTER TABLE site_backups ADD CONSTRAINT site_backups_type_check
  CHECK (type IN ('manual', 'automatic', 'pre_restore'));

-- 2. Restore lock: claimed with a conditional UPDATE (WHERE restore_in_progress
--    = false) so two concurrent restores can't both win the race. Scoped to the
--    backup panel only — this does not block writes elsewhere in the app.
ALTER TABLE site_backup_settings ADD COLUMN IF NOT EXISTS restore_in_progress boolean NOT NULL DEFAULT false;
ALTER TABLE site_backup_settings ADD COLUMN IF NOT EXISTS restore_started_at timestamptz;

-- 3. Audit trail. Generic on purpose (actor/action/target/details/success) so
--    SEC-007 can reuse it for other administrative actions later, not just backups.
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  actor_label text,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL,
  error_message text
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit_log"
  ON audit_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
-- No insert/update/delete policy for `authenticated` — only the service role
-- (edge functions, which bypass RLS) writes audit rows.

-- 4. Transactional restore. A single plpgsql function call is one Postgres
--    statement/transaction: an unhandled exception rolls back every DELETE and
--    INSERT the function has done so far, so a mid-restore failure (bad row,
--    constraint violation) leaves the database exactly as it was, never
--    half-empty. This list must be kept in sync with BACKUP_TABLES in
--    supabase/functions/site-backup/index.ts (FK dependency order: referenced
--    tables first, cleared last).
CREATE OR REPLACE FUNCTION public.restore_site_backup(p_tables jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  restore_order text[] := ARRAY[
    'profiles', 'invite_codes', 'pages', 'page_shares', 'note_contents',
    'drawing_contents', 'todos', 'project_boards', 'project_columns',
    'project_cards', 'project_shares', 'finance_workspaces',
    'finance_workspace_members', 'finance_accounts', 'finance_categories',
    'finance_budgets', 'finance_goals', 'finance_goal_shares',
    'finance_recurring', 'finance_transactions', 'finance_goal_contributions',
    'finance_recurring_entries', 'finance_workspace_invites',
    'finance_projects', 'finance_project_stages', 'finance_suppliers',
    'finance_project_items', 'finance_project_quotes',
    'finance_project_expenses', 'notifications', 'quick_notes',
    'study_topics', 'study_cards', 'study_logs'
  ];
  tbl text;
  affected int;
  summary jsonb := '{}'::jsonb;
BEGIN
  -- Clear in reverse dependency order.
  FOR i IN REVERSE array_length(restore_order, 1)..1 LOOP
    EXECUTE format('DELETE FROM %I', restore_order[i]);
  END LOOP;

  -- Insert in forward (dependency) order.
  FOREACH tbl IN ARRAY restore_order LOOP
    IF p_tables ? tbl AND jsonb_array_length(p_tables -> tbl) > 0 THEN
      EXECUTE format(
        'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(null::%I, $1)',
        tbl, tbl
      ) USING (p_tables -> tbl);
      GET DIAGNOSTICS affected = ROW_COUNT;
    ELSE
      affected := 0;
    END IF;
    summary := summary || jsonb_build_object(tbl, affected);
  END LOOP;

  RETURN summary;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_site_backup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_site_backup(jsonb) TO service_role;

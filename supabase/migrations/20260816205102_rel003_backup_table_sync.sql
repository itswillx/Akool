-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260816205102).
-- SQL idêntico ao aplicado em produção (md5 ac13608b790678d1290b6a8486e0cb00); não editar.

CREATE OR REPLACE FUNCTION public.list_public_tables()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::text[])
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relpersistence = 'p';
$$;

REVOKE ALL ON FUNCTION public.list_public_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_tables() TO service_role;

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
    'finance_suppliers', 'finance_store_customers', 'finance_store_products',
    'finance_store_purchases', 'finance_store_sales',
    'finance_store_sale_items', 'notifications', 'quick_notes',
    'study_topics', 'study_cards', 'study_logs'
  ];
  tbl text;
  affected int;
  summary jsonb := '{}'::jsonb;
BEGIN
  FOR i IN REVERSE array_length(restore_order, 1)..1 LOOP
    EXECUTE format('DELETE FROM %I', restore_order[i]);
  END LOOP;

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
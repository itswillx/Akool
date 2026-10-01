-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260822215051).
-- SQL idêntico ao aplicado em produção (md5 44b91326ecd1693ab0ff94754b467d0c); não editar.

-- REL-004: as quatro tabelas de Emprestimos entram no restore_site_backup.
-- Corpo copiado VERBATIM de 20260816120000_rel003_backup_table_sync.sql --
-- muda somente o array restore_order. Ver
-- supabase/migrations/20260822140000_rel004_loan_tables_backup.sql.

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
    'finance_store_sale_items',
    'finance_loan_borrowers', 'finance_loans', 'finance_loan_payments',
    'finance_loan_collaterals',
    'notifications', 'quick_notes',
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
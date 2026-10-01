-- PERF-002 (etapa 1): RLS sem reavaliação por linha + índices de FK.
--
-- 1. Policies: 89 policies chamavam auth.uid()/auth.email() direto, e o
--    Postgres reavaliava a função para cada linha (advisor auth_rls_initplan).
--    Com (select auth.uid()) o valor vira initplan e é calculado uma vez por
--    consulta. A semântica é a mesma; nome, roles, comando e o resto da
--    expressão não mudam. Os comandos abaixo foram gerados de pg_policies em
--    25/09/2026 e revisados: USING só onde a policy tem USING, WITH CHECK só
--    onde tem WITH CHECK.
-- 2. Índices: as 26 FKs sem índice do advisor unindexed_foreign_keys, mais os
--    índices das consultas do app (notificações do usuário, convites de um
--    workspace e convites pendentes por e-mail). Os compostos cobrem as FKs
--    notifications.user_id e finance_workspace_invites.workspace_id.
--
-- Fora daqui (etapa 2, plano próprio): consolidar as policies permissivas
-- duplicadas do finance_* e trocar TO public por TO authenticated.

-- ── 1. Policies ─────────────────────────────────────────────────────────────

alter policy "Admins can read audit_log" on public.audit_log
  using ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));

alter policy finance_accounts_owner_all on public.finance_accounts
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy finance_budgets_owner_all on public.finance_budgets
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy shared_read on public.finance_budgets
  using ((shared_with_user_id = (select auth.uid())));

alter policy finance_categories_owner_all on public.finance_categories
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy finance_goal_contributions_owner_all on public.finance_goal_contributions
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy owner_sees_all_contributions_to_shared_goals on public.finance_goal_contributions
  using ((EXISTS ( SELECT 1 FROM finance_goal_shares fgs WHERE ((fgs.goal_id = finance_goal_contributions.goal_id) AND (fgs.owner_id = (select auth.uid()))))));
alter policy shared_insert on public.finance_goal_contributions
  with check ((EXISTS ( SELECT 1 FROM finance_goal_shares fgs WHERE ((fgs.goal_id = finance_goal_contributions.goal_id) AND (fgs.shared_with_user_id = (select auth.uid()))))));
alter policy shared_read on public.finance_goal_contributions
  using ((EXISTS ( SELECT 1 FROM finance_goal_shares fgs WHERE ((fgs.goal_id = finance_goal_contributions.goal_id) AND (fgs.shared_with_user_id = (select auth.uid()))))));

alter policy invitee_select on public.finance_goal_shares
  using ((shared_with_user_id = (select auth.uid())));
alter policy owner_all on public.finance_goal_shares
  using ((owner_id = (select auth.uid())))
  with check ((owner_id = (select auth.uid())));

alter policy finance_goals_owner_all on public.finance_goals
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy shared_read on public.finance_goals
  using ((EXISTS ( SELECT 1 FROM finance_goal_shares fgs WHERE ((fgs.goal_id = finance_goals.id) AND (fgs.shared_with_user_id = (select auth.uid()))))));

alter policy finance_loan_borrowers_delete on public.finance_loan_borrowers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_loan_borrowers_insert on public.finance_loan_borrowers
  with check ((user_id = (select auth.uid())));
alter policy finance_loan_borrowers_select on public.finance_loan_borrowers
  using (((user_id = (select auth.uid())) OR (borrower_user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_loan_borrowers_update on public.finance_loan_borrowers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_loan_collaterals_insert on public.finance_loan_collaterals
  with check (((user_id = (select auth.uid())) AND loan_is_owner(loan_id)));

alter policy finance_loan_payments_delete on public.finance_loan_payments
  using ((loan_is_owner(loan_id) OR ((reported_by = (select auth.uid())) AND (status = 'pending'::text))));
alter policy finance_loan_payments_insert on public.finance_loan_payments
  with check (((user_id = (select auth.uid())) AND loan_is_owner(loan_id)));
alter policy finance_loan_payments_update on public.finance_loan_payments
  using ((loan_is_owner(loan_id) OR ((reported_by = (select auth.uid())) AND (status = 'pending'::text))))
  with check ((loan_is_owner(loan_id) OR ((reported_by = (select auth.uid())) AND (status = 'pending'::text))));

alter policy finance_loans_delete on public.finance_loans
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_loans_insert on public.finance_loans
  with check (((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM finance_loan_borrowers b WHERE ((b.id = finance_loans.borrower_id) AND ((b.user_id = (select auth.uid())) OR ((b.workspace_id IS NOT NULL) AND is_workspace_member(b.workspace_id))))))));
alter policy finance_loans_select on public.finance_loans
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)) OR (EXISTS ( SELECT 1 FROM finance_loan_borrowers b WHERE ((b.id = finance_loans.borrower_id) AND (b.borrower_user_id = (select auth.uid())))))));
alter policy finance_loans_update on public.finance_loans
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy recurring_owner_all on public.finance_recurring
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy recurring_entries_owner_all on public.finance_recurring_entries
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy finance_statements_owner_all on public.finance_statements
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy finance_store_customers_delete on public.finance_store_customers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_customers_insert on public.finance_store_customers
  with check ((user_id = (select auth.uid())));
alter policy finance_store_customers_select on public.finance_store_customers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_customers_update on public.finance_store_customers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_store_products_delete on public.finance_store_products
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_products_insert on public.finance_store_products
  with check ((user_id = (select auth.uid())));
alter policy finance_store_products_select on public.finance_store_products
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_products_update on public.finance_store_products
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_store_purchases_delete on public.finance_store_purchases
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_purchases_insert on public.finance_store_purchases
  with check ((user_id = (select auth.uid())));
alter policy finance_store_purchases_select on public.finance_store_purchases
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_purchases_update on public.finance_store_purchases
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_store_sale_items_delete on public.finance_store_sale_items
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_sale_items_insert on public.finance_store_sale_items
  with check ((user_id = (select auth.uid())));
alter policy finance_store_sale_items_select on public.finance_store_sale_items
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_sale_items_update on public.finance_store_sale_items
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_store_sales_delete on public.finance_store_sales
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_sales_insert on public.finance_store_sales
  with check ((user_id = (select auth.uid())));
alter policy finance_store_sales_select on public.finance_store_sales
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_store_sales_update on public.finance_store_sales
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_suppliers_delete on public.finance_suppliers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_suppliers_insert on public.finance_suppliers
  with check ((user_id = (select auth.uid())));
alter policy finance_suppliers_select on public.finance_suppliers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
alter policy finance_suppliers_update on public.finance_suppliers
  using (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))))
  with check (((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));

alter policy finance_transactions_owner_all on public.finance_transactions
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy shared_read on public.finance_transactions
  using ((shared_with_user_id = (select auth.uid())));

alter policy wi_invitee_select on public.finance_workspace_invites
  using (((invited_user_id = (select auth.uid())) OR (invited_email = (select auth.email()))));
alter policy wi_invitee_update on public.finance_workspace_invites
  using (((invited_user_id = (select auth.uid())) OR (invited_email = (select auth.email()))));

alter policy wm_owner_delete on public.finance_workspace_members
  using (((EXISTS ( SELECT 1 FROM finance_workspace_members m WHERE ((m.workspace_id = finance_workspace_members.workspace_id) AND (m.user_id = (select auth.uid())) AND (m.role = 'owner'::text)))) OR (user_id = (select auth.uid()))));
alter policy wm_owner_insert on public.finance_workspace_members
  with check ((EXISTS ( SELECT 1 FROM finance_workspace_members m WHERE ((m.workspace_id = finance_workspace_members.workspace_id) AND (m.user_id = (select auth.uid())) AND (m.role = 'owner'::text)))));

alter policy ws_owner_all on public.finance_workspaces
  using ((owner_id = (select auth.uid())))
  with check ((owner_id = (select auth.uid())));

alter policy invite_codes_delete_admin on public.invite_codes
  using (((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))) AND ((used_at IS NOT NULL) OR (expires_at < now()))));
alter policy invite_codes_select on public.invite_codes
  using (((created_by = (select auth.uid())) OR (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text))))));

alter policy notif_owner_delete on public.notifications
  using ((user_id = (select auth.uid())));
alter policy notif_owner_select on public.notifications
  using ((user_id = (select auth.uid())));
alter policy notif_owner_update on public.notifications
  using ((user_id = (select auth.uid())));

alter policy project_boards_delete on public.project_boards
  using ((user_id = (select auth.uid())));
alter policy project_boards_insert on public.project_boards
  with check ((user_id = (select auth.uid())));
alter policy project_boards_select on public.project_boards
  using (((user_id = (select auth.uid())) OR user_can_access_board(id, 'viewer'::text)));
alter policy project_boards_update on public.project_boards
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy project_shares_delete on public.project_shares
  using ((owner_id = (select auth.uid())));
alter policy project_shares_insert on public.project_shares
  with check (((owner_id = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM project_boards b WHERE ((b.id = project_shares.board_id) AND (b.user_id = (select auth.uid())))))));
alter policy project_shares_select on public.project_shares
  using (((owner_id = (select auth.uid())) OR (shared_with_user_id = (select auth.uid()))));

alter policy quick_notes_delete on public.quick_notes
  using ((user_id = (select auth.uid())));
alter policy quick_notes_insert on public.quick_notes
  with check ((user_id = (select auth.uid())));
alter policy quick_notes_select on public.quick_notes
  using ((user_id = (select auth.uid())));
alter policy quick_notes_update on public.quick_notes
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy "Admins can read site_backup_settings" on public.site_backup_settings
  using ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));

alter policy "Admins can read site_backups" on public.site_backups
  using ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::text)))));

alter policy study_cards_delete on public.study_cards
  using ((user_id = (select auth.uid())));
alter policy study_cards_insert on public.study_cards
  with check ((user_id = (select auth.uid())));
alter policy study_cards_select on public.study_cards
  using ((user_id = (select auth.uid())));
alter policy study_cards_update on public.study_cards
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy study_logs_delete on public.study_logs
  using ((user_id = (select auth.uid())));
alter policy study_logs_insert on public.study_logs
  with check ((user_id = (select auth.uid())));
alter policy study_logs_select on public.study_logs
  using ((user_id = (select auth.uid())));
alter policy study_logs_update on public.study_logs
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

alter policy study_topics_delete on public.study_topics
  using ((user_id = (select auth.uid())));
alter policy study_topics_insert on public.study_topics
  with check ((user_id = (select auth.uid())));
alter policy study_topics_select on public.study_topics
  using ((user_id = (select auth.uid())));
alter policy study_topics_update on public.study_topics
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

-- ── 2. Índices ──────────────────────────────────────────────────────────────

-- FKs sem índice (advisor unindexed_foreign_keys)
create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);
create index if not exists finance_accounts_user_id_idx on public.finance_accounts (user_id);
create index if not exists finance_budgets_category_id_idx on public.finance_budgets (category_id);
create index if not exists finance_goals_account_id_idx on public.finance_goals (account_id);
create index if not exists finance_goals_workspace_id_idx on public.finance_goals (workspace_id);
create index if not exists finance_loan_payments_account_id_idx on public.finance_loan_payments (account_id);
create index if not exists finance_loan_payments_confirmed_by_idx on public.finance_loan_payments (confirmed_by);
create index if not exists finance_loan_payments_user_id_idx on public.finance_loan_payments (user_id);
create index if not exists finance_loans_account_id_idx on public.finance_loans (account_id);
create index if not exists finance_loans_approved_by_idx on public.finance_loans (approved_by);
create index if not exists finance_loans_requested_by_idx on public.finance_loans (requested_by);
create index if not exists finance_recurring_account_id_idx on public.finance_recurring (account_id);
create index if not exists finance_recurring_category_id_idx on public.finance_recurring (category_id);
create index if not exists finance_recurring_workspace_id_idx on public.finance_recurring (workspace_id);
create index if not exists finance_recurring_entries_transaction_id_idx on public.finance_recurring_entries (transaction_id);
create index if not exists finance_statements_account_id_idx on public.finance_statements (account_id);
create index if not exists finance_statements_workspace_id_idx on public.finance_statements (workspace_id);
create index if not exists finance_store_purchases_account_id_idx on public.finance_store_purchases (account_id);
create index if not exists finance_store_sales_account_id_idx on public.finance_store_sales (account_id);
create index if not exists finance_suppliers_workspace_id_idx on public.finance_suppliers (workspace_id);
create index if not exists finance_workspace_invites_invited_by_idx on public.finance_workspace_invites (invited_by);
create index if not exists finance_workspace_invites_invited_user_id_idx on public.finance_workspace_invites (invited_user_id);
create index if not exists finance_workspaces_owner_id_idx on public.finance_workspaces (owner_id);
create index if not exists site_backups_created_by_idx on public.site_backups (created_by);

-- Consultas do app (também cobrem as FKs notifications.user_id e
-- finance_workspace_invites.workspace_id)
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);            -- NotificationsContext: últimas 50 do usuário
create index if not exists finance_workspace_invites_ws_created_idx
  on public.finance_workspace_invites (workspace_id, created_at desc); -- FinancePanel: convites enviados
create index if not exists finance_workspace_invites_pending_email_idx
  on public.finance_workspace_invites (invited_email)
  where status = 'pending';                                       -- FinancePanel: convites recebidos por e-mail

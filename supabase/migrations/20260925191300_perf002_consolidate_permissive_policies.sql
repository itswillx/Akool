-- PERF-002 (etapa 2): uma policy permissiva por (tabela, comando) no financeiro.
--
-- Antes: cada tabela tinha a policy ALL do dono mais policies de leitura/
-- escrita por workspace ou compartilhamento, todas TO public. O Postgres
-- avaliava todas as que valiam para o comando (advisor
-- multiple_permissive_policies: 19 pares tabela/ação, 91 com os papéis).
--
-- Depois: o Postgres junta com OR os USING das policies permissivas e,
-- separadamente, os WITH CHECK. Cada grupo virou uma policy por comando com
-- o OR explícito das mesmas expressões, então o acesso é idêntico por
-- construção (conferido no remoto em 25/09/2026: leitura, UPDATE, DELETE,
-- troca de dono e INSERT, linha a linha, para os 5 usuários + anon, sem
-- diferença). Todas passam a TO authenticated: o anon já não via nada (0
-- linhas, ou 42501 onde a policy chama is_workspace_member) e agora recebe 0
-- linhas sem erro. service_role/postgres têm BYPASSRLS.
--
-- Fora daqui: as demais tabelas TO public (pages, todos, *_contents,
-- project_*, notifications, invite_codes) não têm duplicatas.

-- ── finance_accounts ────────────────────────────────────────────────────────
drop policy finance_accounts_owner_all on public.finance_accounts;
drop policy workspace_read on public.finance_accounts;
create policy finance_accounts_select on public.finance_accounts for select to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_accounts_insert on public.finance_accounts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_accounts_update on public.finance_accounts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy finance_accounts_delete on public.finance_accounts for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── finance_budgets ─────────────────────────────────────────────────────────
drop policy finance_budgets_owner_all on public.finance_budgets;
drop policy shared_read on public.finance_budgets;
drop policy workspace_read on public.finance_budgets;
drop policy workspace_write on public.finance_budgets;
drop policy workspace_delete on public.finance_budgets;
create policy finance_budgets_select on public.finance_budgets for select to authenticated
  using ((user_id = (select auth.uid())) OR (shared_with_user_id = (select auth.uid()))
         OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_budgets_insert on public.finance_budgets for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_budgets_update on public.finance_budgets for update to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)))
  with check ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_budgets_delete on public.finance_budgets for delete to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));

-- ── finance_categories ──────────────────────────────────────────────────────
drop policy finance_categories_owner_all on public.finance_categories;
drop policy workspace_read on public.finance_categories;
drop policy workspace_write on public.finance_categories;
drop policy workspace_delete on public.finance_categories;
create policy finance_categories_select on public.finance_categories for select to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_categories_insert on public.finance_categories for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_categories_update on public.finance_categories for update to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)))
  with check ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_categories_delete on public.finance_categories for delete to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));

-- ── finance_transactions ────────────────────────────────────────────────────
drop policy finance_transactions_owner_all on public.finance_transactions;
drop policy shared_read on public.finance_transactions;
drop policy workspace_read on public.finance_transactions;
drop policy workspace_write on public.finance_transactions;
drop policy workspace_delete on public.finance_transactions;
create policy finance_transactions_select on public.finance_transactions for select to authenticated
  using ((user_id = (select auth.uid())) OR (shared_with_user_id = (select auth.uid()))
         OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_transactions_insert on public.finance_transactions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_transactions_update on public.finance_transactions for update to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)))
  with check ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_transactions_delete on public.finance_transactions for delete to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));

-- ── finance_goals ───────────────────────────────────────────────────────────
drop policy finance_goals_owner_all on public.finance_goals;
drop policy shared_read on public.finance_goals;
drop policy workspace_read on public.finance_goals;
create policy finance_goals_select on public.finance_goals for select to authenticated
  using ((user_id = (select auth.uid()))
         OR (EXISTS (SELECT 1 FROM finance_goal_shares fgs
                     WHERE fgs.goal_id = finance_goals.id AND fgs.shared_with_user_id = (select auth.uid())))
         OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_goals_insert on public.finance_goals for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_goals_update on public.finance_goals for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy finance_goals_delete on public.finance_goals for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── finance_goal_contributions ──────────────────────────────────────────────
drop policy finance_goal_contributions_owner_all on public.finance_goal_contributions;
drop policy owner_sees_all_contributions_to_shared_goals on public.finance_goal_contributions;
drop policy shared_read on public.finance_goal_contributions;
drop policy shared_insert on public.finance_goal_contributions;
create policy finance_goal_contributions_select on public.finance_goal_contributions for select to authenticated
  using ((user_id = (select auth.uid()))
         OR (EXISTS (SELECT 1 FROM finance_goal_shares fgs
                     WHERE fgs.goal_id = finance_goal_contributions.goal_id
                       AND (fgs.owner_id = (select auth.uid()) OR fgs.shared_with_user_id = (select auth.uid())))));
create policy finance_goal_contributions_insert on public.finance_goal_contributions for insert to authenticated
  with check ((user_id = (select auth.uid()))
         OR (EXISTS (SELECT 1 FROM finance_goal_shares fgs
                     WHERE fgs.goal_id = finance_goal_contributions.goal_id
                       AND fgs.shared_with_user_id = (select auth.uid()))));
create policy finance_goal_contributions_update on public.finance_goal_contributions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy finance_goal_contributions_delete on public.finance_goal_contributions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── finance_goal_shares ─────────────────────────────────────────────────────
drop policy owner_all on public.finance_goal_shares;
drop policy invitee_select on public.finance_goal_shares;
create policy finance_goal_shares_select on public.finance_goal_shares for select to authenticated
  using ((owner_id = (select auth.uid())) OR (shared_with_user_id = (select auth.uid())));
create policy finance_goal_shares_insert on public.finance_goal_shares for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy finance_goal_shares_update on public.finance_goal_shares for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy finance_goal_shares_delete on public.finance_goal_shares for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ── finance_recurring ───────────────────────────────────────────────────────
drop policy recurring_owner_all on public.finance_recurring;
drop policy workspace_read on public.finance_recurring;
create policy finance_recurring_select on public.finance_recurring for select to authenticated
  using ((user_id = (select auth.uid())) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)));
create policy finance_recurring_insert on public.finance_recurring for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_recurring_update on public.finance_recurring for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy finance_recurring_delete on public.finance_recurring for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── finance_recurring_entries ───────────────────────────────────────────────
drop policy recurring_entries_owner_all on public.finance_recurring_entries;
drop policy workspace_read on public.finance_recurring_entries;
create policy finance_recurring_entries_select on public.finance_recurring_entries for select to authenticated
  using ((user_id = (select auth.uid()))
         OR (EXISTS (SELECT 1 FROM finance_recurring r
                     WHERE r.id = finance_recurring_entries.recurring_id
                       AND r.workspace_id IS NOT NULL AND is_workspace_member(r.workspace_id))));
create policy finance_recurring_entries_insert on public.finance_recurring_entries for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy finance_recurring_entries_update on public.finance_recurring_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy finance_recurring_entries_delete on public.finance_recurring_entries for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── finance_workspaces ──────────────────────────────────────────────────────
drop policy ws_owner_all on public.finance_workspaces;
drop policy ws_member_select on public.finance_workspaces;
create policy finance_workspaces_select on public.finance_workspaces for select to authenticated
  using ((owner_id = (select auth.uid())) OR is_workspace_member(id));
create policy finance_workspaces_insert on public.finance_workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy finance_workspaces_update on public.finance_workspaces for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy finance_workspaces_delete on public.finance_workspaces for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ── finance_workspace_invites ───────────────────────────────────────────────
-- UPDATE continua sem WITH CHECK: o trigger finance_guard_invite_update
-- decide quais campos o convidado pode mudar.
drop policy wi_invitee_select on public.finance_workspace_invites;
drop policy wi_member_select on public.finance_workspace_invites;
create policy finance_workspace_invites_select on public.finance_workspace_invites for select to authenticated
  using ((invited_user_id = (select auth.uid())) OR (invited_email = (select auth.email()))
         OR is_workspace_member(workspace_id));
alter policy wi_member_insert on public.finance_workspace_invites to authenticated;
alter policy wi_invitee_update on public.finance_workspace_invites to authenticated;

-- ── Sem duplicatas: só o papel ──────────────────────────────────────────────
alter policy finance_statements_owner_all on public.finance_statements to authenticated;
alter policy wm_member_select on public.finance_workspace_members to authenticated;
alter policy wm_owner_insert on public.finance_workspace_members to authenticated;
alter policy wm_owner_delete on public.finance_workspace_members to authenticated;

-- ── profiles UPDATE ─────────────────────────────────────────────────────────
-- role/is_active/invite_slots_remaining seguem congelados pelo trigger
-- enforce_profile_privilege_bounds para quem não é admin.
drop policy profiles_update_own on public.profiles;
drop policy profiles_update_admin on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using ((id = (select auth.uid())) OR is_admin())
  with check ((id = (select auth.uid())) OR is_admin());

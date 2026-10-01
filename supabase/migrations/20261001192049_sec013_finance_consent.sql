-- SEC-013 (etapa A): compartilhamento financeiro só com quem já se relaciona.
--
-- 1. Sem a wm_owner_insert: o dono não põe mais ninguém no workspace sem
--    convite. Filiação só pelas RPCs SECURITY DEFINER (create_workspace,
--    accept_workspace_invite), que o app já usa.
-- 2. Contribuição em meta só em nome próprio, e só em meta sua, do seu
--    workspace ou compartilhada com você (antes: user_id de terceiros via share,
--    ou user_id próprio em meta de qualquer pessoa).
-- 3. shared_with_user_id em lançamentos e orçamentos só para quem já tem relação
--    (profile_is_related: share de página, quadro ou meta, workspace em comum,
--    empréstimo). Os 2 orçamentos compartilhados que existem em 01/10/2026 já
--    atendem.
-- 4. Etapa A das colunas de perfil: get_my_profile() e admin_list_profiles()
--    devolvem as colunas sensíveis (role, is_active, last_login_date,
--    invite_slots_remaining) a quem pode vê-las. O frontend passa a usá-las; o
--    revoke das colunas para authenticated vem na etapa B, depois do deploy.

drop policy if exists wm_owner_insert on public.finance_workspace_members;

drop policy if exists finance_goal_contributions_insert on public.finance_goal_contributions;
create policy finance_goal_contributions_insert on public.finance_goal_contributions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      exists (
        select 1 from public.finance_goals g
         where g.id = finance_goal_contributions.goal_id
           and (g.user_id = (select auth.uid())
                or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id)))
      )
      or exists (
        select 1 from public.finance_goal_shares fgs
         where fgs.goal_id = finance_goal_contributions.goal_id
           and fgs.shared_with_user_id = (select auth.uid())
      )
    )
  );

alter policy finance_transactions_insert on public.finance_transactions
  with check (
    user_id = (select auth.uid())
    and (shared_with_user_id is null or public.profile_is_related(shared_with_user_id))
  );

alter policy finance_transactions_update on public.finance_transactions
  with check (
    (user_id = (select auth.uid()) or (workspace_id is not null and public.is_workspace_member(workspace_id)))
    and (shared_with_user_id is null or public.profile_is_related(shared_with_user_id))
  );

alter policy finance_budgets_insert on public.finance_budgets
  with check (
    user_id = (select auth.uid())
    and (shared_with_user_id is null or public.profile_is_related(shared_with_user_id))
  );

alter policy finance_budgets_update on public.finance_budgets
  with check (
    (user_id = (select auth.uid()) or (workspace_id is not null and public.is_workspace_member(workspace_id)))
    and (shared_with_user_id is null or public.profile_is_related(shared_with_user_id))
  );

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $fn$
  select * from public.profiles where id = auth.uid();
$fn$;

create or replace function public.admin_list_profiles()
returns setof public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return query select * from public.profiles order by created_at;
end;
$fn$;

revoke execute on function public.get_my_profile() from public, anon;
revoke execute on function public.admin_list_profiles() from public, anon;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.admin_list_profiles() to authenticated;

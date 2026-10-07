-- API-012: metas. Compartilhar só a própria meta, aporte atômico que conclui a
-- meta, goal_id do aporte travado e bootstrap de categorias que não recria o
-- que a pessoa apagou.
--
-- Antes:
--   * finance_goal_shares aceitava INSERT e UPDATE conferindo só owner_id =
--     auth.uid() (perf002). Um share forjado (meta alheia, owner_id = eu) dava
--     leitura da meta e dos aportes, aporte na meta alheia e tornava a pessoa
--     "relacionada" no profile_is_related, driblando o consentimento do SEC-013;
--   * o UPDATE do aporte trocava goal_id livremente (a policy só olha user_id);
--   * a conclusão da meta era um segundo passo no navegador, que falhava para
--     quem aportava sem ser dono (o UPDATE de finance_goals é só do dono).
--
-- Levantamento na produção (07/10/2026): nenhum share de meta alheia e nenhum
-- aporte sem vínculo; nada a limpar.
--
-- Tabelas sem grant por coluna hoje: os REVOKE de UPDATE abaixo não apagam
-- grant nenhum (cuidado do supabase/migrations/README.md).

-- ---------------------------------------------------------------------------
-- 1. Shares de meta: só o dono da meta compartilha, e não há UPDATE
-- ---------------------------------------------------------------------------

-- A meta é de quem chama? SECURITY DEFINER porque a policy de share não pode
-- ler finance_goals direto: finance_goals_select lê finance_goal_shares, e o
-- Postgres acusa recursão de policy (42P17) mesmo com comandos diferentes.
create function public.finance_goal_owned(p_goal uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.finance_goals g where g.id = p_goal and g.user_id = (select auth.uid()))
$$;

revoke execute on function public.finance_goal_owned(uuid) from public, anon;
grant execute on function public.finance_goal_owned(uuid) to authenticated;

-- Sem coluna de papel, "travar o alvo" (SEC-002) é não ter UPDATE: para outra
-- meta ou pessoa, cria-se outro share. O SELECT dos shares continua sem ler
-- finance_goals.
drop policy if exists finance_goal_shares_insert on public.finance_goal_shares;
create policy finance_goal_shares_insert on public.finance_goal_shares
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.finance_goal_owned(goal_id));

drop policy if exists finance_goal_shares_update on public.finance_goal_shares;
revoke update on public.finance_goal_shares from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Share só vale emitido pelo dono da meta (passo 4 do SEC-002)
-- ---------------------------------------------------------------------------

drop policy if exists finance_goals_select on public.finance_goals;
create policy finance_goals_select on public.finance_goals
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.finance_goal_shares fgs
                where fgs.goal_id = finance_goals.id
                  and fgs.shared_with_user_id = (select auth.uid())
                  and fgs.owner_id = finance_goals.user_id)
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

-- Quem vê a meta vê os aportes dela: o dono, quem recebeu o share válido e,
-- em meta de workspace, os membros (antes só via share, e o progresso da meta
-- de workspace saía errado para os membros).
drop policy if exists finance_goal_contributions_select on public.finance_goal_contributions;
create policy finance_goal_contributions_select on public.finance_goal_contributions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.finance_goals g
                where g.id = finance_goal_contributions.goal_id
                  and (g.user_id = (select auth.uid())
                       or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
                       or exists (select 1 from public.finance_goal_shares fgs
                                   where fgs.goal_id = g.id
                                     and fgs.shared_with_user_id = (select auth.uid())
                                     and fgs.owner_id = g.user_id)))
  );

drop policy if exists finance_goal_contributions_insert on public.finance_goal_contributions;
create policy finance_goal_contributions_insert on public.finance_goal_contributions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.finance_goals g
                 where g.id = finance_goal_contributions.goal_id
                   and (g.user_id = (select auth.uid())
                        or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
                        or exists (select 1 from public.finance_goal_shares fgs
                                    where fgs.goal_id = g.id
                                      and fgs.shared_with_user_id = (select auth.uid())
                                      and fgs.owner_id = g.user_id)))
  );

-- Igual a 20260822172045_finance_loans_rpcs, com o ramo de metas exigindo que
-- o share seja do dono da meta.
create or replace function public.profile_is_related(p_other uuid)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select
    p_other = auth.uid()
    or exists (select 1 from page_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from project_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from finance_goal_shares s
        join finance_goals g on g.id = s.goal_id and g.user_id = s.owner_id
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from finance_workspace_members m1
        join finance_workspace_members m2 on m1.workspace_id = m2.workspace_id
        where m1.user_id = auth.uid() and m2.user_id = p_other)
    or exists (select 1 from finance_loan_borrowers b
        where (b.user_id = auth.uid() and b.borrower_user_id = p_other)
           or (b.borrower_user_id = auth.uid() and b.user_id = p_other));
$$;

-- ---------------------------------------------------------------------------
-- 3. Aporte: goal_id e user_id não mudam depois de gravados
-- ---------------------------------------------------------------------------

revoke update on public.finance_goal_contributions from authenticated;
grant update (amount, note, date) on public.finance_goal_contributions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aporte atômico: grava, soma no servidor e conclui a meta ao atingir o alvo
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER para concluir a meta mesmo quando quem aporta não é o dono
-- (o UPDATE de finance_goals é só do dono). O vínculo é conferido aqui, com as
-- mesmas regras da policy de INSERT. A meta fica travada (for update): dois
-- aportes ao mesmo tempo não deixam de concluir.
create function public.finance_goal_contribute(p_goal uuid, p_amount_cents bigint, p_date date default null, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_goal   record;
  v_id     uuid;
  v_total  numeric;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'O aporte precisa ser maior que zero' using errcode = '22023', hint = 'akool';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'A observação do aporte tem no máximo 500 caracteres' using errcode = '22023', hint = 'akool';
  end if;

  select g.id, g.user_id, g.workspace_id, g.status, g.target_amount into v_goal
    from public.finance_goals g
   where g.id = p_goal
   for update;
  if not found or not (
       v_goal.user_id = v_uid
       or (v_goal.workspace_id is not null and public.is_workspace_member(v_goal.workspace_id))
       or exists (select 1 from public.finance_goal_shares s
                   where s.goal_id = v_goal.id and s.shared_with_user_id = v_uid and s.owner_id = v_goal.user_id)
     ) then
    raise exception 'Meta não encontrada' using errcode = 'P0002';
  end if;
  if v_goal.status = 'cancelled' then
    raise exception 'Meta cancelada não recebe aporte' using errcode = 'P0001';
  end if;

  insert into public.finance_goal_contributions (goal_id, user_id, amount, note, date)
  values (v_goal.id, v_uid, p_amount_cents, coalesce(p_note, ''), coalesce(p_date, current_date))
  returning id into v_id;

  select coalesce(sum(c.amount), 0) into v_total
    from public.finance_goal_contributions c
   where c.goal_id = v_goal.id;

  v_status := v_goal.status;
  if v_status = 'active' and v_total >= v_goal.target_amount then
    update public.finance_goals set status = 'completed' where id = v_goal.id;
    v_status := 'completed';
  end if;

  -- As colunas são numeric(15,2), mas guardam centavos inteiros (README das migrations).
  return jsonb_build_object('contribution_id', v_id, 'status', v_status, 'total_cents', v_total::bigint);
end;
$$;

revoke execute on function public.finance_goal_contribute(uuid, bigint, date, text) from public, anon;
grant execute on function public.finance_goal_contribute(uuid, bigint, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Bootstrap de categorias: rodar de novo não duplica nem recria
-- ---------------------------------------------------------------------------

-- O pessoal passa a semear só quando a pessoa não tem categoria pessoal, como
-- o de workspace já fazia (antes recriava os padrões que a pessoa apagou). O
-- erro de autorização ganha errcode 42501 nos dois.
create or replace function public.bootstrap_finance_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if exists (select 1 from finance_categories where user_id = p_user_id and workspace_id is null) then
    return;
  end if;

  insert into finance_categories (user_id, name, color, icon, type, is_default) values
    (p_user_id, 'Alimentação',    '#f97316', '🍔', 'expense', true),
    (p_user_id, 'Transporte',     '#3b82f6', '🚗', 'expense', true),
    (p_user_id, 'Moradia',        '#8b5cf6', '🏠', 'expense', true),
    (p_user_id, 'Saúde',          '#ef4444', '❤️', 'expense', true),
    (p_user_id, 'Lazer',          '#ec4899', '🎮', 'expense', true),
    (p_user_id, 'Educação',       '#06b6d4', '📚', 'expense', true),
    (p_user_id, 'Vestuário',      '#a855f7', '👕', 'expense', true),
    (p_user_id, 'Outros gastos',  '#6b7280', '📦', 'expense', true),
    (p_user_id, 'Salário',        '#22c55e', '💼', 'income',  true),
    (p_user_id, 'Freelance',      '#84cc16', '💻', 'income',  true),
    (p_user_id, 'Investimentos',  '#f59e0b', '📈', 'income',  true),
    (p_user_id, 'Outras receitas','#10b981', '💰', 'income',  true)
  on conflict (user_id, name, type, workspace_id) do nothing;
end;
$function$;

create or replace function public.bootstrap_workspace_categories(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not is_workspace_member(p_workspace_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Se o workspace já tem categorias, não semear de novo (evita duplicar por membro)
  if exists (select 1 from finance_categories where workspace_id = p_workspace_id) then
    return;
  end if;

  insert into finance_categories (user_id, name, color, icon, type, is_default, workspace_id) values
    (auth.uid(), 'Alimentação',    '#f97316', '🍔', 'expense', true, p_workspace_id),
    (auth.uid(), 'Transporte',     '#3b82f6', '🚗', 'expense', true, p_workspace_id),
    (auth.uid(), 'Moradia',        '#8b5cf6', '🏠', 'expense', true, p_workspace_id),
    (auth.uid(), 'Saúde',          '#ef4444', '❤️', 'expense', true, p_workspace_id),
    (auth.uid(), 'Lazer',          '#ec4899', '🎮', 'expense', true, p_workspace_id),
    (auth.uid(), 'Educação',       '#06b6d4', '📚', 'expense', true, p_workspace_id),
    (auth.uid(), 'Vestuário',      '#a855f7', '👕', 'expense', true, p_workspace_id),
    (auth.uid(), 'Outros gastos',  '#6b7280', '📦', 'expense', true, p_workspace_id),
    (auth.uid(), 'Salário',        '#22c55e', '💼', 'income',  true, p_workspace_id),
    (auth.uid(), 'Freelance',      '#84cc16', '💻', 'income',  true, p_workspace_id),
    (auth.uid(), 'Investimentos',  '#f59e0b', '📈', 'income',  true, p_workspace_id),
    (auth.uid(), 'Outras receitas','#10b981', '💰', 'income',  true, p_workspace_id)
  on conflict (workspace_id, name, type) where workspace_id is not null do nothing;
end;
$function$;

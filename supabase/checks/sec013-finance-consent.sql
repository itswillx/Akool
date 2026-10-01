-- SEC-013: verificação do compartilhamento financeiro com consentimento.
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa três pessoas descartáveis: o dono O, R
-- (relacionada por uma página compartilhada e com a meta compartilhada) e X
-- (estranha). Tudo "bloqueado"/"ok" = comportamento esperado depois da migration
-- 20261001192049_sec013_finance_consent.
do $dry$
declare
  o uuid := gen_random_uuid(); r uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  pg uuid; ws uuid; g uuid; n int;
  out text[] := array[]::text[];
begin

  set local session_replication_role = replica;
  insert into auth.users (id, email) values (o, format('s13-o-%s@example.invalid', tag)), (r, format('s13-r-%s@example.invalid', tag)), (x, format('s13-x-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active)
  values (o, format('s13-o-%s@example.invalid', tag), 'O', 'standard', true),
         (r, format('s13-r-%s@example.invalid', tag), 'R', 'standard', true),
         (x, format('s13-x-%s@example.invalid', tag), 'X', 'standard', true);
  insert into public.pages (user_id, title) values (o, 'p') returning id into pg;
  insert into public.page_shares (page_id, owner_id, shared_with_user_id, role) values (pg, o, r, 'viewer');
  insert into public.finance_workspaces (name, owner_id) values ('w ' || tag, o) returning id into ws;
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, o, 'owner');
  insert into public.finance_goals (user_id, name, target_amount, deadline) values (o, 'g', 100, current_date + 30) returning id into g;
  insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (g, o, r);
  set local session_replication_role = origin;

  -- Como O (dono).
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, x, 'member');
    reset role; out := out || 'dono põe estranho no workspace: PERMITIDO'::text;
  exception when others then reset role; out := out || ('dono põe estranho no workspace: bloqueado (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    insert into public.finance_transactions (user_id, type, amount, shared_with_user_id) values (o, 'expense', 1, x);
    reset role; out := out || 'lançamento compartilhado com estranho: PERMITIDO'::text;
  exception when others then reset role; out := out || ('lançamento compartilhado com estranho: bloqueado (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    insert into public.finance_transactions (user_id, type, amount, shared_with_user_id) values (o, 'expense', 1, r);
    insert into public.finance_transactions (user_id, type, amount) values (o, 'expense', 1);
    reset role; out := out || 'legítimo, lançamento com relacionado e sem compartilhar: ok'::text;
  exception when others then reset role; out := out || ('legítimo, lançamento com relacionado: FALHOU (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    insert into public.finance_budgets (user_id, month, amount_limit, shared_with_user_id) values (o, '2099-01', 10, x);
    reset role; out := out || 'orçamento compartilhado com estranho: PERMITIDO'::text;
  exception when others then reset role; out := out || ('orçamento compartilhado com estranho: bloqueado (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    insert into public.finance_budgets (user_id, month, amount_limit, shared_with_user_id) values (o, '2099-02', 10, r);
    reset role; out := out || 'legítimo, orçamento com relacionado: ok'::text;
  exception when others then reset role; out := out || ('legítimo, orçamento com relacionado: FALHOU (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    select count(*) into n from public.get_my_profile() p where p.id = o and p.role = 'standard';
    reset role; out := out || format('get_my_profile devolve o próprio perfil: %s', case when n = 1 then 'ok' else 'FALHOU' end);
  exception when others then reset role; out := out || ('get_my_profile: FALHOU (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    perform public.admin_list_profiles();
    reset role; out := out || 'não admin lista perfis: PERMITIDO'::text;
  exception when others then reset role; out := out || ('não admin lista perfis: bloqueado (' || sqlerrm || ')'); end;

  -- Como R (com a meta compartilhada).
  perform set_config('request.jwt.claims', json_build_object('sub', r, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.finance_goal_contributions (goal_id, user_id, amount) values (g, o, 5);
    reset role; out := out || 'contribuição em nome de outro: PERMITIDO'::text;
  exception when others then reset role; out := out || ('contribuição em nome de outro: bloqueado (' || sqlerrm || ')'); end;
  begin
    set local role authenticated;
    insert into public.finance_goal_contributions (goal_id, user_id, amount) values (g, r, 5);
    reset role; out := out || 'legítimo, contribuição própria em meta compartilhada: ok'::text;
  exception when others then reset role; out := out || ('legítimo, contribuição própria: FALHOU (' || sqlerrm || ')'); end;

  -- Como X (sem nada).
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.finance_goal_contributions (goal_id, user_id, amount) values (g, x, 5);
    reset role; out := out || 'estranho contribui na meta alheia: PERMITIDO'::text;
  exception when others then reset role; out := out || ('estranho contribui na meta alheia: bloqueado (' || sqlerrm || ')'); end;

  raise exception E'SEC-013 verificação (nada foi gravado):\n%', array_to_string(out, E'\n');
end
$dry$;
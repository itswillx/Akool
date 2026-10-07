-- API-012: metas (migration 20261007120000_api012_goals_fixes).
--
-- Roda numa transação desfeita (termina em RAISE EXCEPTION com o resultado),
-- então nada fica gravado. Pessoas descartáveis: A (dona das metas), B (recebe
-- o share de A e tem dois shares forjados), C (de fora) e D (membro do
-- workspace de A). Cada linha sai "ok" ou "FALHA".
-- Como rodar: SQL editor do Supabase, MCP execute_sql ou psql como postgres,
-- depois da migration (ou no mesmo envio, como ensaio).
do $check$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  ga uuid := gen_random_uuid();   -- meta pessoal de A (alvo 1000)
  gw uuid := gen_random_uuid();   -- meta de A no workspace (alvo 500)
  gx uuid := gen_random_uuid();   -- meta cancelada de A
  gc uuid := gen_random_uuid();   -- meta pessoal de C
  s1 uuid := gen_random_uuid();   -- share válido A → B em GA
  ca uuid := gen_random_uuid();   -- aporte de A em GA
  tag text := substr(md5(random()::text), 1, 6);
  r text;
  n int;
  out text[] := array[]::text[];
begin
  -- as_user: SQL como authenticated com os claims da pessoa; 'ok <resultado>'
  -- ou 'erro <sqlstate>: <mensagem>'. try: sem claims e sem papel (cron, restore).
  create function pg_temp.as_user(p_uid uuid, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    execute p_sql into v_res;
    reset role;
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  create function pg_temp.try(p_sql text)
  returns text
  language plpgsql
  as $f$
  begin
    perform set_config('request.jwt.claims', '', true);
    execute p_sql;
    return 'ok';
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 160))
  $f$;

  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (a, format('api012-a-%s@example.invalid', tag)), (b, format('api012-b-%s@example.invalid', tag)),
    (c, format('api012-c-%s@example.invalid', tag)), (d, format('api012-d-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api012-a-%s@example.invalid', tag), 'A', 'standard', true, 0),
    (b, format('api012-b-%s@example.invalid', tag), 'B', 'standard', true, 0),
    (c, format('api012-c-%s@example.invalid', tag), 'C', 'standard', true, 0),
    (d, format('api012-d-%s@example.invalid', tag), 'D', 'standard', true, 0);
  insert into public.finance_workspaces (id, name, owner_id) values (ws, 'api012', a);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, d, 'member');
  insert into public.finance_goals (id, user_id, name, target_amount, deadline, workspace_id, status) values
    (ga, a, 'GA', 1000, current_date + 30, null, 'active'),
    (gw, a, 'GW', 500, current_date + 30, ws, 'active'),
    (gx, a, 'GX', 500, current_date + 30, null, 'cancelled'),
    (gc, c, 'GC', 1000, current_date + 30, null, 'active');
  insert into public.finance_goal_shares (id, goal_id, owner_id, shared_with_user_id) values
    (s1, ga, a, b),
    (gen_random_uuid(), gc, b, b),   -- forjado: B "compartilhou" a meta de C com B
    (gen_random_uuid(), gc, b, d);   -- forjado: para B parecer "relacionado" a D
  insert into public.finance_goal_contributions (id, goal_id, user_id, amount) values
    (ca, ga, a, 100), (gen_random_uuid(), gw, a, 100), (gen_random_uuid(), gc, c, 50);
  set local session_replication_role = origin;

  -- 1. Compartilhar: só a própria meta, e sem UPDATE.
  r := pg_temp.as_user(c, format($q$insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (%L, %L, %L)$q$, ga, c, c));
  out := out || pg_temp.expect('C não compartilha a meta de A', r, 'erro 42501:%');
  r := pg_temp.as_user(a, format($q$with x as (insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (%L, %L, %L) returning 1) select count(*)::text from x$q$, ga, a, c));
  out := out || pg_temp.expect('A compartilha a própria meta com C', r, 'ok 1');
  r := pg_temp.as_user(a, format($q$update public.finance_goal_shares set shared_with_user_id = %L where id = %L$q$, c, s1));
  out := out || pg_temp.expect('nem A troca o alvo de um share (sem UPDATE)', r, 'erro 42501:%');

  -- 2. Share forjado não vale para nada.
  r := pg_temp.as_user(b, format($q$select count(*)::text from public.finance_goals where id = %L$q$, gc));
  out := out || pg_temp.expect('share forjado não mostra a meta de C a B', r, 'ok 0');
  r := pg_temp.as_user(b, format($q$select count(*)::text from public.finance_goal_contributions where goal_id = %L$q$, gc));
  out := out || pg_temp.expect('share forjado não mostra os aportes de C a B', r, 'ok 0');
  r := pg_temp.as_user(b, format($q$insert into public.finance_goal_contributions (goal_id, user_id, amount) values (%L, %L, 10)$q$, gc, b));
  out := out || pg_temp.expect('share forjado não deixa B aportar direto na meta de C', r, 'erro 42501:%');
  r := pg_temp.as_user(b, format($q$select public.finance_goal_contribute(%L, 10)::text$q$, gc));
  out := out || pg_temp.expect('share forjado não deixa B aportar pela RPC', r, 'erro P0002:%');
  r := pg_temp.as_user(b, format($q$select public.profile_is_related(%L)::text$q$, d));
  out := out || pg_temp.expect('share forjado não torna B "relacionado" a D (SEC-013)', r, 'ok false');
  r := pg_temp.as_user(b, format($q$select public.profile_is_related(%L)::text$q$, a));
  out := out || pg_temp.expect('share válido mantém B relacionado a A', r, 'ok true');
  r := pg_temp.as_user(b, format($q$select count(*)::text from public.finance_goals where id = %L$q$, ga));
  out := out || pg_temp.expect('share válido mostra a meta de A a B', r, 'ok 1');

  -- 3. Aporte: goal_id travado; valor, nota e data editáveis.
  r := pg_temp.as_user(a, format($q$update public.finance_goal_contributions set goal_id = %L where id = %L$q$, gc, ca));
  out := out || pg_temp.expect('A não reaponta o próprio aporte para a meta de C', r, 'erro 42501:%');
  r := pg_temp.as_user(a, format($q$with u as (update public.finance_goal_contributions set amount = 150 where id = %L returning 1) select count(*)::text from u$q$, ca));
  out := out || pg_temp.expect('A corrige o valor do próprio aporte', r, 'ok 1');

  -- 4. Aporte atômico pela RPC.
  r := pg_temp.as_user(b, format($q$select public.finance_goal_contribute(%L, 900, current_date, 'chegou')::text$q$, ga));
  out := out || pg_temp.expect('B (share válido) aporta e conclui a meta de A na mesma transação', r, 'ok {%"status": "completed", "total_cents": 1050,%');
  select status into r from public.finance_goals where id = ga;
  out := out || pg_temp.expect('a meta de A ficou concluída', r, 'completed');
  r := pg_temp.as_user(a, format($q$select count(*)::text from public.finance_goal_contributions where goal_id = %L$q$, ga));
  out := out || pg_temp.expect('A vê o aporte de B na própria meta', r, 'ok 2');
  -- (C recebeu share de GA no passo 1; na meta do workspace, C não tem vínculo.)
  r := pg_temp.as_user(c, format($q$select public.finance_goal_contribute(%L, 10)::text$q$, gw));
  out := out || pg_temp.expect('C (sem vínculo com a meta do workspace) não aporta', r, 'erro P0002:%');
  r := pg_temp.as_user(a, format($q$select public.finance_goal_contribute(%L, 0)::text$q$, ga));
  out := out || pg_temp.expect('aporte zero é recusado', r, 'erro 22023:%');
  r := pg_temp.as_user(a, format($q$select public.finance_goal_contribute(%L, 10)::text$q$, gx));
  out := out || pg_temp.expect('meta cancelada não recebe aporte', r, 'erro P0001:%');
  r := pg_temp.as_user(d, format($q$select public.finance_goal_contribute(%L, 200)::text$q$, gw));
  out := out || pg_temp.expect('D (membro do workspace) aporta sem concluir (300 de 500)', r, 'ok {%"status": "active"%');
  r := pg_temp.as_user(d, format($q$select count(*)::text from public.finance_goal_contributions where goal_id = %L$q$, gw));
  out := out || pg_temp.expect('D vê todos os aportes da meta do workspace', r, 'ok 2');
  r := pg_temp.try($q$select public.finance_goal_contribute(gen_random_uuid(), 10)$q$);
  out := out || pg_temp.expect('a RPC exige sessão de usuário', r, 'erro 42501:%');

  -- 5. Sem claims (restore, cron, migration): nada barra.
  r := pg_temp.try(format($q$insert into public.finance_goals (user_id, name, target_amount, deadline, workspace_id) values (%L, 'restore', 10, current_date, %L)$q$, a, ws));
  out := out || pg_temp.expect('sem claims: meta de workspace entra', r, 'ok');
  r := pg_temp.try(format($q$insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (%L, %L, %L)$q$, gw, a, b));
  out := out || pg_temp.expect('sem claims: share entra', r, 'ok');
  r := pg_temp.try(format($q$insert into public.finance_goal_contributions (goal_id, user_id, amount) values (%L, %L, 5)$q$, gw, d));
  out := out || pg_temp.expect('sem claims: aporte entra', r, 'ok');

  -- 6. Bootstrap de categorias: não duplica nem recria o que foi apagado.
  r := pg_temp.as_user(a, format($q$select public.bootstrap_finance_categories(%L)::text$q$, a));
  r := pg_temp.as_user(a, format($q$select public.bootstrap_finance_categories(%L)::text$q$, a));
  select count(*) into n from public.finance_categories where user_id = a and workspace_id is null;
  out := out || pg_temp.expect('bootstrap pessoal duas vezes: 12 categorias', n::text, '12');
  delete from public.finance_categories where user_id = a and workspace_id is null and name = 'Lazer';
  r := pg_temp.as_user(a, format($q$select public.bootstrap_finance_categories(%L)::text$q$, a));
  select count(*) into n from public.finance_categories where user_id = a and workspace_id is null;
  out := out || pg_temp.expect('bootstrap não recria a categoria apagada', n::text, '11');
  r := pg_temp.as_user(c, format($q$select public.bootstrap_finance_categories(%L)::text$q$, a));
  out := out || pg_temp.expect('C não semeia as categorias de A', r, 'erro 42501: unauthorized');
  r := pg_temp.as_user(d, format($q$select public.bootstrap_workspace_categories(%L)::text$q$, ws));
  r := pg_temp.as_user(d, format($q$select public.bootstrap_workspace_categories(%L)::text$q$, ws));
  select count(*) into n from public.finance_categories where workspace_id = ws;
  out := out || pg_temp.expect('bootstrap do workspace duas vezes: 12 categorias', n::text, '12');
  r := pg_temp.as_user(c, format($q$select public.bootstrap_workspace_categories(%L)::text$q$, ws));
  out := out || pg_temp.expect('C (de fora) não semeia o workspace', r, 'erro 42501: unauthorized');

  -- 7. Estrutura e grants.
  select format('%s %s %s %s', p.prosecdef, array_to_string(p.proconfig, ','),
                has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    into r from pg_proc p where p.oid = 'public.finance_goal_contribute(uuid, bigint, date, text)'::regprocedure;
  out := out || pg_temp.expect('RPC: SECURITY DEFINER, search_path vazio, só authenticated', r, 't search_path="" f t');
  select format('%s %s %s %s', p.prosecdef, array_to_string(p.proconfig, ','),
                has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    into r from pg_proc p where p.oid = 'public.finance_goal_owned(uuid)'::regprocedure;
  out := out || pg_temp.expect('helper da policy de share: SECURITY DEFINER, search_path vazio, só authenticated', r, 't search_path="" f t');
  r := format('%s %s %s', has_table_privilege('authenticated', 'public.finance_goal_shares', 'UPDATE'),
              has_column_privilege('authenticated', 'public.finance_goal_contributions', 'goal_id', 'UPDATE'),
              has_column_privilege('authenticated', 'public.finance_goal_contributions', 'amount', 'UPDATE'));
  out := out || pg_temp.expect('sem UPDATE em shares nem em goal_id; amount editável', r, 'f f t');

  raise exception using message = format(E'API-012: metas (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$check$;

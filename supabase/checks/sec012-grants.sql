-- SEC-012: verificação dos privilégios de tabela e do EXECUTE das funções.
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa um usuário descartável sem linha em
-- profiles, criado e desfeito aqui (nenhum usuário real é tocado): o preparo
-- desliga gatilhos (handle_new_user) com session_replication_role, e os
-- cenários rodam como `authenticated` e `anon`.
--
-- Como rodar: SQL editor do Supabase, ou psql como postgres. Esperado depois da
-- migration 20260928145254_sec012_grants_hardening.sql:
--   - anon: só SELECT nas tabelas; authenticated sem TRUNCATE, TRIGGER,
--     REFERENCES e MAINTAIN, e sem escrever no audit_log;
--   - 37 funções SECURITY DEFINER para authenticated (10 helpers de RLS + 27
--     RPCs do frontend; eram 34 até o API-001, que somou update_api_token_scopes,
--     revoke_all_my_api_tokens e delete_api_token) e só a validate_invite_code
--     para anon;
--   - os ataques "bloqueado" e os fluxos legítimos "ok".
do $check$
declare
  u uuid := gen_random_uuid();
  p uuid;
  n int;
  msg text;
  out text[] := array[]::text[];
  r record;
begin
  -- Preparo: usuário descartável, sem perfil (sem gatilhos só nesta etapa).
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('sec012-check-%s@example.invalid', u));
  set local session_replication_role = origin;

  -- Privilégios de tabela (quantas tabelas de public têm cada um).
  for r in
    select g.role, g.priv, count(*) filter (where has_table_privilege(g.role, c.oid, g.priv)) as n
    from pg_class c
    cross join unnest(array['anon', 'authenticated']) as roles(role)
    cross join lateral (
      select roles.role, priv
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN']) as priv
    ) g
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    group by 1, 2 order by 1, 2
  loop
    out := out || format('tabelas: %s %s em %s', r.role, r.priv, r.n);
  end loop;

  -- Funções SECURITY DEFINER expostas pela API.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('authenticated', oid, 'execute');
  out := out || format('funcoes SECURITY DEFINER para authenticated: %s (esperado 37)', n);
  select string_agg(proname, ',') into msg from pg_proc
  where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('anon', oid, 'execute');
  out := out || format('funcoes SECURITY DEFINER para anon: %s', msg);

  -- Como authenticated, sem perfil.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.generate_invite_code();
    reset role;
    out := out || 'convite sem perfil: GEROU CODIGO'::text;
  exception when others then
    out := out || ('convite sem perfil: recusado (' || sqlerrm || ')');
  end;
  begin
    set local role authenticated;
    perform public.cq_next(gen_random_uuid(), null);
    reset role;
    out := out || 'authenticated chama cq_next: PERMITIDO'::text;
  exception when others then
    out := out || ('authenticated chama cq_next: bloqueado (' || sqlerrm || ')');
  end;
  begin
    set local role authenticated;
    insert into public.audit_log (action, success) values ('sec012-check', true);
    reset role;
    out := out || 'authenticated grava no audit_log: PERMITIDO'::text;
  exception when others then
    out := out || ('authenticated grava no audit_log: bloqueado (' || sqlerrm || ')');
  end;
  -- Os helpers de RLS continuam executáveis: todos_insert usa page_is_writable.
  begin
    set local role authenticated;
    insert into public.pages (user_id, title) values (u, 'sec012') returning id into p;
    insert into public.todos (user_id, page_id, text) values (u, p, 'sec012');
    select count(*) into n from public.todos where page_id = p;
    reset role;
    out := out || format('legitimo, pagina + tarefa como authenticated: ok (%s tarefa lida)', n);
  exception when others then
    out := out || ('legitimo, pagina + tarefa como authenticated: FALHOU (' || sqlerrm || ')');
  end;

  -- Como anon.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    set local role anon;
    insert into public.profiles (id, email) values (u, 'sec012@example.invalid');
    reset role;
    out := out || 'anon insere em profiles: PERMITIDO'::text;
  exception when others then
    out := out || ('anon insere em profiles: bloqueado (' || sqlerrm || ')');
  end;
  begin
    set local role anon;
    perform public.validate_invite_code('XXXXXXXX');
    reset role;
    out := out || 'legitimo, anon valida convite: ok'::text;
  exception when others then
    out := out || ('legitimo, anon valida convite: FALHOU (' || sqlerrm || ')');
  end;

  raise exception using
    message = format(E'SEC-012 verificacao (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$check$;

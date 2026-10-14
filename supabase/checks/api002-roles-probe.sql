-- API-002: sonda dos papéis do executor da API (plano A do docs/api-arquitetura.md §1.2).
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Se os papéis ainda não existem, cria os
-- dois aqui dentro (e somem no RAISE); se já existem (staging depois do API-002,
-- produção depois do API-004), só confere. Usa uma pessoa descartável.
-- Como rodar: SQL editor do Supabase, MCP execute_sql ou psql como postgres.
--
-- O que este harness NÃO prova (precisa de uma sessão de verdade como
-- akool_api_login, pelo pooler): que `set role authenticated` falha. SET ROLE
-- confere o session_user, e aqui ele é o postgres. A prova pelo pooler está em
-- docs/api-arquitetura.md §1.2.
do $probe$
declare
  u uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  created boolean := false;
  n int;
  v text;
  out text[] := array[]::text[];
begin
  -- Papéis do plano A (só se ainda não existem).
  if not exists (select 1 from pg_roles where rolname = 'akool_api') then
    create role akool_api nologin;
    grant authenticated to akool_api with inherit true, set false;
    grant akool_api to postgres with inherit false, set true;
    create role akool_api_login login noinherit;
    grant akool_api to akool_api_login with inherit false, set true;
    -- No PG 16+ quem cria o papel já recebe ADMIN dele (concedido pelo
    -- supabase_admin); "with admin option" aqui falha com 0LP01. Só o SET.
    grant akool_api_login to postgres with inherit false, set true;
    created := true;
  end if;
  out := out || format('papéis criados neste ensaio: %s', created);

  select string_agg(format('%s→%s (por %s): admin=%s inherit=%s set=%s',
                           r.rolname, m.rolname, g.rolname, am.admin_option, am.inherit_option, am.set_option), '; '
                    order by r.rolname, m.rolname, g.rolname)
    into v
    from pg_auth_members am
    join pg_roles r on r.oid = am.roleid
    join pg_roles m on m.oid = am.member
    join pg_roles g on g.oid = am.grantor
   where r.rolname like 'akool_api%' or m.rolname like 'akool_api%';
  out := out || ('memberships: ' || coalesce(v, '(nenhuma)'));

  select format('akool_api: login=%s inherit=%s bypassrls=%s; akool_api_login: login=%s inherit=%s bypassrls=%s',
                a.rolcanlogin, a.rolinherit, a.rolbypassrls, l.rolcanlogin, l.rolinherit, l.rolbypassrls)
    into v
    from pg_roles a, pg_roles l
   where a.rolname = 'akool_api' and l.rolname = 'akool_api_login';
  out := out || v;

  -- 1. Herança e barreiras declaradas (esperado: t, f, t, f, f, f).
  out := out || format('akool_api usa authenticated: %s | akool_api pode SET authenticated: %s',
                       pg_has_role('akool_api', 'authenticated', 'USAGE'), pg_has_role('akool_api', 'authenticated', 'SET'));
  out := out || format('login pode SET akool_api: %s | login herda akool_api: %s | login pode SET authenticated: %s | login usa authenticated: %s',
                       pg_has_role('akool_api_login', 'akool_api', 'SET'), pg_has_role('akool_api_login', 'akool_api', 'USAGE'),
                       pg_has_role('akool_api_login', 'authenticated', 'SET'), pg_has_role('akool_api_login', 'authenticated', 'USAGE'));

  -- Pessoa U (com uma nota rápida) e pessoa O, descartáveis.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('api002-u-%s@example.invalid', tag)), (o, format('api002-o-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining)
  values (u, format('api002-u-%s@example.invalid', tag), 'U', 'standard', true, 0),
         (o, format('api002-o-%s@example.invalid', tag), 'O', 'standard', true, 0);
  insert into public.quick_notes (user_id, content) values (u, 'nota de U'), (o, 'nota de O');
  set local session_replication_role = origin;

  -- 2. Como akool_api com os claims de U: policies TO authenticated e grants por coluna.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'akool_api', json_build_object('token_id', gen_random_uuid()))::text, true);
  set local role akool_api;
  out := out || format('current_user=%s auth.uid()=U? %s', current_user, auth.uid() = u);
  begin
    select count(*) into n from public.quick_notes;
    out := out || format('quick_notes visíveis (esperado 1, só a de U): %s', n);
  exception when others then out := out || ('quick_notes select: ERRO ' || sqlerrm); end;
  begin
    insert into public.quick_notes (user_id, content) values (u, 'nova de U');
    out := out || 'insert de nota própria: ok'::text;
  exception when others then out := out || ('insert de nota própria: ERRO ' || sqlerrm); end;
  begin
    insert into public.quick_notes (user_id, content) values (o, 'intrusa');
    out := out || 'insert de nota de O: PERMITIDO (falha)'::text;
  exception when others then out := out || ('insert de nota de O: bloqueado (' || sqlerrm || ')'); end;
  begin
    select display_name into v from public.profiles where id = u;
    out := out || format('profiles.display_name (grant por coluna): ok (%s)', v);
  exception when others then out := out || ('profiles.display_name: ERRO ' || sqlerrm); end;
  begin
    select role into v from public.profiles where id = u;
    out := out || 'profiles.role (sem grant): LIDO (falha)'::text;
  exception when others then out := out || ('profiles.role (sem grant): bloqueado (' || sqlerrm || ')'); end;
  begin
    update public.profiles set display_name = 'U2' where id = u;
    get diagnostics n = row_count;
    out := out || format('update profiles.display_name próprio: %s linha(s)', n);
  exception when others then out := out || ('update display_name: ERRO ' || sqlerrm); end;
  begin
    update public.profiles set role = 'admin' where id = u;
    out := out || 'update profiles.role: PERMITIDO (falha)'::text;
  exception when others then out := out || ('update profiles.role: bloqueado (' || sqlerrm || ')'); end;
  reset role;

  -- 3. akool_api_login sozinho (NOINHERIT): nenhuma tabela pública.
  set local role akool_api_login;
  begin
    select count(*) into n from public.quick_notes;
    out := out || format('akool_api_login lê quick_notes: PERMITIDO (falha, %s)', n);
  exception when others then out := out || ('akool_api_login lê quick_notes: bloqueado (' || sqlerrm || ')'); end;
  begin
    select count(*) into n from public.profiles;
    out := out || format('akool_api_login lê profiles: PERMITIDO (falha, %s)', n);
  exception when others then out := out || ('akool_api_login lê profiles: bloqueado (' || sqlerrm || ')'); end;
  reset role;

  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and has_function_privilege('akool_api_login', p.oid, 'EXECUTE');
  out := out || format('funções de public executáveis por akool_api_login (via PUBLIC): %s', n);

  raise exception using message = format(E'API-002: sonda dos papéis (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$probe$;

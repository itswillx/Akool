-- API-006: guarda de workspace sem usuário (migration
-- 20261005150000_api006_guards_without_user).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Cada linha sai "ok" ou "FALHA".
--
-- Bloco 1 (staging e produção): INSERT e UPDATE de linha com workspace_id em
-- cada contexto: sem claims (cron, migration), service_role sem sub (a
-- restauração), JWT de cliente sem sub, pessoa de fora, membro.
--
-- Bloco 2 (SÓ STAGING): chama a restauração de verdade com uma fixture mínima.
-- Ela apaga as 38 tabelas do backup antes de inserir (tudo desfeito no fim),
-- então só roda com o opt-in na mesma sessão:
--   select set_config('akool.api006_full_restore', 'staging', false);
-- Antes da migration, o bloco 2 mostra a falha; depois, a restauração conclui.
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres.

do $bloco1$
declare
  u1 uuid := gen_random_uuid();  -- dono e membro do workspace
  u2 uuid := gen_random_uuid();  -- de fora
  w uuid := gen_random_uuid();
  acc uuid := gen_random_uuid(); -- conta de u2, sem workspace
  tag text := substr(md5(random()::text), 1, 6);
  r text;
  n int;
  out text[] := array[]::text[];
begin
  -- try: roda um SQL com os claims (ou nenhum) e, se pedido, num papel; devolve
  -- 'ok' ou 'erro <sqlstate>: <mensagem>'. A exceção desfaz só o sub-bloco.
  create function pg_temp.try(p_claims jsonb, p_role text, p_sql text)
  returns text
  language plpgsql
  as $f$
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    if p_role is not null then
      execute format('set local role %I', p_role);
    end if;
    execute p_sql;
    if p_role is not null then
      reset role;
    end if;
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
    (u1, format('api006-u1-%s@example.invalid', tag)), (u2, format('api006-u2-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (u1, format('api006-u1-%s@example.invalid', tag), 'U1', 'standard', true, 0),
    (u2, format('api006-u2-%s@example.invalid', tag), 'U2', 'standard', true, 0);
  insert into public.finance_workspaces (id, name, owner_id) values (w, 'api006', u1);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (w, u1, 'owner');
  insert into public.finance_accounts (id, user_id, name, type) values (acc, u2, 'Conta de U2', 'checking');
  set local session_replication_role = origin;

  r := pg_temp.try(null, null, format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'cron', 'checking')$q$, u1, w));
  out := out || pg_temp.expect('sem claims (cron, migration) insere com workspace', r, 'ok');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), null, format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'restore', 'checking')$q$, u1, w));
  out := out || pg_temp.expect('service_role sem sub (restauração) insere com workspace', r, 'ok');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), null, format($q$update public.finance_accounts set workspace_id = %L where id = %L$q$, w, acc));
  out := out || pg_temp.expect('service_role sem sub move linha para o workspace', r, 'ok');
  r := pg_temp.try(jsonb_build_object('role', 'authenticated'), null, format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'x', 'checking')$q$, u1, w));
  out := out || pg_temp.expect('JWT authenticated sem sub continua conferido', r, 'erro 42501: Nao e membro%');
  r := pg_temp.try(jsonb_build_object('role', 'anon'), null, format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'x', 'checking')$q$, u1, w));
  out := out || pg_temp.expect('JWT anon sem sub continua conferido', r, 'erro 42501: Nao e membro%');

  r := pg_temp.try(jsonb_build_object('sub', u2, 'role', 'authenticated'), 'authenticated',
                   format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'intrusa', 'checking')$q$, u2, w));
  out := out || pg_temp.expect('pessoa de fora não insere no workspace', r, 'erro 42501:%');
  update public.finance_accounts set workspace_id = null where id = acc;
  r := pg_temp.try(jsonb_build_object('sub', u2, 'role', 'authenticated'), 'authenticated',
                   format($q$update public.finance_accounts set workspace_id = %L where id = %L$q$, w, acc));
  out := out || pg_temp.expect('pessoa de fora não move a própria linha para o workspace', r, 'erro 42501:%');
  r := pg_temp.try(jsonb_build_object('sub', u1, 'role', 'authenticated'), 'authenticated',
                   format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'do membro', 'checking')$q$, u1, w));
  out := out || pg_temp.expect('membro insere no workspace', r, 'ok');
  if exists (select 1 from pg_roles where rolname = 'akool_api') then
    r := pg_temp.try(jsonb_build_object('sub', u2, 'role', 'authenticated', 'akool_api', jsonb_build_object('token_id', gen_random_uuid())), 'akool_api',
                     format($q$insert into public.finance_accounts (user_id, workspace_id, name, type) values (%L, %L, 'api', 'checking')$q$, u2, w));
    out := out || pg_temp.expect('sessão da API (akool_api) de fora não insere', r, 'erro 42501:%');
  end if;

  select count(*) into n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where p.oid = 'public.finance_guard_workspace()'::regprocedure and not t.tgisinternal;
  out := out || pg_temp.expect('gatilhos que usam a guarda', n::text, '16');
  select format('%s %s %s %s',
                p.prosecdef, array_to_string(p.proconfig, ','),
                has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE'))
    into r from pg_proc p where p.oid = 'public.finance_guard_workspace()'::regprocedure;
  out := out || pg_temp.expect('SECURITY DEFINER, search_path e sem EXECUTE de cliente', r, 't search_path=public f f');

  raise exception using message = format(E'API-006 bloco 1: guarda de workspace sem usuário (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$bloco1$;

do $bloco2$
declare
  u uuid := gen_random_uuid();
  w uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  payload jsonb;
  summary jsonb;
  n int;
  out text[] := array[]::text[];
begin
  if coalesce(current_setting('akool.api006_full_restore', true), '') <> 'staging' then
    raise exception 'API-006 bloco 2: só no staging, com set_config(''akool.api006_full_restore'', ''staging'', false) na mesma sessão';
  end if;

  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('api006-r-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining)
  values (u, format('api006-r-%s@example.invalid', tag), 'R', 'standard', true, 0);
  insert into public.finance_workspaces (id, name, owner_id) values (w, 'api006 restore', u);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.finance_accounts (user_id, workspace_id, name, type) values (u, w, 'Conta do workspace', 'checking');
  set local session_replication_role = origin;

  -- O backup guarda as linhas inteiras (to_jsonb), e a restauração insere tudo de volta.
  payload := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(t)) from public.profiles t where t.id = u),
    'finance_workspaces', (select jsonb_agg(to_jsonb(t)) from public.finance_workspaces t where t.id = w),
    'finance_workspace_members', (select jsonb_agg(to_jsonb(t)) from public.finance_workspace_members t where t.workspace_id = w),
    'finance_accounts', (select jsonb_agg(to_jsonb(t)) from public.finance_accounts t where t.workspace_id = w)
  );

  -- Como a edge function site-backup chama: service_role, sem usuário.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    summary := public.restore_site_backup(payload);
    select count(*) into n from public.finance_accounts where workspace_id = w;
    out := out || format('%s restauração com linha de workspace conclui → finance_accounts: %s, no banco: %s',
                         case when (summary ->> 'finance_accounts') = '1' and n = 1 then 'ok   ' else 'FALHA' end,
                         summary ->> 'finance_accounts', n);
  exception when others then
    out := out || format('FALHA restauração com linha de workspace → erro %s: %s', sqlstate, sqlerrm);
  end;

  raise exception using message = format(E'API-006 bloco 2: restauração no staging (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$bloco2$;

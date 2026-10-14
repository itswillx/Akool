-- API-001: verificação dos escopos do token (migration 20261005100000_api001_token_scopes).
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa pessoas descartáveis: A (comum), M
-- (comum com MFA verificado), D (admin) e O (comum).
-- Como rodar: SQL editor do Supabase, MCP execute_sql ou psql como postgres,
-- depois da migration (ou logo depois dela, no mesmo envio, como ensaio).
-- Cada linha sai "ok" ou "FALHA" com o que voltou (segredos de token mascarados).
do $check$
declare
  a uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  r text;
  t_legacy jsonb;
  t_read365 jsonb;
  t_m_write jsonb;
  t_m_read jsonb;
  t_admin jsonb;
  t_admin2 jsonb;
  t_o jsonb;
  v jsonb;
  n int;
  audit0 int;
  out text[] := array[]::text[];
begin
  -- Helpers da sessão (somem no RAISE). as_user roda um SQL como authenticated
  -- com os claims da pessoa e devolve 'ok <resultado>' ou 'erro <sqlstate>: <msg>'.
  create function pg_temp.as_user(p_uid uuid, p_aal text, p_api boolean, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims',
      (jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)
        || case when p_api then jsonb_build_object('akool_api', jsonb_build_object('token_id', gen_random_uuid())) else '{}'::jsonb end)::text,
      true);
    set local role authenticated;
    execute p_sql into v_res;
    reset role;
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label,
                  left(regexp_replace(p_got, 'akool_pat_[0-9a-f]+', 'akool_pat_…', 'g'), 160))
  $f$;

  create function pg_temp.hash(p_token jsonb)
  returns text
  language sql
  as $f$
    select encode(sha256(convert_to(p_token ->> 'token', 'UTF8')), 'hex')
  $f$;

  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (a, format('api001-a-%s@example.invalid', tag)), (m, format('api001-m-%s@example.invalid', tag)),
    (d, format('api001-d-%s@example.invalid', tag)), (o, format('api001-o-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api001-a-%s@example.invalid', tag), 'A', 'standard', true, 0),
    (m, format('api001-m-%s@example.invalid', tag), 'M', 'standard', true, 0),
    (d, format('api001-d-%s@example.invalid', tag), 'D', 'admin', true, 0),
    (o, format('api001-o-%s@example.invalid', tag), 'O', 'standard', true, 0);
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), m, 'api001', 'totp', 'verified', now(), now());
  set local session_replication_role = origin;

  -- 1. Criar (sessão do app).
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token(p_name => 'legado', p_expires_in_days => 90)::text$q$);
  out := out || pg_temp.expect('2 argumentos nomeados (tela atual) dão o preset legado', r, 'ok %"projetos.fila": "write"%');
  t_legacy := substr(r, 4)::jsonb;
  out := out || pg_temp.expect('preset legado sem validação', case when r like '%validacao%' then 'com validacao' else 'sem validacao' end, 'sem validacao');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 90, '{"projetos.tudo": "read"}')::text$q$);
  out := out || pg_temp.expect('subseção inexistente', r, 'erro 22023:%inexistente%');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 90, '{"projetos.fila": "delete"}')::text$q$);
  out := out || pg_temp.expect('nível acima do máximo', r, 'erro 22023:%no máximo%');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 30, '{"admin.auditoria": "read"}')::text$q$);
  out := out || pg_temp.expect('admin.* sem ser admin', r, 'erro 42501:%administradores%');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 45, '{"projetos.cards": "read"}')::text$q$);
  out := out || pg_temp.expect('validade fora de 7/30/90/365', r, 'erro 22023:%7, 30, 90 ou 365%');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 365, '{"projetos.fila": "write"}')::text$q$);
  out := out || pg_temp.expect('escrita com 365 dias', r, 'erro 22023:%90 dias%');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('leitura', 365, '{"projetos.cards": "read"}')::text$q$);
  out := out || pg_temp.expect('só leitura com 365 dias', r, 'ok %');
  t_read365 := substr(r, 4)::jsonb;
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 90, '{"projetos.cards": "none"}')::text$q$);
  out := out || pg_temp.expect('sem nenhuma permissão', r, 'erro 22023:%ao menos uma%');
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('x', 90, '["projetos.cards"]')::text$q$);
  out := out || pg_temp.expect('permissões fora do formato', r, 'erro 22023:%objeto%');

  -- 2. MFA: com fator verificado, escrita exige AAL2.
  r := pg_temp.as_user(m, 'aal1', false, $q$select public.create_api_token('x', 90, '{"projetos.fila": "write"}')::text$q$);
  out := out || pg_temp.expect('MFA + aal1 + escrita', r, 'erro 42501:%segundo fator%');
  r := pg_temp.as_user(m, 'aal2', false, $q$select public.create_api_token('m-escrita', 90, '{"projetos.fila": "write"}')::text$q$);
  out := out || pg_temp.expect('MFA + aal2 + escrita', r, 'ok %');
  t_m_write := substr(r, 4)::jsonb;
  r := pg_temp.as_user(m, 'aal1', false, $q$select public.create_api_token('m-leitura', 90, '{"projetos.cards": "read"}')::text$q$);
  out := out || pg_temp.expect('MFA + aal1 + só leitura', r, 'ok %');
  t_m_read := substr(r, 4)::jsonb;

  -- 3. Administração: só admin, até 30 dias, com trilha no audit_log.
  select count(*) into audit0 from public.audit_log where actor_id = d and action = 'api_token_admin_scopes';
  r := pg_temp.as_user(d, 'aal1', false, $q$select public.create_api_token('adm', 30, '{"admin.usuarios": "read"}')::text$q$);
  out := out || pg_temp.expect('admin.usuarios por admin, 30 dias', r, 'ok %');
  t_admin := substr(r, 4)::jsonb;
  r := pg_temp.as_user(d, 'aal1', false, $q$select public.create_api_token('adm2', 30, '{"admin.auditoria": "read", "projetos.cards": "read"}')::text$q$);
  out := out || pg_temp.expect('admin.auditoria + cards por admin', r, 'ok %');
  t_admin2 := substr(r, 4)::jsonb;
  r := pg_temp.as_user(d, 'aal1', false, $q$select public.create_api_token('x', 90, '{"admin.usuarios": "read"}')::text$q$);
  out := out || pg_temp.expect('admin.* com 90 dias', r, 'erro 22023:%30 dias%');

  -- 4. Chamada com claims de token da API: nada de gerir tokens.
  r := pg_temp.as_user(a, 'aal1', true, $q$select public.create_api_token('x', 90, null)::text$q$);
  out := out || pg_temp.expect('criar com claim akool_api', r, 'erro 42501:%pelo app%');
  r := pg_temp.as_user(a, 'aal1', true, format($q$select public.update_api_token_scopes(%L, '{"projetos.cards": "read"}')::text$q$, t_legacy ->> 'id'));
  out := out || pg_temp.expect('editar com claim akool_api', r, 'erro 42501:%');
  r := pg_temp.as_user(a, 'aal1', true, format($q$select public.delete_api_token(%L)::text$q$, t_legacy ->> 'id'));
  out := out || pg_temp.expect('excluir com claim akool_api', r, 'erro 42501:%');
  r := pg_temp.as_user(a, 'aal1', true, $q$select public.revoke_all_my_api_tokens()::text$q$);
  out := out || pg_temp.expect('revogar todos com claim akool_api', r, 'erro 42501:%');

  -- 5. Editar permissões (o segredo não muda).
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.update_api_token_scopes(%L, %L)::text$q$,
                       t_legacy ->> 'id', (t_legacy -> 'scopes') || '{"projetos.validacao": "write"}'));
  out := out || pg_temp.expect('ativar Validação no token legado', r, 'ok %"projetos.validacao": "write"%');
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.update_api_token_scopes(%L, '{"projetos.fila": "write"}')::text$q$, t_read365 ->> 'id'));
  out := out || pg_temp.expect('escrita num token que vence em 365 dias', r, 'erro 22023:%90 dias%');
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.update_api_token_scopes(%L, '{"projetos.cards": "read"}')::text$q$, t_m_read ->> 'id'));
  out := out || pg_temp.expect('editar token de outra pessoa', r, 'erro P0002:%');
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.update_api_token_scopes(%L, '{"admin.backups": "read"}')::text$q$, t_legacy ->> 'id'));
  out := out || pg_temp.expect('dar admin.* sem ser admin', r, 'erro 42501:%administradores%');
  r := pg_temp.as_user(d, 'aal1', false, format($q$select public.update_api_token_scopes(%L, '{"projetos.cards": "read"}')::text$q$, t_admin ->> 'id'));
  out := out || pg_temp.expect('admin tira admin.* do token', r, 'ok %');
  select count(*) - audit0 into n from public.audit_log where actor_id = d and action = 'api_token_admin_scopes';
  out := out || pg_temp.expect('linhas de audit_log (2 criações + 1 edição)', n::text, '3');

  -- 6. Limite de 20 ativos.
  for i in 1..25 loop
    r := pg_temp.as_user(a, 'aal1', false, $q$select public.create_api_token('lote', 7, '{"projetos.cards": "read"}')::text$q$);
    exit when r not like 'ok %';
  end loop;
  select count(*) into n from public.api_tokens where user_id = a and revoked_at is null and expires_at > now();
  out := out || pg_temp.expect(format('21º token (ativos: %s)', n), r, 'erro P0001:%20 tokens%');

  -- 7. Resolver (o que a cards-api faz, como service_role). Sem claims de
  --    ninguém daqui em diante, e mudanças de conta sem gatilhos.
  perform set_config('request.jwt.claims', '', true);
  v := public.resolve_api_token_v2(pg_temp.hash(t_legacy), 'harness');
  out := out || pg_temp.expect('resolve devolve dono e escopos',
    format('%s %s', v ->> 'user_id' = a::text, v -> 'scopes' ->> 'projetos.validacao'), 't write');
  update public.api_tokens set last_used_at = now() - interval '10 seconds', last_client = 'antes' where id = (t_legacy ->> 'id')::uuid;
  perform public.resolve_api_token_v2(pg_temp.hash(t_legacy), 'depois');
  select last_client into r from public.api_tokens where id = (t_legacy ->> 'id')::uuid;
  out := out || pg_temp.expect('last_used_at/last_client: no máximo 1 gravação por minuto', r, 'antes');
  update public.api_tokens set last_used_at = now() - interval '2 minutes' where id = (t_legacy ->> 'id')::uuid;
  perform public.resolve_api_token_v2(pg_temp.hash(t_legacy), 'depois');
  select last_client into r from public.api_tokens where id = (t_legacy ->> 'id')::uuid;
  out := out || pg_temp.expect('depois de 1 minuto grava de novo', r, 'depois');

  set local session_replication_role = replica;
  update public.profiles set role = 'standard' where id = d;
  set local session_replication_role = origin;
  v := public.resolve_api_token_v2(pg_temp.hash(t_admin2), null);
  out := out || pg_temp.expect('admin rebaixado perde admin.*', coalesce(v -> 'scopes', 'null'::jsonb)::text, '{"projetos.cards": "read"}');

  set local session_replication_role = replica;
  update public.profiles set is_active = false where id = m;
  out := out || pg_temp.expect('conta desativada', coalesce(public.resolve_api_token_v2(pg_temp.hash(t_m_write), null)::text, 'null'), 'null');
  update public.profiles set is_active = true where id = m;
  update auth.users set banned_until = now() + interval '1 day' where id = m;
  out := out || pg_temp.expect('conta banida', coalesce(public.resolve_api_token_v2(pg_temp.hash(t_m_write), null)::text, 'null'), 'null');
  update auth.users set banned_until = null where id = m;
  set local session_replication_role = origin;
  update public.api_tokens set expires_at = now() - interval '1 second' where id = (t_m_read ->> 'id')::uuid;
  out := out || pg_temp.expect('token expirado', coalesce(public.resolve_api_token_v2(pg_temp.hash(t_m_read), null)::text, 'null'), 'null');
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.revoke_api_token(%L)::text$q$, t_read365 ->> 'id'));
  out := out || pg_temp.expect('token revogado', coalesce(public.resolve_api_token_v2(pg_temp.hash(t_read365), null)::text, 'null'), 'null');

  -- 8. Excluir: o token ativo para de resolver na hora.
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.delete_api_token(%L)::text$q$, t_legacy ->> 'id'));
  out := out || pg_temp.expect('excluir token ativo próprio', r, 'ok %');
  out := out || pg_temp.expect('token excluído não resolve', coalesce(public.resolve_api_token_v2(pg_temp.hash(t_legacy), null)::text, 'null'), 'null');
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.delete_api_token(%L)::text$q$, t_m_write ->> 'id'));
  out := out || pg_temp.expect('excluir token de outra pessoa', r, 'erro P0002:%');
  out := out || pg_temp.expect('o de outra pessoa continua resolvendo', coalesce(public.resolve_api_token_v2(pg_temp.hash(t_m_write), null)::text, 'null'), '{%');
  r := pg_temp.as_user(a, 'aal1', false, format($q$select public.delete_api_token(%L)::text$q$, t_read365 ->> 'id'));
  out := out || pg_temp.expect('excluir token revogado', r, 'ok %');

  -- 9. Revogar todos.
  r := pg_temp.as_user(a, 'aal1', false, $q$select public.revoke_all_my_api_tokens()::text$q$);
  select count(*) into n from public.api_tokens where user_id = a and revoked_at is null and expires_at > now();
  out := out || pg_temp.expect(format('revogar todos (%s); ativos depois', r), n::text, '0');

  -- 10. Grants, colunas e forma.
  out := out || pg_temp.expect('create de 2 argumentos não existe mais', coalesce(to_regprocedure('public.create_api_token(text,integer)')::text, 'null'), 'null');
  out := out || pg_temp.expect('anon não executa create/update/delete/revoke_all',
    format('%s %s %s %s', has_function_privilege('anon', 'public.create_api_token(text,integer,jsonb)', 'EXECUTE'),
           has_function_privilege('anon', 'public.update_api_token_scopes(uuid,jsonb)', 'EXECUTE'),
           has_function_privilege('anon', 'public.delete_api_token(uuid)', 'EXECUTE'),
           has_function_privilege('anon', 'public.revoke_all_my_api_tokens()', 'EXECUTE')), 'f f f f');
  out := out || pg_temp.expect('authenticated executa create/update/delete/revoke_all',
    format('%s %s %s %s', has_function_privilege('authenticated', 'public.create_api_token(text,integer,jsonb)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.update_api_token_scopes(uuid,jsonb)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.delete_api_token(uuid)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.revoke_all_my_api_tokens()', 'EXECUTE')), 't t t t');
  out := out || pg_temp.expect('resolve_api_token_v2 só service_role (anon, authenticated, service_role)',
    format('%s %s %s', has_function_privilege('anon', 'public.resolve_api_token_v2(text,text)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.resolve_api_token_v2(text,text)', 'EXECUTE'),
           has_function_privilege('service_role', 'public.resolve_api_token_v2(text,text)', 'EXECUTE')), 'f f t');
  out := out || pg_temp.expect('authenticated lê scopes e last_client, não lê token_hash nem user_id',
    format('%s %s %s %s', has_column_privilege('authenticated', 'public.api_tokens', 'scopes', 'SELECT'),
           has_column_privilege('authenticated', 'public.api_tokens', 'last_client', 'SELECT'),
           has_column_privilege('authenticated', 'public.api_tokens', 'token_hash', 'SELECT'),
           has_column_privilege('authenticated', 'public.api_tokens', 'user_id', 'SELECT')), 't t f f');
  out := out || pg_temp.expect('authenticated não executa as funções private.api_*',
    (select string_agg(has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ' ')
       from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'private' and p.proname like 'api\_%'), 'false false false false false false false');
  r := pg_temp.as_user(a, 'aal1', false, $q$select count(*)::text from public.api_tokens$q$);
  select count(*) into n from public.api_tokens where user_id = a;
  out := out || pg_temp.expect('authenticated vê só os próprios tokens', r, 'ok ' || n);
  begin
    update public.api_tokens set scopes = '{"projetos.cards": "admin"}' where id = (t_m_write ->> 'id')::uuid;
    out := out || 'FALHA CHECK de forma aceitou nível inválido'::text;
  exception when check_violation then
    out := out || 'ok    CHECK de forma recusa nível inválido'::text;
  end;
  select count(*) into n from private.api_scope_catalog;
  out := out || pg_temp.expect('catálogo com 27 subseções', n::text, '27');
  select count(*) into n from public.api_tokens t
   where t.user_id not in (a, m, d, o) and t.revoked_at is null and t.expires_at > now() and t.scopes = '{}'::jsonb;
  out := out || pg_temp.expect('tokens ativos de antes sem permissão (migração)', n::text, '0');

  raise exception using message = format(E'API-001: escopos do token (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$check$;

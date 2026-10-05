-- API-009: os fluxos da tela Configurações → API contra o banco de verdade
-- (migration 20261005100000_api001_token_scopes). Complementa o
-- api001-token-scopes.sql com o que a tela faz:
--   - o select exato da lista (API_TOKEN_COLUMNS em src/lib/data/apiTokens.ts);
--   - os presets de src/components/apiTokens/presets.ts com a validade máxima
--     de cada um (maxTokenDays em supabase/functions/_api/scopes.ts);
--   - as travas da edição pela validade restante, o limite de 20 ativos;
--   - o fim da vida do token: o 401 da cards-api é resolve_api_token_v2
--     devolvendo nulo.
--
-- Roda numa transação desfeita (termina em RAISE EXCEPTION com o resultado),
-- então nada fica gravado. Pessoas descartáveis: A (comum, sem MFA), M (comum,
-- com MFA verificado), L (comum, para o limite), D (admin) e O (outra pessoa,
-- para o RLS). Cada linha sai "ok" ou "FALHA", com os segredos mascarados.
-- Resultado em 05/10/2026: 38/38 no staging e na produção, nada gravado.
-- Como rodar: SQL editor do Supabase, MCP execute_sql ou psql como postgres.
do $check$
declare
  a uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  l uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  o uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  -- Os presets de src/components/apiTokens/presets.ts (scopeModel.test.ts confere esta linha).
  presets jsonb := '{"read_only": {"perfil.dados": "read", "perfil.notificacoes": "read", "perfil.convites": "read", "documentos.paginas": "read", "documentos.notas": "read", "documentos.desenhos": "read", "documentos.tarefas": "read", "documentos.notas_rapidas": "read", "estudos.conteudo": "read", "estudos.progresso": "read", "estudos.diario": "read", "projetos.quadros": "read", "projetos.cards": "read", "projetos.fila": "read", "projetos.validacao": "read", "financas.transacoes": "read", "financas.contas": "read", "financas.categorias": "read", "financas.orcamentos_metas": "read", "financas.recorrentes": "read", "financas.loja": "read", "financas.emprestimos": "read"}, "claude_fila": {"projetos.quadros": "read", "projetos.cards": "read", "projetos.fila": "write"}, "finance_entry": {"financas.transacoes": "write", "financas.orcamentos_metas": "write", "financas.recorrentes": "write", "financas.contas": "read", "financas.categorias": "read"}}';
  list_sql text := 'select count(*)::text from (select id, name, prefix, scopes, created_at, last_used_at, last_client, expires_at, revoked_at from public.api_tokens) t';
  r text;
  t_read jsonb;
  t_fila jsonb;
  t_fin jsonb;
  t_legacy jsonb;
  t_o jsonb;
  t_d_read jsonb;
  t_l jsonb;
  expired_id uuid := gen_random_uuid();
  v jsonb;
  h_before text;
  p_before text;
  n int;
  out text[] := array[]::text[];
begin
  -- Helpers da sessão (somem no RAISE), os mesmos do api001-token-scopes.sql.
  -- as_user roda um SQL como authenticated com os claims da pessoa e devolve
  -- 'ok <resultado>' ou 'erro <sqlstate>: <msg>'.
  create function pg_temp.as_user(p_uid uuid, p_aal text, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

  create function pg_temp.json_of(p_res text)
  returns jsonb
  language sql
  as $f$
    select case when p_res like 'ok {%' then substr(p_res, 4)::jsonb end
  $f$;

  create function pg_temp.hash(p_token jsonb)
  returns text
  language sql
  as $f$
    select encode(sha256(convert_to(p_token ->> 'token', 'UTF8')), 'hex')
  $f$;

  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (a, format('api009-a-%s@example.invalid', tag)), (m, format('api009-m-%s@example.invalid', tag)),
    (l, format('api009-l-%s@example.invalid', tag)),
    (d, format('api009-d-%s@example.invalid', tag)), (o, format('api009-o-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api009-a-%s@example.invalid', tag), 'A', 'standard', true, 0),
    (m, format('api009-m-%s@example.invalid', tag), 'M', 'standard', true, 0),
    (l, format('api009-l-%s@example.invalid', tag), 'L', 'standard', true, 0),
    (d, format('api009-d-%s@example.invalid', tag), 'D', 'admin', true, 0),
    (o, format('api009-o-%s@example.invalid', tag), 'O', 'standard', true, 0);
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), m, 'api009', 'totp', 'verified', now(), now());
  set local session_replication_role = origin;

  -- 1. A lista: o select exato da tela, só os tokens da própria pessoa.
  t_o := pg_temp.json_of(pg_temp.as_user(o, 'aal1', $q$select public.create_api_token('de O', 30, '{"projetos.cards": "read"}')::text$q$));
  out := out || pg_temp.expect('lista: O tem um token', coalesce(t_o ->> 'prefix', 'sem token'), 'akool_pat_%');
  r := pg_temp.as_user(a, 'aal1', list_sql);
  out := out || pg_temp.expect('lista: o select da tela funciona e não mostra o token de O', r, 'ok 0');
  r := pg_temp.as_user(a, 'aal1', 'select count(token_hash)::text from public.api_tokens');
  out := out || pg_temp.expect('lista: token_hash fora do alcance do app', r, 'erro 42501:%');
  r := pg_temp.as_user(a, 'aal1', 'select count(user_id)::text from public.api_tokens');
  out := out || pg_temp.expect('lista: user_id também (a tela não pede)', r, 'erro 42501:%');

  -- 2. Presets com a validade máxima de cada um.
  r := pg_temp.as_user(a, 'aal1', format($q$select public.create_api_token('somente leitura', 365, %L)::text$q$, presets -> 'read_only'));
  out := out || pg_temp.expect('preset Somente leitura com 365 dias', r, 'ok {%');
  t_read := pg_temp.json_of(r);
  r := pg_temp.as_user(a, 'aal1', format($q$select public.create_api_token('fila', 90, %L)::text$q$, presets -> 'claude_fila'));
  out := out || pg_temp.expect('preset Claude Code: fila com 90 dias', r, 'ok {%');
  t_fila := pg_temp.json_of(r);
  r := pg_temp.as_user(a, 'aal1', format($q$select public.create_api_token('financas', 90, %L)::text$q$, presets -> 'finance_entry'));
  out := out || pg_temp.expect('preset Entrada de dados financeiros com 90 dias', r, 'ok {%');
  t_fin := pg_temp.json_of(r);
  out := out || pg_temp.expect('o banco guarda os escopos do preset sem mudar nada',
    ((t_read -> 'scopes') = (presets -> 'read_only') and (t_fila -> 'scopes') = (presets -> 'claude_fila') and (t_fin -> 'scopes') = (presets -> 'finance_entry'))::text, 'true');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.create_api_token('x', 365, %L)::text$q$, presets -> 'claude_fila'));
  out := out || pg_temp.expect('fila com 365 dias: a tela trava em 90', r, 'erro 22023: Token com Escrever ou Excluir vale no máximo 90 dias');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.create_api_token('x', 365, %L)::text$q$, presets -> 'finance_entry'));
  out := out || pg_temp.expect('finanças com 365 dias: idem', r, 'erro 22023: Token com Escrever ou Excluir vale no máximo 90 dias');
  r := pg_temp.as_user(a, 'aal1', $q$select public.create_api_token('x', 30, '{"admin.usuarios": "read"}')::text$q$);
  out := out || pg_temp.expect('Administração por quem não é admin (a tela esconde)', r, 'erro 42501:%é só para administradores');
  r := pg_temp.as_user(m, 'aal1', format($q$select public.create_api_token('x', 90, %L)::text$q$, presets -> 'claude_fila'));
  out := out || pg_temp.expect('com MFA em AAL1, escrita pede o segundo fator (a tela leva a Segurança)', r, 'erro 42501: Confirme o segundo fator (MFA)%');
  r := pg_temp.as_user(m, 'aal1', format($q$select public.create_api_token('x', 365, %L)::text$q$, presets -> 'read_only'));
  out := out || pg_temp.expect('com MFA em AAL1, só leitura passa', r, 'ok {%');
  r := pg_temp.as_user(a, 'aal1', $q$select public.create_api_token('x', 30, '{}')::text$q$);
  out := out || pg_temp.expect('sem permissão nenhuma (a tela desliga Gerar)', r, 'erro 22023: Escolha ao menos uma permissão para o token');
  r := pg_temp.as_user(d, 'aal1', $q$select public.create_api_token('adm', 30, '{"admin.auditoria": "read"}')::text$q$);
  out := out || pg_temp.expect('admin: Administração com 30 dias', r, 'ok {%');
  r := pg_temp.as_user(d, 'aal1', $q$select public.create_api_token('adm', 90, '{"admin.auditoria": "read"}')::text$q$);
  out := out || pg_temp.expect('admin: Administração com 90 dias (a tela trava em 30)', r, 'erro 22023: Token com Administração vale no máximo 30 dias');
  r := pg_temp.as_user(a, 'aal1', list_sql);
  out := out || pg_temp.expect('lista: A vê os 3 tokens dele', r, 'ok 3');

  -- 3. Edição: o segredo não muda; a validade restante trava o nível.
  t_legacy := pg_temp.json_of(pg_temp.as_user(a, 'aal1', $q$select public.create_api_token(p_name => 'migrado', p_expires_in_days => 90)::text$q$));
  select token_hash, prefix into h_before, p_before from public.api_tokens where id = (t_legacy ->> 'id')::uuid;
  r := pg_temp.as_user(a, 'aal1', format($q$select public.update_api_token_scopes(%L, %L)::text$q$, t_legacy ->> 'id',
    (presets -> 'claude_fila') || '{"projetos.validacao": "write"}'::jsonb));
  out := out || pg_temp.expect('token migrado: ativar Validação', r, 'ok {%"projetos.validacao": "write"%');
  select count(*) into n from public.api_tokens where id = (t_legacy ->> 'id')::uuid and token_hash = h_before and prefix = p_before;
  out := out || pg_temp.expect('token migrado: mesmo segredo e prefixo depois da edição', n::text, '1');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.update_api_token_scopes(%L, '{"financas.contas": "write"}')::text$q$, t_read ->> 'id'));
  out := out || pg_temp.expect('escrita em token que vence em 365 dias (trava da tela)', r, 'erro 22023: Token com Escrever ou Excluir vale no máximo 90 dias');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.update_api_token_scopes(%L, '{}')::text$q$, t_fila ->> 'id'));
  out := out || pg_temp.expect('edição sem permissão nenhuma', r, 'erro 22023: Escolha ao menos uma permissão. Para desligar o token, revogue.');
  t_d_read := pg_temp.json_of(pg_temp.as_user(d, 'aal1', $q$select public.create_api_token('leitura', 365, '{"projetos.cards": "read"}')::text$q$));
  r := pg_temp.as_user(d, 'aal1', format($q$select public.update_api_token_scopes(%L, '{"admin.usuarios": "read"}')::text$q$, t_d_read ->> 'id'));
  out := out || pg_temp.expect('admin: Administração em token de 365 dias (trava da tela)', r, 'erro 22023: Token com Administração vale no máximo 30 dias');
  r := pg_temp.as_user(o, 'aal1', format($q$select public.update_api_token_scopes(%L, '{"projetos.cards": "read"}')::text$q$, t_fila ->> 'id'));
  out := out || pg_temp.expect('O não edita o token de A', r, 'erro P0002: Token não encontrado, revogado ou expirado');

  -- 4. Limite de 20 ativos; revogado não conta.
  n := 0;
  for i in 1..20 loop
    r := pg_temp.as_user(l, 'aal1', format($q$select public.create_api_token('limite %s', 7, '{"projetos.cards": "read"}')::text$q$, i));
    if r like 'ok {%' then
      n := n + 1;
      t_l := pg_temp.json_of(r);
    end if;
  end loop;
  out := out || pg_temp.expect('limite: 20 ativos criados', n::text, '20');
  r := pg_temp.as_user(l, 'aal1', $q$select public.create_api_token('21', 7, '{"projetos.cards": "read"}')::text$q$);
  out := out || pg_temp.expect('limite: o 21º é recusado', r, 'erro P0001: Limite de 20 tokens ativos. Revogue ou exclua um antes de gerar outro.');
  r := pg_temp.as_user(l, 'aal1', format($q$select public.revoke_api_token(%L)::text$q$, t_l ->> 'id'));
  r := pg_temp.as_user(l, 'aal1', $q$select public.create_api_token('depois de revogar', 7, '{"projetos.cards": "read"}')::text$q$);
  out := out || pg_temp.expect('limite: revogar um libera a vaga', r, 'ok {%');

  -- 5. Fim da vida do token.
  v := public.resolve_api_token_v2(pg_temp.hash(t_fin), 'api009-check');
  out := out || pg_temp.expect('token ativo resolve para o dono (a cards-api atende)', coalesce(v ->> 'user_id', 'nulo'), a::text);
  r := pg_temp.as_user(o, 'aal1', format($q$select public.delete_api_token(%L)::text$q$, t_fin ->> 'id'));
  out := out || pg_temp.expect('O não exclui o token de A', r, 'erro P0002: Token não encontrado');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.delete_api_token(%L)::text$q$, t_fin ->> 'id'));
  out := out || pg_temp.expect('excluir o token ativo', r, 'ok ');
  v := public.resolve_api_token_v2(pg_temp.hash(t_fin), 'api009-check');
  out := out || pg_temp.expect('excluído não resolve mais (cards-api responde 401)', coalesce(v ->> 'user_id', 'nulo'), 'nulo');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.delete_api_token(%L)::text$q$, t_fin ->> 'id'));
  out := out || pg_temp.expect('excluir de novo: "não encontrado" (outra aba)', r, 'erro P0002: Token não encontrado');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.revoke_api_token(%L)::text$q$, t_read ->> 'id'));
  v := public.resolve_api_token_v2(pg_temp.hash(t_read), 'api009-check');
  out := out || pg_temp.expect('revogado não resolve (401)', coalesce(v ->> 'user_id', 'nulo'), 'nulo');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.delete_api_token(%L)::text$q$, t_read ->> 'id'));
  out := out || pg_temp.expect('excluir o revogado', r, 'ok ');
  insert into public.api_tokens (id, user_id, name, token_hash, prefix, expires_at, scopes)
  values (expired_id, a, 'vencido', md5(random()::text) || md5(random()::text), 'akool_pat_venc', now() - interval '1 day', '{"projetos.cards": "read"}');
  r := pg_temp.as_user(a, 'aal1', format($q$select public.delete_api_token(%L)::text$q$, expired_id));
  out := out || pg_temp.expect('excluir o expirado', r, 'ok ');
  r := pg_temp.as_user(a, 'aal1', $q$select public.revoke_all_my_api_tokens()::text$q$);
  out := out || pg_temp.expect('revogar todos devolve quantos (fila e migrado)', r, 'ok 2');
  v := public.resolve_api_token_v2(pg_temp.hash(t_fila), 'api009-check');
  out := out || pg_temp.expect('depois de revogar todos, nenhum resolve', coalesce(v ->> 'user_id', 'nulo'), 'nulo');
  r := pg_temp.as_user(a, 'aal1', list_sql);
  out := out || pg_temp.expect('lista: sobram os 2 revogados, para "Limpar revogados e expirados"', r, 'ok 2');
  v := public.resolve_api_token_v2(pg_temp.hash(t_o), 'api009-check');
  out := out || pg_temp.expect('o token de O continua valendo', coalesce(v ->> 'user_id', 'nulo'), o::text);

  raise exception using message = format(E'API-009: fluxos da tela de tokens (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$check$;

-- SEC-016: verificação da busca de pessoas e do convite de workspace.
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa três usuários descartáveis, criados
-- e desfeitos aqui (nenhum usuário real é tocado): o preparo desliga gatilhos
-- (convite, perfil) com session_replication_role, e os cenários rodam como
-- `authenticated`, com o JWT desses IDs.
--
-- Como rodar: SQL editor do Supabase, ou psql como postgres. A mensagem de
-- erro traz uma linha por cenário; tudo "ok" = comportamento esperado.
do $check$
declare
  me       uuid := gen_random_uuid();  -- quem busca e convida
  related  uuid := gen_random_uuid();  -- compartilha uma página comigo
  stranger uuid := gen_random_uuid();  -- ninguém meu
  tag      text := substr(md5(random()::text), 1, 8);
  ws       uuid;
  other_ws uuid;
  page_id  uuid;
  inv1     uuid;
  inv2     uuid;
  n        int;
  out      text[] := array[]::text[];
begin
  -- Preparo: usuários e vínculos descartáveis.
  set local session_replication_role = replica;
  insert into auth.users (id, email)
  values (me, format('sec016-me-%s@example.invalid', tag)),
         (related, format('sec016-rel-%s@example.invalid', tag)),
         (stranger, format('sec016-str-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active)
  values (me, format('sec016-me-%s@example.invalid', tag), 'Eu ' || tag, 'standard', true),
         (related, format('sec016-rel-%s@example.invalid', tag), 'Parceira ' || tag, 'standard', true),
         (stranger, format('sec016-str-%s@example.invalid', tag), 'Estranho ' || tag, 'standard', true);
  insert into public.pages (user_id, title) values (me, 'compartilhada') returning id into page_id;
  insert into public.page_shares (page_id, owner_id, shared_with_user_id, role) values (page_id, me, related, 'viewer');
  insert into public.finance_workspaces (name, owner_id) values ('ws ' || tag, me) returning id into ws;
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, me, 'owner');
  insert into public.finance_workspaces (name, owner_id) values ('outro ' || tag, stranger) returning id into other_ws;
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (other_ws, stranger, 'owner');
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. Trecho acha só quem se relaciona comigo.
  select count(*) into n from public.search_users_for_share('sec016-');
  out := out || format('trecho "sec016-": %s resultado(s) — %s', n, case when n = 1 then 'ok (só a relacionada)' else 'FALHOU' end);
  select count(*) into n from public.search_users_for_share('Estranho ' || tag);
  out := out || format('nome do desconhecido: %s — %s', n, case when n = 0 then 'ok' else 'FALHOU (vazou)' end);

  -- 2. E-mail completo acha qualquer um.
  select count(*) into n from public.search_users_for_share(format('SEC016-STR-%s@example.invalid', tag));
  out := out || format('e-mail completo do desconhecido: %s — %s', n, case when n = 1 then 'ok' else 'FALHOU' end);

  -- 3. Convite: quem já tem workspace não é revelado; repetido devolve o mesmo.
  begin
    inv1 := public.invite_member(ws, format('sec016-str-%s@example.invalid', tag));
    inv2 := public.invite_member(ws, format('  SEC016-STR-%s@example.invalid ', tag));
    out := out || format('convite a quem já tem workspace: %s', case when inv1 is not null then 'ok (sem erro revelador)' else 'FALHOU' end);
    out := out || format('convite repetido: %s', case when inv1 = inv2 then 'ok (mesmo id)' else 'FALHOU' end);
  exception when others then
    out := out || format('convite: FALHOU (%s)', sqlerrm);
  end;

  reset role;
  raise exception E'SEC-016 (nada foi gravado):\n%', array_to_string(out, E'\n');
end
$check$;

-- API-003: verificação do updated_at das notas rápidas (migration
-- 20261005110000_api003_quick_notes_updated_at).
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa uma pessoa descartável.
-- Como rodar: SQL editor do Supabase, MCP execute_sql ou psql como postgres,
-- depois da migration (ou logo depois dela, no mesmo envio, como ensaio).
-- Cada linha sai "ok" ou "FALHA" com o que voltou.
do $check$
declare
  u uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  q uuid;
  v0 timestamptz;
  v1 timestamptz;
  n int;
  r text;
  out text[] := array[]::text[];
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('api003-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining)
  values (u, format('api003-%s@example.invalid', tag), 'U', 'standard', true, 0);
  set local session_replication_role = origin;

  -- 1. INSERT guarda o updated_at que veio (é o que o restore faz).
  insert into public.quick_notes (user_id, content, updated_at)
  values (u, 'restaurada', '2020-01-01T00:00:00Z')
  returning id, updated_at into q, v0;
  out := out || format('%s INSERT mantém o updated_at do backup → %s',
                       case when v0 = '2020-01-01T00:00:00Z'::timestamptz then 'ok   ' else 'FALHA' end, v0);

  -- Daqui em diante, como a pessoa (authenticated com os claims dela).
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 2. UPDATE com um updated_at velho do cliente: o servidor carimba a hora dele.
  update public.quick_notes set content = 'editada', updated_at = '2000-01-01T00:00:00Z' where id = q
  returning updated_at into v1;
  out := out || format('%s UPDATE ignora o updated_at do cliente → %s',
                       case when v1 = now() then 'ok   ' else 'FALHA' end, v1);

  -- 3. Gravação condicionada a uma versão velha: zero linhas (conflito, não sobrescrita).
  update public.quick_notes set content = 'por cima' where id = q and updated_at = v0;
  get diagnostics n = row_count;
  out := out || format('%s versão velha não grava → %s linha(s)', case when n = 0 then 'ok   ' else 'FALHA' end, n);

  -- 4. Gravação sobre a versão atual: uma linha.
  update public.quick_notes set content = 'na versão certa' where id = q and updated_at = v1;
  get diagnostics n = row_count;
  out := out || format('%s versão atual grava → %s linha(s)', case when n = 1 then 'ok   ' else 'FALHA' end, n);

  select content into r from public.quick_notes where id = q;
  out := out || format('%s conteúdo final → %s', case when r = 'na versão certa' then 'ok   ' else 'FALHA' end, r);
  reset role;

  select count(*) into n from pg_trigger
   where tgrelid = 'public.quick_notes'::regclass and tgname = 'quick_notes_updated_at' and not tgisinternal;
  out := out || format('%s gatilho quick_notes_updated_at → %s', case when n = 1 then 'ok   ' else 'FALHA' end, n);

  raise exception using message = format(E'API-003: updated_at das notas rápidas (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$check$;

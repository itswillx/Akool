-- SEC-018: verificação da auditoria de admin (convites, slots, privilégios).
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa um admin e uma pessoa descartáveis.
-- Como rodar: SQL editor do Supabase, ou psql como postgres. Tudo "ok" =
-- comportamento esperado depois da migration 20261001192047_sec018_admin_audit.
do $dry$
declare
  a uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  code_id uuid;
  n int;
  out text[] := array[]::text[];
begin

  -- Ensaio: admin A, pessoa U, convite de U. Tudo desfeito no RAISE final.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (a, format('sec018-a-%s@example.invalid', tag)), (u, format('sec018-u-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining)
  values (a, format('sec018-a-%s@example.invalid', tag), 'A', 'admin', true, 0),
         (u, format('sec018-u-%s@example.invalid', tag), 'U', 'standard', true, 1);
  insert into public.invite_codes (code, created_by) values ('S18' || upper(tag), u) returning id into code_id;
  set local session_replication_role = origin;

  -- 1. admin dá 2 slots: uma linha add_invite_slots, nenhuma profile_privilege_change.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_add_invite_slots(u, 2);
  reset role;
  select count(*) into n from public.audit_log where target_id = u::text and action = 'add_invite_slots' and (details->>'after')::int = 3;
  out := out || format('admin dá slots → add_invite_slots: %s', case when n = 1 then 'ok' else 'FALHOU (' || n || ')' end);
  select count(*) into n from public.audit_log where target_id = u::text and action = 'profile_privilege_change';
  out := out || format('sem duplicata do gatilho: %s', case when n = 0 then 'ok' else 'FALHOU (' || n || ')' end);

  -- 2. admin revoga o convite de U: revoke_invite_code, slot devolvido.
  set local role authenticated;
  perform public.admin_revoke_invite_code(code_id);
  reset role;
  select count(*) into n from public.audit_log where target_id = code_id::text and action = 'revoke_invite_code';
  out := out || format('admin revoga convite → revoke_invite_code: %s', case when n = 1 then 'ok' else 'FALHOU' end);
  select invite_slots_remaining into n from public.profiles where id = u;
  out := out || format('slot devolvido (3 → 4): %s', case when n = 4 then 'ok' else 'FALHOU (' || n || ')' end);

  -- 3. U tenta dar slots a si mesmo pela REST: sem permissão.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    update public.profiles set invite_slots_remaining = 99 where id = u;
    reset role;
    out := out || 'U grava os próprios slots: PERMITIDO'::text;
  exception when others then
    reset role;
    out := out || ('U grava os próprios slots: bloqueado (' || sqlerrm || ')');
  end;

  -- 4. U gera um convite gastando o próprio slot: não vira evento de admin.
  set local role authenticated;
  perform public.generate_invite_code();
  reset role;
  select count(*) into n from public.audit_log where target_id = u::text and action = 'profile_privilege_change';
  out := out || format('U gasta o próprio slot sem auditoria de admin: %s', case when n = 0 then 'ok' else 'FALHOU (' || n || ')' end);

  -- 5. Mudança fora dos caminhos auditados (SQL editor / postgres): auditada.
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set is_active = false, invite_slots_remaining = 10 where id = u;
  select count(*) into n from public.audit_log where target_id = u::text and action = 'profile_privilege_change'
     and details ? 'is_active' and details ? 'invite_slots_remaining';
  out := out || format('mudança direta (SQL editor) → profile_privilege_change: %s', case when n = 1 then 'ok' else 'FALHOU (' || n || ')' end);

  -- 6. service_role (admin-ops) não duplica o que a edge já audita.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  update public.profiles set is_active = true where id = u;
  select count(*) into n from public.audit_log where target_id = u::text and action = 'profile_privilege_change';
  out := out || format('service_role sem duplicata: %s', case when n = 1 then 'ok' else 'FALHOU (' || n || ')' end);

  raise exception E'SEC-018 verificação (nada foi gravado):\n%', array_to_string(out, E'\n');
end
$dry$;
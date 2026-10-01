-- SEC-018: auditoria das ações de admin sobre convites e privilégios do perfil.
--
-- 1. admin_add_invite_slots e admin_revoke_invite_code gravam no audit_log, na
--    mesma transação da mudança (antes, só a admin-ops auditava).
-- 2. authenticated perde o UPDATE em invite_slots_remaining (como o is_active no
--    SEC-006): só as RPCs SECURITY DEFINER mexem nos slots.
-- 3. Gatilho de rede de segurança: mudança em role, is_active ou
--    invite_slots_remaining feita fora dos caminhos que já auditam vira uma linha
--    profile_privilege_change com o antes e o depois. Ficam de fora:
--      - as RPCs de admin acima (ligam akool.audited_change só durante o
--        próprio UPDATE, e auditam a ação com o nome dela);
--      - a admin-ops (service_role), que audita ban/unban/set_role ela mesma;
--      - a pessoa gastando o próprio slot em generate_invite_code.
--    Sobra o que hoje passaria em silêncio: SQL editor, migrations, scripts.

create or replace function public.admin_add_invite_slots(p_user_id uuid, p_slots integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_before integer;
  v_after integer;
begin
  if not (select role = 'admin' from profiles where id = auth.uid()) then
    raise exception 'admin_only';
  end if;
  perform set_config('akool.audited_change', 'on', true);
  select invite_slots_remaining into v_before from profiles where id = p_user_id;
  update profiles
     set invite_slots_remaining = greatest(invite_slots_remaining + p_slots, 0)
   where id = p_user_id
  returning invite_slots_remaining into v_after;
  perform set_config('akool.audited_change', '', true);
  insert into audit_log (actor_id, actor_label, action, target_type, target_id, details, success)
  values (auth.uid(), (select email from profiles where id = auth.uid()), 'add_invite_slots', 'user', p_user_id::text,
          jsonb_build_object('delta', p_slots, 'before', v_before, 'after', v_after), v_after is not null);
end;
$fn$;

create or replace function public.admin_revoke_invite_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_creator uuid;
  v_code text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin_required';
  end if;

  select created_by, code into v_creator, v_code
    from public.invite_codes
   where id = p_code_id
     and used_at is null;

  if v_creator is null then
    raise exception 'code_not_found_or_already_used';
  end if;

  perform set_config('akool.audited_change', 'on', true);
  delete from public.invite_codes where id = p_code_id;

  -- Devolve o slot a quem criou o convite (se não for admin).
  update public.profiles
     set invite_slots_remaining = invite_slots_remaining + 1
   where id = v_creator
     and role != 'admin';
  perform set_config('akool.audited_change', '', true);

  insert into public.audit_log (actor_id, actor_label, action, target_type, target_id, details, success)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), 'revoke_invite_code', 'invite_code', p_code_id::text,
          jsonb_build_object('created_by', v_creator, 'code_suffix', right(v_code, 3)), true);
end;
$fn$;

revoke update (invite_slots_remaining) on public.profiles from authenticated, anon;

create or replace function private.audit_profile_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if coalesce(current_setting('akool.audited_change', true), '') = 'on' then
    return new;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.role is distinct from old.role then
    v_changes := v_changes || jsonb_build_object('role', jsonb_build_object('before', old.role, 'after', new.role));
  end if;
  if new.is_active is distinct from old.is_active then
    v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('before', old.is_active, 'after', new.is_active));
  end if;
  if new.invite_slots_remaining is distinct from old.invite_slots_remaining then
    -- A pessoa gastando o próprio slot (generate_invite_code) não é evento de admin.
    if not (v_changes = '{}'::jsonb and auth.uid() = new.id and new.invite_slots_remaining < old.invite_slots_remaining) then
      v_changes := v_changes || jsonb_build_object('invite_slots_remaining', jsonb_build_object('before', old.invite_slots_remaining, 'after', new.invite_slots_remaining));
    end if;
  end if;
  if v_changes = '{}'::jsonb then
    return new;
  end if;
  insert into public.audit_log (actor_id, actor_label, action, target_type, target_id, details, success)
  values (auth.uid(), coalesce(auth.role(), current_user), 'profile_privilege_change', 'user', new.id::text, v_changes, true);
  return new;
end;
$fn$;

revoke execute on function private.audit_profile_privilege_change() from public;

drop trigger if exists audit_profile_privilege_change on public.profiles;
create trigger audit_profile_privilege_change
  after update of role, is_active, invite_slots_remaining on public.profiles
  for each row execute function private.audit_profile_privilege_change();

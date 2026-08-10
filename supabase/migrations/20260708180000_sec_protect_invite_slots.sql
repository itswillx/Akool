-- SEC (achado extra, aplicado em 2026-07-09 via MCP): prevent_profile_privilege_escalation
-- congelava apenas role/is_active. invite_slots_remaining tambem e' privilegio:
-- sem isso, um usuario comum pode se conceder slots de convite ilimitados via
-- UPDATE na propria linha (profiles_update_own permite). Confirmado aplicado no
-- remoto (SEC-001, 2026-08-10): ledger tem sec_protect_invite_slots em
-- 20260709184028 e o corpo da funcao ao vivo ja inclui o congelamento de
-- invite_slots_remaining.

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if auth.uid() is not null
     and new.id = auth.uid()
     and not public.is_admin()
  then
    new.role := old.role;
    new.is_active := old.is_active;
    new.invite_slots_remaining := old.invite_slots_remaining;
  end if;
  return new;
end;
$function$;

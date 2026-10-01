-- SEC-006: revogar sessões de verdade.
--
-- A admin-ops chama admin_revoke_user_sessions com o client service_role, em
-- que auth.uid() é nulo e is_admin() é falso: a função lançava "Forbidden", o
-- erro sumia no console e a UI e o audit_log registravam sucesso. As sessões
-- nunca caíam ao banir ou rebaixar alguém. Agora a função aceita service_role
-- (a edge já validou que quem chama é admin) ou um admin logado.

create or replace function public.admin_revoke_user_sessions(target_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'Forbidden: admin only' using errcode = '42501';
  end if;

  delete from auth.sessions where user_id = target_id;
end;
$$;

-- is_active só muda pela admin-ops (ban/unban, com service_role). O gatilho
-- prevent_profile_privilege_escalation já desfazia a auto-edição; sem o
-- privilégio de coluna, ninguém grava pela REST (o app só lê is_active).
revoke update (is_active) on public.profiles from authenticated, anon;

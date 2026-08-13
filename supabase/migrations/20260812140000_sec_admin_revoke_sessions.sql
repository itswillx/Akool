-- Lets an admin force-expire a user's active sessions (auth.sessions rows,
-- cascading to auth.refresh_tokens), so a ban takes effect immediately on
-- the next refresh instead of waiting for the current session to expire.
-- The still-valid access token (JWT) already held by the client keeps
-- working until its own exp — this only blocks re-authentication.
create or replace function public.admin_revoke_user_sessions(target_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: admin only';
  end if;

  delete from auth.sessions where user_id = target_id;
end;
$$;

-- Convenção de 20260708110000_sec_rpc_grants.sql: RPC SECURITY DEFINER nasce
-- sem EXECUTE para anon/public; só authenticated chama (a checagem de admin é
-- interna). service_role mantém EXECUTE — é por ele que o edge function chama.
revoke execute on function public.admin_revoke_user_sessions(uuid) from anon, public;
grant execute on function public.admin_revoke_user_sessions(uuid) to authenticated;

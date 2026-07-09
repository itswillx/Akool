-- SEC (P0/P1): travar EXECUTE de RPCs SECURITY DEFINER expostos via /rest/v1/rpc.
-- _notify era executavel por anon+authenticated => qualquer um podia forjar
-- notificacoes para qualquer usuario. Demais RPCs de workspace/board nao tem
-- motivo para serem chamados por anon.

-- _notify e' interna (chamada por outras funcoes SECURITY DEFINER como owner)
revoke execute on function public._notify(uuid, text, text, text, jsonb) from anon, authenticated, public;

-- RPCs que exigem usuario logado: remover anon (mantem authenticated)
revoke execute on function public.accept_workspace_invite(uuid) from anon, public;
revoke execute on function public.decline_workspace_invite(uuid) from anon, public;
revoke execute on function public.create_workspace(text) from anon, public;
revoke execute on function public.invite_member(uuid, text) from anon, public;
revoke execute on function public.leave_workspace() from anon, public;
revoke execute on function public.remove_workspace_member(uuid) from anon, public;
revoke execute on function public.bootstrap_workspace_categories(uuid) from anon, public;
revoke execute on function public.is_workspace_member(uuid) from anon, public;
revoke execute on function public.check_auto_site_backup_due() from anon, public;
revoke execute on function public.bootstrap_finance_categories(uuid) from anon, public;
revoke execute on function public.create_project_board(text, text, text, text) from anon, public;
revoke execute on function public.current_user_can_share_page(uuid) from anon, public;
revoke execute on function public.generate_invite_code() from anon, public;
revoke execute on function public.admin_add_invite_slots(uuid, integer) from anon, public;
revoke execute on function public.admin_revoke_invite_code(uuid) from anon, public;
revoke execute on function public.set_ai_credentials(text, text) from anon, public;
revoke execute on function public.page_is_readable(uuid) from anon, public;
revoke execute on function public.page_is_writable(uuid) from anon, public;
revoke execute on function public.user_can_access_board(uuid, text) from anon, public;

-- Garantir grants explicitos para authenticated (RLS policies tambem os usam)
grant execute on function public.accept_workspace_invite(uuid) to authenticated;
grant execute on function public.decline_workspace_invite(uuid) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.invite_member(uuid, text) to authenticated;
grant execute on function public.leave_workspace() to authenticated;
grant execute on function public.remove_workspace_member(uuid) to authenticated;
grant execute on function public.bootstrap_workspace_categories(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.check_auto_site_backup_due() to authenticated;
grant execute on function public.bootstrap_finance_categories(uuid) to authenticated;
grant execute on function public.create_project_board(text, text, text, text) to authenticated;
grant execute on function public.current_user_can_share_page(uuid) to authenticated;
grant execute on function public.generate_invite_code() to authenticated;
grant execute on function public.admin_add_invite_slots(uuid, integer) to authenticated;
grant execute on function public.admin_revoke_invite_code(uuid) to authenticated;
grant execute on function public.set_ai_credentials(text, text) to authenticated;
grant execute on function public.page_is_readable(uuid) to authenticated;
grant execute on function public.page_is_writable(uuid) to authenticated;
grant execute on function public.user_can_access_board(uuid, text) to authenticated;

-- validate_invite_code continua acessivel a anon (usado no signup).

-- Preventivo: novas funcoes nascem sem EXECUTE para os roles da API;
-- grants passam a ser explicitos por funcao.
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

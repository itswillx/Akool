-- SEC: fechar grants residuais das funcoes criadas nas migrations de hardening.
-- (ALTER DEFAULT PRIVILEGES nao cobriu as funcoes criadas nas migrations
-- seguintes da mesma leva; revogacao explicita.)

-- Funcoes de trigger nao precisam de EXECUTE via API para nenhum role.
revoke all on function public.finance_guard_workspace() from anon, authenticated, public;
revoke all on function public.finance_guard_invite_update() from anon, authenticated, public;

-- Helpers de profiles: apenas authenticated.
revoke execute on function public.profile_is_related(uuid) from anon, public;
revoke execute on function public.search_users_for_share(text) from anon, public;
grant execute on function public.profile_is_related(uuid) to authenticated;
grant execute on function public.search_users_for_share(text) to authenticated;

-- set_ai_credentials recriada hoje: garantir que anon nao executa.
revoke execute on function public.set_ai_credentials(text, text) from anon, public;

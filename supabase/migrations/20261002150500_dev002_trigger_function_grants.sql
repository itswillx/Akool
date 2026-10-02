-- DEV-002: em produção, as funções de gatilho abaixo só podem ser executadas
-- por postgres e service_role (EXECUTE revogado de public, anon e
-- authenticated numa correção que não tinha arquivo no repo). Num banco
-- montado só pelo repositório (staging) elas nasciam executáveis por qualquer
-- papel. Gatilho dispara sem EXECUTE de quem fez o INSERT/UPDATE, então nada
-- muda para o app; chamar a função à mão pela REST é que deixa de ser possível.
-- Em produção é idempotente.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_invite_code_on_signup() from public, anon, authenticated;
revoke execute on function public.prevent_page_ownership_transfer() from public, anon, authenticated;
revoke execute on function public.prevent_profile_privilege_escalation() from public, anon, authenticated;

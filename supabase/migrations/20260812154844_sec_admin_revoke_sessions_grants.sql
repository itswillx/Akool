-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260812154844).
-- SQL idêntico ao aplicado em produção (md5 e5da34218d2f53e2d6db4839df9133d8); não editar.

revoke execute on function public.admin_revoke_user_sessions(uuid) from anon, public;
grant execute on function public.admin_revoke_user_sessions(uuid) to authenticated;

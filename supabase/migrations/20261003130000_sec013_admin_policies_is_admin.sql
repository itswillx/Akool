-- SEC-013 (correção): cinco policies de RLS fora de profiles ainda testavam
-- profiles.role direto, com o privilégio de quem consulta. Desde a etapa B do
-- SEC-013 (20261001221611), authenticated não tem SELECT em profiles.role, e o
-- Postgres checa o privilégio da coluna antes de avaliar a policy: toda leitura
-- de audit_log, invite_codes, site_backups e site_backup_settings, e o DELETE
-- de convites pelo admin, falhava com "permission denied for table profiles"
-- para qualquer usuário, admin inclusive (abas Auditoria e Convites).
--
-- As policies passam a usar public.is_admin() (SECURITY DEFINER, o mesmo
-- helper das policies de profiles), entre parênteses com select para o
-- Postgres avaliar uma vez por consulta. As de invite_codes deixam de valer
-- para anon: sem sessão nenhum dos dois ramos se aplica, e anon não tem
-- EXECUTE em is_admin() (receberia erro em vez de zero linhas).
--
-- Dry run na produção (desfeito), como authenticated com id falso e sem ler
-- linhas: antes, as 5 consultas negadas; depois, as 5 passam; anon recebe
-- zero linhas sem erro.
alter policy "Admins can read audit_log" on public.audit_log
  using ((select public.is_admin()));
alter policy "Admins can read site_backups" on public.site_backups
  using ((select public.is_admin()));
alter policy "Admins can read site_backup_settings" on public.site_backup_settings
  using ((select public.is_admin()));
alter policy invite_codes_select on public.invite_codes to authenticated
  using ((created_by = (select auth.uid())) or (select public.is_admin()));
alter policy invite_codes_delete_admin on public.invite_codes to authenticated
  using ((select public.is_admin()) and ((used_at is not null) or (expires_at < now())));

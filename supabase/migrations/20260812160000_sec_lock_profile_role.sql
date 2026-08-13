-- SEC-007: profiles.role só muda pela edge function admin-ops.
--
-- Até aqui a policy `profiles_update_admin` (using/with check is_admin()) somada
-- ao column grant `update (role)` para `authenticated` deixavam qualquer admin
-- promover ou rebaixar alguém direto do console do navegador — sem guarda de
-- último admin, sem revogação de sessão do alvo e sem rastro em audit_log.
-- Tirar o `.update({ role })` de UserManagementPanel.tsx fecha o caminho pela UI;
-- este revoke fecha o caminho de verdade.
--
-- O que continua funcionando:
--   * a edge admin-ops usa SUPABASE_SERVICE_ROLE_KEY — grant separado, intacto;
--   * `handle_new_user()` insere role='standard' no cadastro e é SECURITY DEFINER;
--   * `restore_site_backup()` também é SECURITY DEFINER;
--   * a policy `profiles_update_admin` fica como está — o admin ainda precisa
--     dela para as demais colunas (is_active, invite_slots_remaining, ...).
--
-- Idempotente: revogar um privilégio ausente não é erro no Postgres.

revoke update (role) on public.profiles from authenticated;

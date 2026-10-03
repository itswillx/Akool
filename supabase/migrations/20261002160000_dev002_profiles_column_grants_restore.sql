-- DEV-002 (correção): a migration 20261002150000 revoga SELECT/UPDATE *na tabela*
-- profiles para authenticated, e no Postgres revogar um privilégio na tabela
-- também revoga o mesmo privilégio em todas as colunas. Como profiles vive só
-- de grants POR COLUNA (baseline, avatar, finance_dashboard_view, onboarding,
-- menos as colunas sensíveis revogadas pelo SEC-013 e seguintes), produção e
-- staging ficaram sem leitura nem escrita de perfis pela REST: 42501 em
-- quadros, financeiro, convites, grafo de documentos, login (last_login_date)
-- e configurações. O relacl da tabela não mudou, e por isso o dry run e o
-- retrato (que não cobria attacl) não acusaram nada.
--
-- Recria exatamente o que as migrations anteriores declaram para authenticated:
--   SELECT: baseline + avatar + finance_dashboard_view + onboarding
--           − role, is_active, last_login_date, invite_slots_remaining, ai_has_key (SEC-013 B)
--   UPDATE: baseline + avatar + finance_dashboard_view + onboarding
--           − role (sec_lock_profile_role) − is_active (SEC-006) − invite_slots_remaining (SEC-018)
-- anon fica sem nada, como a 150000 pretendia: a policy de SELECT é só para
-- authenticated e o app não lê profiles sem sessão. A 150000 não é editada
-- porque já está no ledger dos dois projetos; num banco novo a sequência
-- 150000 → 160000 chega ao mesmo estado. GRANT é idempotente.
grant select (avatar_color, avatar_emoji, avatar_url, created_at, display_name, email,
              finance_dashboard_view, id, language, onboarding, theme)
  on public.profiles to authenticated;
grant update (ai_has_key, avatar_color, avatar_emoji, avatar_url, display_name,
              finance_dashboard_view, language, last_login_date, onboarding, theme)
  on public.profiles to authenticated;

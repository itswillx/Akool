-- Preferencia de exibicao do dashboard de financas (aba Resumo):
--   'detailed' — visao apresentacional completa (patrimonio, previstas,
--                analise de gastos, grafico anual, cartoes...) — padrao;
--   'simple'   — visao operacional original (cards + atalhos + proximas contas).
-- Vive em profiles (nao em localStorage) para seguir o usuario entre
-- dispositivos, como theme/language.
--
-- IMPORTANTE: profiles usa grants POR COLUNA (nao ha grant de tabela para
-- authenticated). Coluna nova sem GRANT SELECT/UPDATE quebra o loadProfile
-- inteiro com 42501 para todo usuario (licao de 20260727170000). Os grants
-- vivem NESTA mesma migracao de proposito.
--
-- A policy profiles_update_own (id = auth.uid()) e o trigger
-- enforce_profile_privilege_bounds ja cobrem a coluna nova sem alteracao.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS finance_dashboard_view text NOT NULL DEFAULT 'detailed'
  CONSTRAINT profiles_finance_dashboard_view_check
    CHECK (finance_dashboard_view IN ('simple', 'detailed'));

GRANT SELECT (finance_dashboard_view) ON public.profiles TO authenticated;
GRANT UPDATE (finance_dashboard_view) ON public.profiles TO authenticated;

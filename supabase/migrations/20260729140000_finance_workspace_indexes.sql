-- Indices parciais para as leituras agregadas por workspace (visao Coworkspace
-- do dashboard: familyTransactions/familyBudgets/familyAccounts/familyCategories
-- filtram por workspace_id, que nao tinha indice em nenhuma das 4 tabelas-base).
-- Parciais porque a imensa maioria das linhas e' pessoal (workspace_id NULL).
--
-- ATENCAO: aplicar via MCP/SQL editor, NUNCA `supabase db push` — o push
-- arrastaria 20260630130000_finance_amounts_to_cents.sql, que nao esta aplicada
-- no remoto e multiplicaria os valores por 100.

create index if not exists idx_finance_transactions_workspace
  on public.finance_transactions (workspace_id) where workspace_id is not null;

create index if not exists idx_finance_budgets_workspace
  on public.finance_budgets (workspace_id) where workspace_id is not null;

create index if not exists idx_finance_accounts_workspace
  on public.finance_accounts (workspace_id) where workspace_id is not null;

create index if not exists idx_finance_categories_workspace
  on public.finance_categories (workspace_id) where workspace_id is not null;

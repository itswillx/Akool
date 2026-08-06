-- Funil de compra da Loja. Uma purchase deixa de ser sempre "ja aconteceu" e
-- passa a ter fase: quoting -> purchased -> received.
--
-- Por que uma coluna e nao uma derivacao: nao existe dado que separe "cotando"
-- de "comprado". Uma purchase so nascia quando a compra ja tinha acontecido
-- (tem date, unit_cost e as vezes transaction_id). O unico eixo derivavel seria
-- transaction_id IS NOT NULL, que da dois estados falsos e nenhum "cotando".
--
-- Linhas existentes nascem 'received': elas ja contam no estoque derivado
-- (src/lib/financeStoreCalc.ts -> productStock) e no custo medio. Qualquer
-- outro default reescreveria o saldo historico de estoque.
--
-- RLS: nada a fazer. As policies de finance_store_purchases
-- (20260728120000_finance_store_module.sql) sao por LINHA
-- (user_id = auth.uid() OR is_workspace_member(workspace_id)), nao por coluna,
-- entao a coluna nova ja entra nas quatro.
--
-- Trigger: nada a fazer. trg_finance_store_purchases_ws_guard ->
-- public.finance_guard_workspace() valida workspace_id independentemente das
-- demais colunas.
--
-- Dinheiro: a coluna e text. Nenhum numeric, nenhum x100.
-- Rollback: ALTER TABLE finance_store_purchases DROP COLUMN status;

ALTER TABLE public.finance_store_purchases
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('quoting', 'purchased', 'received'));

COMMENT ON COLUMN public.finance_store_purchases.status IS
  'Funil da compra. quoting = intencao (NAO conta estoque nem custo medio); purchased = pago, a caminho; received = na prateleira. Default received preserva o comportamento das linhas anteriores a esta coluna.';

CREATE INDEX IF NOT EXISTS finance_store_purchases_status_idx
  ON public.finance_store_purchases (status);

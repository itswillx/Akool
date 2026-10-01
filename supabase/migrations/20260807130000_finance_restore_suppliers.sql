-- Restaura `finance_suppliers`, dropada por engano em
-- 20260807120000_finance_drop_works_investments.
--
-- A tabela nasceu com Obras, mas NÃO era só de Obras: a Loja usa as mesmas
-- linhas em `finance_store_purchases.supplier_id` e as cria pelo
-- `createSupplier` do `useFinanceStore`. Nenhuma compra apontava para um
-- fornecedor na hora do DROP, então o CASCADE só levou a FK — nenhum dado da
-- Loja se perdeu, e as 3 linhas voltaram do backup (dados reais, guardado
-- fora do repositório desde 26/09/2026 — SEC-008).
--
-- Estrutura, RLS e trigger idênticos ao original em
-- 20260727120000_finance_projects_module.sql.

CREATE TABLE IF NOT EXISTS finance_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_suppliers_select ON public.finance_suppliers;
DROP POLICY IF EXISTS finance_suppliers_insert ON public.finance_suppliers;
DROP POLICY IF EXISTS finance_suppliers_update ON public.finance_suppliers;
DROP POLICY IF EXISTS finance_suppliers_delete ON public.finance_suppliers;

CREATE POLICY finance_suppliers_select ON public.finance_suppliers FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

-- INSERT so em nome proprio; o trigger abaixo valida o workspace de destino.
CREATE POLICY finance_suppliers_insert ON public.finance_suppliers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY finance_suppliers_update ON public.finance_suppliers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))
  WITH CHECK (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

CREATE POLICY finance_suppliers_delete ON public.finance_suppliers FOR DELETE TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

DROP TRIGGER IF EXISTS trg_finance_suppliers_ws_guard ON public.finance_suppliers;
CREATE TRIGGER trg_finance_suppliers_ws_guard BEFORE INSERT OR UPDATE ON public.finance_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_workspace();

CREATE INDEX IF NOT EXISTS finance_suppliers_user_id_idx
  ON finance_suppliers (user_id, name);

-- A FK da Loja caiu junto com a tabela (DROP ... CASCADE).
ALTER TABLE finance_store_purchases
  DROP CONSTRAINT IF EXISTS finance_store_purchases_supplier_id_fkey;
ALTER TABLE finance_store_purchases
  ADD CONSTRAINT finance_store_purchases_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES finance_suppliers(id) ON DELETE SET NULL;

-- As 3 linhas foram restauradas em produção a partir do backup (dados reais).
-- SEC-008 (26/09/2026): o INSERT com os dados saiu do repositório; a cópia
-- original desta migration fica com o dono do projeto, fora do repo. Num banco
-- novo a tabela nasce vazia, como deve ser fora de produção.

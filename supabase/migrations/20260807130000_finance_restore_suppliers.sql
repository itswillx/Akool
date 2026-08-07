-- Restaura `finance_suppliers`, dropada por engano em
-- 20260807120000_finance_drop_works_investments.
--
-- A tabela nasceu com Obras, mas NÃO era só de Obras: a Loja usa as mesmas
-- linhas em `finance_store_purchases.supplier_id` e as cria pelo
-- `createSupplier` do `useFinanceStore`. Nenhuma compra apontava para um
-- fornecedor na hora do DROP, então o CASCADE só levou a FK — nenhum dado da
-- Loja se perdeu, e as 3 linhas voltam do backup em
-- `supabase/backups/20260807_obras_investimentos.json`.
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

-- Linhas do backup. O trigger fica de fora porque `auth.uid()` é nulo aqui.
ALTER TABLE finance_suppliers DISABLE TRIGGER trg_finance_suppliers_ws_guard;

INSERT INTO finance_suppliers (id, user_id, workspace_id, name, phone, website, notes, created_at, updated_at)
VALUES
  ('bf632e33-49fc-4ee5-8b84-75a3c61700aa', '95b82987-b479-424d-85b2-89900bfd76e7', '04478694-e6ca-4e3e-960c-acce0bcc42f3',
   'Super Lajes', '', '', '', '2026-07-27T19:30:22.103103+00', '2026-07-27T19:30:22.103103+00'),
  ('4ba25ce9-2879-4bee-a484-89626df74cf1', '95b82987-b479-424d-85b2-89900bfd76e7', '04478694-e6ca-4e3e-960c-acce0bcc42f3',
   'Madeireira Rondonia', '', '', '', '2026-08-01T22:04:14.264365+00', '2026-08-01T22:04:25.228+00'),
  ('bb366e1a-8806-43bf-a07f-3983ca5e14b8', '95b82987-b479-424d-85b2-89900bfd76e7', '04478694-e6ca-4e3e-960c-acce0bcc42f3',
   'Deposito Três Estrelas', '', '', 'Deposito Beth', '2026-08-01T22:04:38.991812+00', '2026-08-01T22:05:01.622+00')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE finance_suppliers ENABLE TRIGGER trg_finance_suppliers_ws_guard;

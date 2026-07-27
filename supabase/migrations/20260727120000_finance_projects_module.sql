-- Submodulo de Obras dentro de Financas: controle de gastos de um projeto de
-- construcao/reforma. Seis tabelas, todas prefixadas finance_* para deixar
-- explicito que NAO tem relacao com o modulo de projetos do app
-- (project_boards/project_cards, kanban) -- sao entidades financeiras proprias.
--
-- Decisoes de modelagem:
--  * item (o que falta comprar) e expense (o que ja saiu do bolso) sao tabelas
--    SEPARADAS: um item de 60 m2 de porcelanato pode virar duas compras parciais,
--    e muitos gastos nao tem item nenhum (diaria de pedreiro, frete, taxa). O
--    vinculo e' expenses.item_id nullable com ON DELETE SET NULL, para o
--    historico financeiro sobreviver a exclusao do item planejado.
--  * cotacao escolhida vive em items.chosen_quote_id (e nao num is_chosen na
--    cotacao) para nao existirem duas linhas "escolhidas" ao mesmo tempo.
--  * dinheiro em bigint de centavos, como o resto do modulo financeiro
--    (ver 20260630130000_finance_amounts_to_cents.sql). quantity fica em
--    numeric(14,3) porque a invariante de centavos e' sobre ACUMULAR somas: aqui
--    quantity x preco_unitario e' arredondado para centavos numa unica operacao
--    no cliente (src/lib/financeProjectCalc.ts), sem acumulo de drift.
--  * anexos como jsonb '[]' ({id,path,name,mime,size,uploaded_at}) seguindo o
--    padrao de colecao embutida de project_cards.checklist e study_cards.resources,
--    evitando uma setima tabela so para arquivos.
--  * parcelamento e' a coluna installments + cronograma derivado no cliente; o
--    caso complexo (parcela paga/pulada individualmente) ja existe em
--    finance_recurring_entries e nao e' o que a obra precisa.
--
-- RLS: modelo do modulo financeiro (dono + membros do workspace da familia),
-- nao o flat per-user do modulo de estudos -- a obra e' acompanhada em casal.
-- Reusa public.is_workspace_member(uuid) (SECURITY DEFINER, ja existente) e o
-- trigger public.finance_guard_workspace() de
-- 20260708120000_sec_finance_workspace_integrity.sql.

-- ---------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '🏗️',
  color text NOT NULL DEFAULT '#f59e0b',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('planning','active','paused','done','cancelled')),
  -- Teto geral opcional, em centavos. 0 = sem teto definido.
  budget_total bigint NOT NULL DEFAULT 0,
  started_on date,
  target_end_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_project_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES finance_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT '🧱',
  color text NOT NULL DEFAULT '#64748b',
  -- Teto da etapa, em centavos. 0 = etapa sem orcamento definido.
  budget_amount bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fornecedores tem escopo de USUARIO (nao de projeto): e' assim que
-- "quanto ja gastei na Leroy" atravessa varias obras.
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

CREATE TABLE IF NOT EXISTS finance_project_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES finance_projects(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES finance_project_stages(id) ON DELETE SET NULL,
  name text NOT NULL,
  notes text NOT NULL DEFAULT '',
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'un',
  -- Preco unitario ESTIMADO em centavos (o cotado vive em finance_project_quotes).
  estimated_unit_price bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','quoted','purchased','cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high')),
  -- FK adicionada depois da criacao de finance_project_quotes (ciclo).
  chosen_quote_id uuid,
  attachments jsonb NOT NULL DEFAULT '[]',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_project_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES finance_project_items(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES finance_suppliers(id) ON DELETE SET NULL,
  -- Nome livre da loja quando nao vale a pena cadastrar o fornecedor.
  supplier_name text NOT NULL DEFAULT '',
  unit_price bigint NOT NULL DEFAULT 0,
  -- Preco fechado dado pela loja (frete/desconto embutidos). Quando presente,
  -- vence quantity x unit_price no comparador.
  total_price bigint,
  quoted_on date,
  url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance_project_items
  DROP CONSTRAINT IF EXISTS finance_project_items_chosen_quote_id_fkey;
ALTER TABLE finance_project_items
  ADD CONSTRAINT finance_project_items_chosen_quote_id_fkey
  FOREIGN KEY (chosen_quote_id) REFERENCES finance_project_quotes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS finance_project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  project_id uuid NOT NULL REFERENCES finance_projects(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES finance_project_stages(id) ON DELETE SET NULL,
  item_id uuid REFERENCES finance_project_items(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES finance_suppliers(id) ON DELETE SET NULL,
  -- De qual conta saiu (opcional). Nao gera finance_transactions: a obra e'
  -- isolada do fluxo de caixa e so aparece la como total consolidado.
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  description text NOT NULL,
  -- Valor TOTAL pago, em centavos (nao o valor da parcela).
  amount bigint NOT NULL DEFAULT 0,
  date date NOT NULL,
  payment_method text NOT NULL DEFAULT 'pix'
    CHECK (payment_method IN ('cash','pix','debit','credit','boleto','transfer','financing')),
  installments integer NOT NULL DEFAULT 1 CHECK (installments >= 1),
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN finance_project_items.attachments IS
  'Colecao embutida: [{id,path,name,mime,size,uploaded_at}] no bucket privado project-expense-files.';
COMMENT ON COLUMN finance_project_expenses.attachments IS
  'Colecao embutida: [{id,path,name,mime,size,uploaded_at}] no bucket privado project-expense-files.';

-- ---------------------------------------------------------------------------
-- 2) RLS -- dono da linha OU membro do workspace apontado pela propria linha.
-- ---------------------------------------------------------------------------

ALTER TABLE finance_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_project_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_project_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_project_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_project_expenses ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_projects','finance_project_stages','finance_suppliers',
    'finance_project_items','finance_project_quotes','finance_project_expenses'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON public.%1$s', t);

    EXECUTE format(
      'CREATE POLICY %1$s_select ON public.%1$s FOR SELECT TO authenticated
         USING (user_id = auth.uid()
                OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))', t);

    -- INSERT so em nome proprio; o trigger abaixo valida o workspace de destino.
    EXECUTE format(
      'CREATE POLICY %1$s_insert ON public.%1$s FOR INSERT TO authenticated
         WITH CHECK (user_id = auth.uid())', t);

    -- Colaboracao total dentro do workspace (mesmo modelo de finance_transactions).
    EXECUTE format(
      'CREATE POLICY %1$s_update ON public.%1$s FOR UPDATE TO authenticated
         USING (user_id = auth.uid()
                OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))
         WITH CHECK (user_id = auth.uid()
                OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))', t);

    EXECUTE format(
      'CREATE POLICY %1$s_delete ON public.%1$s FOR DELETE TO authenticated
         USING (user_id = auth.uid()
                OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))', t);
  END LOOP;
END $$;

-- Mesmo guard de integridade das demais tabelas financeiras: bloqueia INSERT
-- em workspace do qual nao se e' membro e realocacao de linha por terceiros.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_projects','finance_project_stages','finance_suppliers',
    'finance_project_items','finance_project_quotes','finance_project_expenses'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_ws_guard ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_ws_guard BEFORE INSERT OR UPDATE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.finance_guard_workspace()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Indices
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS finance_projects_user_id_idx
  ON finance_projects (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_projects_workspace_id_idx
  ON finance_projects (workspace_id);

CREATE INDEX IF NOT EXISTS finance_project_stages_project_id_idx
  ON finance_project_stages (project_id, sort_order);
CREATE INDEX IF NOT EXISTS finance_project_stages_user_id_idx
  ON finance_project_stages (user_id);

CREATE INDEX IF NOT EXISTS finance_suppliers_user_id_idx
  ON finance_suppliers (user_id, name);

CREATE INDEX IF NOT EXISTS finance_project_items_project_id_idx
  ON finance_project_items (project_id, sort_order);
CREATE INDEX IF NOT EXISTS finance_project_items_user_id_idx
  ON finance_project_items (user_id);
CREATE INDEX IF NOT EXISTS finance_project_items_stage_id_idx
  ON finance_project_items (stage_id);

CREATE INDEX IF NOT EXISTS finance_project_quotes_item_id_idx
  ON finance_project_quotes (item_id, created_at);
CREATE INDEX IF NOT EXISTS finance_project_quotes_user_id_idx
  ON finance_project_quotes (user_id);
CREATE INDEX IF NOT EXISTS finance_project_quotes_supplier_id_idx
  ON finance_project_quotes (supplier_id);

CREATE INDEX IF NOT EXISTS finance_project_expenses_project_id_idx
  ON finance_project_expenses (project_id, date DESC);
CREATE INDEX IF NOT EXISTS finance_project_expenses_user_id_idx
  ON finance_project_expenses (user_id);
CREATE INDEX IF NOT EXISTS finance_project_expenses_supplier_id_idx
  ON finance_project_expenses (supplier_id);
CREATE INDEX IF NOT EXISTS finance_project_expenses_item_id_idx
  ON finance_project_expenses (item_id);

-- ---------------------------------------------------------------------------
-- 4) Storage: bucket privado para notas fiscais e fotos dos itens.
--    Publico e' vazamento (ver 20260708140000_sec_private_buckets.sql); leitura
--    e escrita apenas do dono, com o uid como primeiro segmento do path.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-expense-files', 'project-expense-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS project_expense_files_owner_read ON storage.objects;
CREATE POLICY project_expense_files_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'project-expense-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS project_expense_files_owner_insert ON storage.objects;
CREATE POLICY project_expense_files_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-expense-files'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS project_expense_files_owner_update ON storage.objects;
CREATE POLICY project_expense_files_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'project-expense-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS project_expense_files_owner_delete ON storage.objects;
CREATE POLICY project_expense_files_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'project-expense-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

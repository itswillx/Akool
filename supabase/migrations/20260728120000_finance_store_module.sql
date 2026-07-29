-- Submodulo Loja dentro de Financas: estoque de revenda (placas de video,
-- processadores, itens avulsos), pipeline de venda e clientes. Cinco tabelas,
-- prefixadas finance_store_*.
--
-- Decisoes de modelagem:
--  * modelo misto unico-vs-quantidade em UMA tabela de produtos
--    (products.kind 'unique'|'stock') com aquisicoes numa tabela separada
--    (purchases). Item unico = produto + 1 purchase de qty 1 criados juntos;
--    reposicao de stock = purchase nova. O estoque disponivel e' DERIVADO no
--    cliente (comprado - vendido - reservado, src/lib/financeStoreCalc.ts) --
--    nao ha coluna quantity_on_hand que possa driftar.
--  * venda com N itens (sales + sale_items) com SNAPSHOT de unit_price,
--    unit_cost_at_sale e product_name no sale_item: o lucro historico nao muda
--    se o produto for editado ou apagado depois.
--  * integracao com o fluxo de caixa pelo lado da Loja: sales.transaction_id e
--    purchases.transaction_id apontam para finance_transactions com ON DELETE
--    SET NULL -- se o usuario apagar a transacao na aba Transacoes, a venda
--    continua integra, apenas deslinkada. Nada muda na tabela core.
--  * canal de venda como CHECK fixo (filtravel e i18n-avel), mesmo padrao de
--    payment_method em finance_project_expenses.
--  * fornecedor da compra reusa finance_suppliers (escopo de usuario, ja
--    atravessa obras; agora tambem a loja).
--  * dinheiro em bigint de centavos, como o resto do modulo financeiro.
--  * anexos como jsonb '[]' ({id,path,name,mime,size,uploaded_at}) no bucket
--    privado store-files, padrao do submodulo de obras.
--
-- RLS: modelo do modulo financeiro (dono + membros do workspace), reusando
-- public.is_workspace_member(uuid) e public.finance_guard_workspace() de
-- 20260708120000_sec_finance_workspace_integrity.sql.

-- ---------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'unique' CHECK (kind IN ('unique','stock')),
  name text NOT NULL,
  -- Categoria livre ('GPU', 'CPU', 'Fonte'...), sugerida por datalist no cliente.
  category text NOT NULL DEFAULT '',
  condition text NOT NULL DEFAULT 'used' CHECK (condition IN ('new','used')),
  -- Relevante para kind='unique'; vazio para produtos de estoque.
  serial_number text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  -- Preco de venda pretendido, em centavos. 0 = indefinido. O custo real vive
  -- nas purchases; o preco fechado vive no sale_item.
  target_price bigint NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_store_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES finance_store_products(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES finance_suppliers(id) ON DELETE SET NULL,
  -- Sempre 1 para kind='unique' (garantido no cliente).
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_cost bigint NOT NULL DEFAULT 0,
  -- Frete/taxas da compra, em centavos, sobre o lote inteiro.
  other_costs bigint NOT NULL DEFAULT 0,
  date date NOT NULL,
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  -- Despesa gerada no fluxo de caixa (opcional).
  transaction_id uuid REFERENCES finance_transactions(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_store_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  name text NOT NULL,
  -- Telefone/WhatsApp livre.
  phone text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'other'
    CHECK (channel IN ('olx','mercado_livre','facebook','whatsapp','referral','in_person','other')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_store_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES finance_store_customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'negotiating'
    CHECK (status IN ('negotiating','sold','shipped','delivered','cancelled')),
  channel text NOT NULL DEFAULT 'other'
    CHECK (channel IN ('olx','mercado_livre','facebook','whatsapp','referral','in_person','other')),
  -- Setada quando o status vira 'sold'; e' a data da transacao de receita.
  sold_on date,
  -- Forma de envio livre ('Correios PAC', 'motoboy', 'retirada'...).
  shipping_method text NOT NULL DEFAULT '',
  tracking_code text NOT NULL DEFAULT '',
  expected_delivery_on date,
  delivered_on date,
  -- Frete cobrado do cliente (entra na receita), em centavos.
  shipping_charged bigint NOT NULL DEFAULT 0,
  -- Frete pago por mim (sai do lucro), em centavos.
  shipping_cost bigint NOT NULL DEFAULT 0,
  -- Taxas do canal (ML etc.), em centavos.
  fees bigint NOT NULL DEFAULT 0,
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  -- Receita gerada no fluxo de caixa (opcional). Sempre 1 transacao por venda,
  -- mesmo com N itens.
  transaction_id uuid REFERENCES finance_transactions(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_store_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  sale_id uuid NOT NULL REFERENCES finance_store_sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES finance_store_products(id) ON DELETE SET NULL,
  -- Snapshot: o historico da venda sobrevive a exclusao do produto.
  product_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  -- Preco unitario negociado, em centavos.
  unit_price bigint NOT NULL DEFAULT 0,
  -- Snapshot do custo medio no momento da venda, em centavos.
  unit_cost_at_sale bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN finance_store_products.attachments IS
  'Colecao embutida: [{id,path,name,mime,size,uploaded_at}] no bucket privado store-files.';
COMMENT ON COLUMN finance_store_purchases.attachments IS
  'Colecao embutida: [{id,path,name,mime,size,uploaded_at}] no bucket privado store-files.';
COMMENT ON COLUMN finance_store_sales.attachments IS
  'Colecao embutida: [{id,path,name,mime,size,uploaded_at}] no bucket privado store-files.';

-- ---------------------------------------------------------------------------
-- 2) RLS -- dono da linha OU membro do workspace apontado pela propria linha.
-- ---------------------------------------------------------------------------

ALTER TABLE finance_store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_store_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_store_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_store_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_store_sale_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_store_products','finance_store_purchases','finance_store_customers',
    'finance_store_sales','finance_store_sale_items'
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

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_store_products','finance_store_purchases','finance_store_customers',
    'finance_store_sales','finance_store_sale_items'
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

CREATE INDEX IF NOT EXISTS finance_store_products_user_id_idx
  ON finance_store_products (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_store_products_workspace_id_idx
  ON finance_store_products (workspace_id);

CREATE INDEX IF NOT EXISTS finance_store_purchases_product_id_idx
  ON finance_store_purchases (product_id, date DESC);
CREATE INDEX IF NOT EXISTS finance_store_purchases_user_id_idx
  ON finance_store_purchases (user_id);
CREATE INDEX IF NOT EXISTS finance_store_purchases_supplier_id_idx
  ON finance_store_purchases (supplier_id);
CREATE INDEX IF NOT EXISTS finance_store_purchases_transaction_id_idx
  ON finance_store_purchases (transaction_id);
CREATE INDEX IF NOT EXISTS finance_store_purchases_workspace_id_idx
  ON finance_store_purchases (workspace_id);

CREATE INDEX IF NOT EXISTS finance_store_customers_user_id_idx
  ON finance_store_customers (user_id, name);
CREATE INDEX IF NOT EXISTS finance_store_customers_workspace_id_idx
  ON finance_store_customers (workspace_id);

CREATE INDEX IF NOT EXISTS finance_store_sales_user_id_idx
  ON finance_store_sales (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_store_sales_customer_id_idx
  ON finance_store_sales (customer_id);
CREATE INDEX IF NOT EXISTS finance_store_sales_status_idx
  ON finance_store_sales (status);
CREATE INDEX IF NOT EXISTS finance_store_sales_transaction_id_idx
  ON finance_store_sales (transaction_id);
CREATE INDEX IF NOT EXISTS finance_store_sales_workspace_id_idx
  ON finance_store_sales (workspace_id);

CREATE INDEX IF NOT EXISTS finance_store_sale_items_sale_id_idx
  ON finance_store_sale_items (sale_id);
CREATE INDEX IF NOT EXISTS finance_store_sale_items_product_id_idx
  ON finance_store_sale_items (product_id);
CREATE INDEX IF NOT EXISTS finance_store_sale_items_user_id_idx
  ON finance_store_sale_items (user_id);
CREATE INDEX IF NOT EXISTS finance_store_sale_items_workspace_id_idx
  ON finance_store_sale_items (workspace_id);

-- ---------------------------------------------------------------------------
-- 4) Storage: bucket privado para fotos dos itens e comprovantes.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('store-files', 'store-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS store_files_owner_read ON storage.objects;
CREATE POLICY store_files_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'store-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS store_files_owner_insert ON storage.objects;
CREATE POLICY store_files_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'store-files'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS store_files_owner_update ON storage.objects;
CREATE POLICY store_files_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'store-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS store_files_owner_delete ON storage.objects;
CREATE POLICY store_files_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'store-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

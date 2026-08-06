-- Submodulo Investimentos dentro de Financas: para onde vai o dinheiro que sai
-- da conta corrente e nao e' despesa. Duas tabelas, prefixadas
-- finance_investments / finance_investment_movements, mais uma coluna de
-- vinculo em finance_project_expenses.
--
-- O problema que isto resolve: ate aqui um aporte detectado no extrato era
-- apenas DESMARCADO no preview do import (src/lib/statementImport.ts), para nao
-- inflar receita/despesa do mes. O efeito colateral e' que o dinheiro sumia: o
-- saldo da conta calculado pelo app (initial_balance + receitas - despesas)
-- ficava maior que o do banco, e o "Patrimonio" ignorava tudo que estava
-- aplicado.
--
-- Decisoes de modelagem:
--  * a posicao aplicada e' DERIVADA dos movimentos, nunca armazenada -- mesma
--    disciplina do estoque da Loja (src/lib/financeInvestmentCalc.ts). Nao ha
--    coluna de saldo que possa driftar; apagar ou reimportar um movimento
--    restaura o numero sozinho.
--  * opening_balance e' uma CONSTANTE editavel, como
--    finance_accounts.initial_balance, para quem ja tinha saldo aplicado antes
--    do primeiro extrato importado. Nao e' cache.
--  * amount sempre > 0; o `kind` carrega o sinal, mesma convencao de ParsedTx
--    em src/lib/statementImport.ts.
--  * settles_in_account distingue o dinheiro que ATRAVESSOU a conta corrente do
--    que ficou dentro do produto. Um extrato de conta corrente so mostra o
--    primeiro, entao toda linha importada nasce true -- a capitalizacao interna
--    do CDB nao aparece nele. Por isso o "aplicado" aqui e' custo liquido /
--    principal, e nao valor de mercado; a coluna existe para nao fechar a porta
--    de um lancamento manual futuro.
--  * import_key da idempotencia REAL na reimportacao (unique parcial abaixo),
--    algo que finance_transactions nao tem -- la a deduplicacao e' heuristica
--    por falta de coluna FITID.
--  * dinheiro em bigint de centavos. As tabelas antigas ainda sao
--    numeric(15,2) gravando inteiros porque 20260630130000 foi neutralizada;
--    as novas nao herdam essa divida.
--
-- RLS: modelo do modulo financeiro (dono + membros do workspace), reusando
-- public.is_workspace_member(uuid) e public.finance_guard_workspace() de
-- 20260708120000_sec_finance_workspace_integrity.sql.

-- ---------------------------------------------------------------------------
-- 1) Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  -- 'C6', 'XP', 'NUINVEST'... Vazio quando o extrato nao nomeia a casa.
  institution text NOT NULL DEFAULT '',
  -- 'CDB', 'TESOURO SELIC', 'B3'...
  product text NOT NULL,
  asset_class text NOT NULL DEFAULT 'other' CHECK (asset_class IN (
    'fixed_income','treasury','savings','fund','equity','pension','crypto','other'
  )),
  -- Identidade estavel vinda do classificador ('c6|cdb'). Derivada so de
  -- tokens -- nunca de valor, data ou contraparte numerica -- para que o mesmo
  -- produto case mes apos mes.
  match_key text NOT NULL,
  -- Conta corrente de origem/destino padrao. O vinculo que conta para saldo
  -- vive em cada movimento.
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  -- Saldo anterior ao primeiro movimento importado, em centavos.
  opening_balance bigint NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_investment_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  investment_id uuid NOT NULL REFERENCES finance_investments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('contribution','redemption','yield','tax','fee')),
  -- true = o dinheiro atravessou a conta corrente; false = interno ao produto.
  settles_in_account boolean NOT NULL DEFAULT true,
  date date NOT NULL,
  -- Sempre positivo, em centavos: o `kind` carrega o sinal.
  amount bigint NOT NULL CHECK (amount > 0),
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  -- Linha crua do extrato, para auditoria.
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'import' CHECK (source IN ('import','manual')),
  -- Chave de idempotencia do import; vazia em lancamento manual.
  import_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Vinculo do gasto de obra com o fluxo de caixa, fechando a assimetria com a
-- Loja (que ja aponta para finance_transactions desde 20260728120000). Ate aqui
-- a obra era isolada: o gasto nunca virava transacao, mas o dinheiro aparecia
-- no extrato do banco -- e o mesmo dinheiro era descrito em dois lugares sem
-- nenhuma marcacao. Com o vinculo, o card da obra consegue dizer quanto do seu
-- total ja esta no fluxo de caixa. account_id vira legado: quem move saldo e' a
-- transacao.
ALTER TABLE finance_project_expenses
  ADD COLUMN IF NOT EXISTS transaction_id uuid
    REFERENCES finance_transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN finance_investments.opening_balance IS
  'Constante editavel em centavos: saldo aplicado antes do primeiro movimento importado. Nao e'' cache -- a posicao continua derivada.';
COMMENT ON COLUMN finance_investment_movements.settles_in_account IS
  'true = atravessou a conta corrente (unico caso que o extrato enxerga); false = capitalizacao/taxa interna ao produto.';
COMMENT ON COLUMN finance_investment_movements.import_key IS
  'date|kind|amount|descricao normalizada. Idempotencia real da reimportacao, via unique parcial.';
COMMENT ON COLUMN finance_project_expenses.transaction_id IS
  'Lancamento correspondente em finance_transactions. NULL = gasto registrado, ainda fora do fluxo de caixa.';

-- ---------------------------------------------------------------------------
-- 2) RLS -- dono da linha OU membro do workspace apontado pela propria linha.
-- ---------------------------------------------------------------------------

ALTER TABLE finance_investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_investment_movements ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_investments','finance_investment_movements'] LOOP
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
  FOREACH t IN ARRAY ARRAY['finance_investments','finance_investment_movements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_ws_guard ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_ws_guard BEFORE INSERT OR UPDATE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.finance_guard_workspace()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Indices
-- ---------------------------------------------------------------------------

-- Uma posicao por produto e por escopo. Duas parciais em vez de uma unica
-- constraint: no escopo pessoal a identidade e' do dono, no workspace e' do
-- workspace -- senao dois membros criariam posicoes duplicadas do mesmo CDB.
CREATE UNIQUE INDEX IF NOT EXISTS finance_investments_match_personal_uniq
  ON finance_investments (user_id, match_key) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_investments_match_ws_uniq
  ON finance_investments (workspace_id, match_key) WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_investments_user_id_idx
  ON finance_investments (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_investments_workspace_id_idx
  ON finance_investments (workspace_id);
CREATE INDEX IF NOT EXISTS finance_investments_account_id_idx
  ON finance_investments (account_id);

-- Reimportar o mesmo periodo vira no-op de verdade (upsert ignoreDuplicates),
-- em vez da deduplicacao heuristica que finance_transactions e' obrigada a usar.
CREATE UNIQUE INDEX IF NOT EXISTS finance_investment_movements_import_uniq
  ON finance_investment_movements (investment_id, import_key) WHERE import_key <> '';

CREATE INDEX IF NOT EXISTS finance_investment_movements_investment_id_idx
  ON finance_investment_movements (investment_id, date DESC);
CREATE INDEX IF NOT EXISTS finance_investment_movements_user_id_idx
  ON finance_investment_movements (user_id, date DESC);
CREATE INDEX IF NOT EXISTS finance_investment_movements_workspace_id_idx
  ON finance_investment_movements (workspace_id);
CREATE INDEX IF NOT EXISTS finance_investment_movements_account_id_idx
  ON finance_investment_movements (account_id, date);

CREATE INDEX IF NOT EXISTS finance_project_expenses_transaction_id_idx
  ON finance_project_expenses (transaction_id);

-- Extratos bancarios importados (modulo de importacao OFX / PDF do C6).
--
-- ATENCAO — migracao reconstruida a partir do schema remoto em 2026-07-29.
-- Ela ja estava APLICADA no projeto remoto (ledger: versao 20260710005226,
-- nome "finance_statements") mas nunca teve arquivo no repositorio. O corpo
-- abaixo foi extraido do proprio banco (pg_catalog) e escrito de forma
-- idempotente, entao reaplica-la e' um no-op seguro. Ver ./README.md.
--
-- Guarda o METADADO do arquivo importado (nome, caminho no bucket privado
-- bank-statements, periodo, quantidade de lancamentos). As transacoes em si
-- vao para finance_transactions; esta tabela existe para rastrear o que ja foi
-- importado e permitir desfazer/reimportar. `active` permite "desativar" um
-- extrato sem perder o historico.

CREATE TABLE IF NOT EXISTS public.finance_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- workspace_id nulo = extrato pessoal; preenchido = compartilhado no workspace.
  workspace_id uuid REFERENCES public.finance_workspaces(id) ON DELETE SET NULL,
  bank text NOT NULL DEFAULT 'c6',
  file_name text NOT NULL,
  file_path text NOT NULL,
  -- SET NULL: apagar a conta nao apaga o historico de importacao.
  account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
  period_start date,
  period_end date,
  tx_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_statements_user_id_idx
  ON public.finance_statements (user_id);

ALTER TABLE public.finance_statements ENABLE ROW LEVEL SECURITY;

-- Somente o dono le/escreve. Extrato bancario e' PII: nao ha leitura por
-- membro de workspace, mesmo quando workspace_id esta preenchido.
DROP POLICY IF EXISTS finance_statements_owner_all ON public.finance_statements;
CREATE POLICY finance_statements_owner_all ON public.finance_statements
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- finance_transactions.statement_id -> finance_statements(id). Adicionado aqui
-- (nao no baseline 20260509000000_baseline_remote_schema.sql) porque esta
-- tabela so existe a partir deste arquivo: um FK inline no baseline quebraria
-- o replay local (dependencia para frente entre migrations). Ver
-- 20260509000000_baseline_remote_schema.sql para o contexto completo.
ALTER TABLE public.finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_statement_id_fkey;
ALTER TABLE public.finance_transactions
  ADD CONSTRAINT finance_transactions_statement_id_fkey
  FOREIGN KEY (statement_id) REFERENCES public.finance_statements(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Bucket dos arquivos de extrato. PRIVADO desde a origem (nunca foi public):
-- extrato bancario e' o dado mais sensivel do app. A leitura sai por signed URL
-- (src/lib/storageUrl.ts). O path e' "<uid>/<arquivo>", e as policies abaixo
-- amarram o primeiro segmento ao auth.uid() — por isso nao ha leitura
-- compartilhada aqui, diferente de note-images/project-card-images.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
  VALUES ('bank-statements', 'bank-statements', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS owner_read_bank_statements ON storage.objects;
CREATE POLICY owner_read_bank_statements ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'bank-statements' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS owner_upload_bank_statements ON storage.objects;
CREATE POLICY owner_upload_bank_statements ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bank-statements' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS owner_delete_bank_statements ON storage.objects;
CREATE POLICY owner_delete_bank_statements ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'bank-statements' AND (storage.foldername(name))[1] = auth.uid()::text);

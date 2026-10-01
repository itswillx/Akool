-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260822171324).
-- SQL idêntico ao aplicado em produção (md5 1ff1da066f44b81f174787bc7163731d); não editar.

-- Submodulo Emprestimos dentro de Financas: dinheiro emprestado a terceiros,
-- com garantia e historico de pagamento. Quatro tabelas, finance_loan*.
-- Ver supabase/migrations/20260822120000_finance_loans_module.sql para o
-- cabecalho completo com as decisoes de modelagem.

CREATE TABLE IF NOT EXISTS finance_loan_borrowers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  document text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  borrower_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN finance_loan_borrowers.user_id IS 'O CREDOR. O devedor, quando tem conta, fica em borrower_user_id.';
COMMENT ON COLUMN finance_loan_borrowers.borrower_user_id IS 'Conta real do devedor. Escrito somente por loan_link_borrower().';

CREATE UNIQUE INDEX IF NOT EXISTS finance_loan_borrowers_link_uniq
  ON finance_loan_borrowers (user_id, borrower_user_id)
  WHERE borrower_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  borrower_id uuid NOT NULL REFERENCES finance_loan_borrowers(id) ON DELETE CASCADE,
  principal bigint NOT NULL CHECK (principal > 0),
  monthly_rate_bp integer NOT NULL DEFAULT 1500 CHECK (monthly_rate_bp BETWEEN 0 AND 10000),
  disbursed_on date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','active','paid','defaulted','rejected','cancelled')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at timestamptz,
  settled_on date,
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES finance_transactions(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_loans_due_after_disbursed
    CHECK (due_date IS NULL OR due_date >= disbursed_on)
);

COMMENT ON COLUMN finance_loans.user_id IS 'SEMPRE o credor, mesmo quando quem pediu foi o devedor (requested_by).';
COMMENT ON COLUMN finance_loans.monthly_rate_bp IS 'Basis points ao mes: 1500 = 15%. Juros SIMPLES sobre o principal em aberto.';
COMMENT ON COLUMN finance_loans.disbursed_on IS 't0 dos juros e ancora dos aniversarios mensais.';
COMMENT ON COLUMN finance_loans.due_date IS 'NULL = emprestimo aberto, que nunca atrasa sozinho.';

CREATE TABLE IF NOT EXISTS finance_loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  loan_id uuid NOT NULL REFERENCES finance_loans(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  method text NOT NULL DEFAULT 'other'
    CHECK (method IN ('pix','cash','transfer','card','other')),
  note text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending','confirmed','rejected')),
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  account_id uuid REFERENCES finance_accounts(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES finance_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN finance_loan_payments.user_id IS 'O credor (dono da linha), nao necessariamente quem reportou.';
COMMENT ON COLUMN finance_loan_payments.status IS 'Somente confirmed entra no saldo. pending e reporte do devedor a espera.';
COMMENT ON COLUMN finance_loan_payments.reported_by IS 'Quem digitou: credor (lancamento direto) ou devedor (reporte pendente).';

CREATE TABLE IF NOT EXISTS finance_loan_collaterals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES finance_workspaces(id) ON DELETE SET NULL,
  loan_id uuid NOT NULL REFERENCES finance_loans(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('vehicle','electronics','jewelry','document','property','tool','other')),
  description text NOT NULL,
  estimated_value bigint NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('promised','held','returned','seized','sold')),
  received_on date,
  released_on date,
  notes text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN finance_loan_collaterals.estimated_value IS 'Valor estimado do item em centavos. NAO entra em nenhum saldo.';
COMMENT ON COLUMN finance_loan_collaterals.attachments IS 'Fotos do item, no bucket privado loan-files.';

-- Helpers de visibilidade. REGRA ANTI-RECURSAO: loan_is_visible/loan_is_owner
-- NUNCA aparecem nas policies da propria finance_loans -- la o predicado vai
-- inline. Licao de 20260708170000_sec_fix_is_admin_recursion.sql.

CREATE OR REPLACE FUNCTION public.loan_is_visible(p_loan_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM finance_loans l
    JOIN finance_loan_borrowers b ON b.id = l.borrower_id
    WHERE l.id = p_loan_id
      AND (l.user_id = auth.uid()
           OR b.borrower_user_id = auth.uid()
           OR (l.workspace_id IS NOT NULL AND is_workspace_member(l.workspace_id)))
  );
$$;

CREATE OR REPLACE FUNCTION public.loan_is_owner(p_loan_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM finance_loans l
    WHERE l.id = p_loan_id
      AND (l.user_id = auth.uid()
           OR (l.workspace_id IS NOT NULL AND is_workspace_member(l.workspace_id)))
  );
$$;

CREATE OR REPLACE FUNCTION public.loan_file_is_readable(p_owner uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public' AS $$
  SELECT p_owner IS NOT NULL AND (
       EXISTS (SELECT 1 FROM finance_loans l
               WHERE l.id = p_owner AND public.loan_is_visible(l.id))
    OR EXISTS (SELECT 1 FROM finance_loan_payments p
               WHERE p.id = p_owner AND public.loan_is_visible(p.loan_id))
    OR EXISTS (SELECT 1 FROM finance_loan_collaterals c
               WHERE c.id = p_owner AND public.loan_is_visible(c.loan_id))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.loan_is_visible(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_is_owner(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_file_is_readable(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.loan_is_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_is_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_file_is_readable(uuid) TO authenticated;

-- RLS. NAO usar FORCE ROW LEVEL SECURITY: e' a nao-aplicacao de RLS para o dono
-- da tabela que faz os helpers SECURITY DEFINER funcionarem.

ALTER TABLE finance_loan_borrowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_loan_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_loan_collaterals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_loan_borrowers_select ON public.finance_loan_borrowers;
CREATE POLICY finance_loan_borrowers_select ON public.finance_loan_borrowers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR borrower_user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS finance_loan_borrowers_insert ON public.finance_loan_borrowers;
CREATE POLICY finance_loan_borrowers_insert ON public.finance_loan_borrowers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS finance_loan_borrowers_update ON public.finance_loan_borrowers;
CREATE POLICY finance_loan_borrowers_update ON public.finance_loan_borrowers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))
  WITH CHECK (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS finance_loan_borrowers_delete ON public.finance_loan_borrowers;
CREATE POLICY finance_loan_borrowers_delete ON public.finance_loan_borrowers
  FOR DELETE TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS finance_loans_select ON public.finance_loans;
CREATE POLICY finance_loans_select ON public.finance_loans
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
         OR EXISTS (SELECT 1 FROM public.finance_loan_borrowers b
                    WHERE b.id = finance_loans.borrower_id
                      AND b.borrower_user_id = auth.uid()));

DROP POLICY IF EXISTS finance_loans_insert ON public.finance_loans;
CREATE POLICY finance_loans_insert ON public.finance_loans
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.finance_loan_borrowers b
                          WHERE b.id = borrower_id
                            AND (b.user_id = auth.uid()
                                 OR (b.workspace_id IS NOT NULL
                                     AND public.is_workspace_member(b.workspace_id)))));

DROP POLICY IF EXISTS finance_loans_update ON public.finance_loans;
CREATE POLICY finance_loans_update ON public.finance_loans
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)))
  WITH CHECK (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS finance_loans_delete ON public.finance_loans;
CREATE POLICY finance_loans_delete ON public.finance_loans
  FOR DELETE TO authenticated
  USING (user_id = auth.uid()
         OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id)));

DROP POLICY IF EXISTS finance_loan_payments_select ON public.finance_loan_payments;
CREATE POLICY finance_loan_payments_select ON public.finance_loan_payments
  FOR SELECT TO authenticated
  USING (public.loan_is_visible(loan_id));

DROP POLICY IF EXISTS finance_loan_payments_insert ON public.finance_loan_payments;
CREATE POLICY finance_loan_payments_insert ON public.finance_loan_payments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.loan_is_owner(loan_id));

DROP POLICY IF EXISTS finance_loan_payments_update ON public.finance_loan_payments;
CREATE POLICY finance_loan_payments_update ON public.finance_loan_payments
  FOR UPDATE TO authenticated
  USING (public.loan_is_owner(loan_id)
         OR (reported_by = auth.uid() AND status = 'pending'))
  WITH CHECK (public.loan_is_owner(loan_id)
         OR (reported_by = auth.uid() AND status = 'pending'));

DROP POLICY IF EXISTS finance_loan_payments_delete ON public.finance_loan_payments;
CREATE POLICY finance_loan_payments_delete ON public.finance_loan_payments
  FOR DELETE TO authenticated
  USING (public.loan_is_owner(loan_id)
         OR (reported_by = auth.uid() AND status = 'pending'));

DROP POLICY IF EXISTS finance_loan_collaterals_select ON public.finance_loan_collaterals;
CREATE POLICY finance_loan_collaterals_select ON public.finance_loan_collaterals
  FOR SELECT TO authenticated
  USING (public.loan_is_visible(loan_id));

DROP POLICY IF EXISTS finance_loan_collaterals_insert ON public.finance_loan_collaterals;
CREATE POLICY finance_loan_collaterals_insert ON public.finance_loan_collaterals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.loan_is_owner(loan_id));

DROP POLICY IF EXISTS finance_loan_collaterals_update ON public.finance_loan_collaterals;
CREATE POLICY finance_loan_collaterals_update ON public.finance_loan_collaterals
  FOR UPDATE TO authenticated
  USING (public.loan_is_owner(loan_id))
  WITH CHECK (public.loan_is_owner(loan_id));

DROP POLICY IF EXISTS finance_loan_collaterals_delete ON public.finance_loan_collaterals;
CREATE POLICY finance_loan_collaterals_delete ON public.finance_loan_collaterals
  FOR DELETE TO authenticated
  USING (public.loan_is_owner(loan_id));

-- Triggers

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_loan_borrowers','finance_loans',
    'finance_loan_payments','finance_loan_collaterals'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_ws_guard ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_ws_guard BEFORE INSERT OR UPDATE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.finance_guard_workspace()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.finance_guard_loan_borrower()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  -- Contexto de sistema (cascade de exclusao de usuario): sem JWT nao ha
  -- ninguem a conter, e barrar aqui ABORTA o DELETE do usuario inteiro.
  -- Mesmo motivo de 20260721150000_fix_user_delete_invite_guard.sql.
  if auth.uid() is null then return new; end if;

  if old.borrower_user_id is not null
     and new.borrower_user_id is distinct from old.borrower_user_id
     and new.borrower_user_id is not null then
    raise exception 'Desvincule antes de vincular outro usuario'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_loan_borrower_guard ON public.finance_loan_borrowers;
CREATE TRIGGER trg_loan_borrower_guard BEFORE UPDATE ON public.finance_loan_borrowers
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_loan_borrower();

CREATE OR REPLACE FUNCTION public.finance_guard_loan_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if auth.uid() is null then return new; end if;
  if public.loan_is_owner(old.loan_id) then return new; end if;

  if new.loan_id is distinct from old.loan_id
     or new.user_id is distinct from old.user_id
     or new.workspace_id is distinct from old.workspace_id
     or new.amount is distinct from old.amount
     or new.date is distinct from old.date
     or new.method is distinct from old.method
     or new.status is distinct from old.status
     or new.reported_by is distinct from old.reported_by
     or new.confirmed_by is distinct from old.confirmed_by
     or new.confirmed_at is distinct from old.confirmed_at
     or new.account_id is distinct from old.account_id
     or new.transaction_id is distinct from old.transaction_id then
    raise exception 'Devedor so pode anexar comprovante e nota ao proprio reporte'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_loan_payment_guard ON public.finance_loan_payments;
CREATE TRIGGER trg_loan_payment_guard BEFORE UPDATE ON public.finance_loan_payments
  FOR EACH ROW EXECUTE FUNCTION public.finance_guard_loan_payment();

-- Indices

CREATE INDEX IF NOT EXISTS finance_loan_borrowers_user_idx ON finance_loan_borrowers (user_id, name);
CREATE INDEX IF NOT EXISTS finance_loan_borrowers_linked_idx ON finance_loan_borrowers (borrower_user_id) WHERE borrower_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_loan_borrowers_ws_idx ON finance_loan_borrowers (workspace_id);

CREATE INDEX IF NOT EXISTS finance_loans_user_idx ON finance_loans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS finance_loans_borrower_idx ON finance_loans (borrower_id);
CREATE INDEX IF NOT EXISTS finance_loans_status_idx ON finance_loans (status);
CREATE INDEX IF NOT EXISTS finance_loans_ws_idx ON finance_loans (workspace_id);
CREATE INDEX IF NOT EXISTS finance_loans_tx_idx ON finance_loans (transaction_id);

CREATE INDEX IF NOT EXISTS finance_loan_payments_loan_idx ON finance_loan_payments (loan_id, date DESC);
CREATE INDEX IF NOT EXISTS finance_loan_payments_pending_idx ON finance_loan_payments (loan_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS finance_loan_payments_reported_idx ON finance_loan_payments (reported_by);
CREATE INDEX IF NOT EXISTS finance_loan_payments_ws_idx ON finance_loan_payments (workspace_id);
CREATE INDEX IF NOT EXISTS finance_loan_payments_tx_idx ON finance_loan_payments (transaction_id);

CREATE INDEX IF NOT EXISTS finance_loan_collaterals_loan_idx ON finance_loan_collaterals (loan_id);
CREATE INDEX IF NOT EXISTS finance_loan_collaterals_user_idx ON finance_loan_collaterals (user_id);
CREATE INDEX IF NOT EXISTS finance_loan_collaterals_ws_idx ON finance_loan_collaterals (workspace_id);

-- Storage: bucket privado proprio. path[1] e' o UPLOADER, nao o credor.
-- Molde do SELECT: 20260812120000_sec_storage_share_scoped_read.sql.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('loan-files', 'loan-files', false, 15728640,
        ARRAY['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS loan_files_owner_or_party_read ON storage.objects;
CREATE POLICY loan_files_owner_or_party_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'loan-files'
         AND ((storage.foldername(name))[1] = auth.uid()::text
              OR public.loan_file_is_readable(
                   public.try_cast_uuid((storage.foldername(name))[2]))));

DROP POLICY IF EXISTS loan_files_owner_insert ON storage.objects;
CREATE POLICY loan_files_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'loan-files'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS loan_files_owner_update ON storage.objects;
CREATE POLICY loan_files_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'loan-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS loan_files_owner_delete ON storage.objects;
CREATE POLICY loan_files_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'loan-files'
         AND (storage.foldername(name))[1] = auth.uid()::text);
-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260823150344).
-- SQL idêntico ao aplicado em produção (md5 d42056b874ab2b27ed34d90931d10229); não editar.

-- Numero de PARCELAS do emprestimo, fixado na criacao.
--
-- Os juros passam a incidir sobre a parcela do mes (principal / term_months),
-- e nao sobre o saldo devedor inteiro: R$ 10.000 a 10% em 7 meses rende
-- R$ 142,86/mes, nao R$ 1.000. O custo total vira principal * (1 + taxa).
--
-- Por que uma coluna, e nao derivar dos meses ate o due_date: pagar so os juros
-- EMPURRA o due_date em um mes (a rolagem). Se a parcela saisse do due_date,
-- cada rolagem aumentaria o prazo, diminuindo a parcela e com ela os juros --
-- rolar ficaria progressivamente mais barato, premiando quem nao paga. Aqui
-- `due_date` e o prazo corrente (e rola) e `term_months` e quantas parcelas o
-- emprestimo tem (e nao rola).
--
-- NULL = emprestimo aberto (sem prazo) OU linha anterior a esta migration. Nos
-- dois casos src/lib/loanCalc.ts cai no fallback de uma parcela so, que e
-- exatamente o comportamento antigo -- por isso nao ha backfill.

ALTER TABLE public.finance_loans
  ADD COLUMN IF NOT EXISTS term_months integer
  CONSTRAINT finance_loans_term_months_positive CHECK (term_months IS NULL OR term_months > 0);

COMMENT ON COLUMN public.finance_loans.term_months IS
  'Numero de parcelas. Base dos juros do mes (principal / term_months). NULL = emprestimo aberto: uma parcela so, juros sobre o principal inteiro.';
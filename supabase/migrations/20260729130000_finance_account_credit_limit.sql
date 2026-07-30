-- Limite do cartao de credito, em CENTAVOS (bigint, padrao pos-migracao de
-- cents), apenas para contas type = 'credit'. Nullable: cartao sem limite
-- cadastrado continua valido e a UI simplesmente omite a barra de uso.
-- finance_accounts usa RLS + grant de tabela e o load e' select('*'), entao a
-- coluna nova chega ao cliente sem grant adicional (diferente de profiles).

ALTER TABLE public.finance_accounts
  ADD COLUMN IF NOT EXISTS credit_limit bigint;

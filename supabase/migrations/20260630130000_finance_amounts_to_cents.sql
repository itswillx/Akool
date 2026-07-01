-- Convert finance money columns from numeric(_,2) reais to bigint cents.
--
-- Rationale: amounts are summed/compared in the JS layer (float64). Storing and
-- moving integer cents removes any rounding ambiguity end to end. Existing values
-- are multiplied by 100 and rounded to the nearest cent.
--
-- ⚠️ Deploy atomically with the application code that reads/writes cents
-- (toCents on write, fromCents/formatBRL on display). Until the new code ships,
-- the old UI would render values 100× too large.
--
-- Reversible: to roll back, run the inverse for each column, e.g.
--   alter table public.finance_transactions
--     alter column amount type numeric(15,2) using (amount::numeric / 100);

alter table public.finance_transactions
  alter column amount type bigint using round(amount * 100)::bigint;

alter table public.finance_accounts
  alter column initial_balance type bigint using round(initial_balance * 100)::bigint;

alter table public.finance_budgets
  alter column amount_limit type bigint using round(amount_limit * 100)::bigint;

alter table public.finance_goals
  alter column target_amount type bigint using round(target_amount * 100)::bigint;

alter table public.finance_goal_contributions
  alter column amount type bigint using round(amount * 100)::bigint;

-- Nullable amounts (variable recurring bills): NULLs are preserved by round().
alter table public.finance_recurring
  alter column amount type bigint using round(amount * 100)::bigint;

alter table public.finance_recurring_entries
  alter column amount type bigint using round(amount * 100)::bigint;

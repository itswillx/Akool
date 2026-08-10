-- Duração estimada (em dias) de um card. Usada pelo gerador de cronograma
-- automático (src/lib/autoSchedule.ts) para calcular due_date a partir de
-- start_date. Aditiva e reversível (DROP COLUMN estimated_days). Herda as
-- RLS policies existentes da tabela (são por linha, não por coluna).
ALTER TABLE project_cards
  ADD COLUMN IF NOT EXISTS estimated_days integer NOT NULL DEFAULT 1 CHECK (estimated_days > 0);

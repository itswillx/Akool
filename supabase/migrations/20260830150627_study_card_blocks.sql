-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260830150627).
-- SQL idêntico ao aplicado em produção (md5 838e6c3bc76db1f0f998c413f46c399a); não editar.

-- Didactic blocks per study card: worked example, common mistakes, glossary,
-- analogy, guided exercise and self-check. Embedded JSONB collection (same
-- pattern as checkpoints/resources/quiz).
--
-- `description` stays the card's main body and renders as the first, full-width
-- block, so blocks are strictly additive: NOT NULL DEFAULT '[]' is enough and
-- legacy/manual cards need no backfill. RLS untouched (the existing
-- study_cards_* policies are row-scoped on user_id).
--
-- `kind` drives a lookup table on the client (STUDY_BLOCK_REGISTRY in
-- src/lib/studyBlocks.ts); unknown values are coerced to 'note' when read, so
-- no CHECK constraint here — a newer client writing a new kind must not make
-- the row unreadable by an older one.

ALTER TABLE study_cards ADD COLUMN IF NOT EXISTS blocks jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN study_cards.blocks IS
  'Didactic blocks: [{id, kind: example|pitfall|glossary|analogy|exercise|selfcheck|note, title?, body (markdown), reveal? (hidden markdown)}]. Empty for manual/legacy cards.';
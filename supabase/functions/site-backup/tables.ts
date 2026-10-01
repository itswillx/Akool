// Classificação das tabelas de public para o backup, sem imports de Deno/jsr
// para o vitest cobrir (tables.test.ts confere a paridade com as migrations).
//
// Every public-schema table the backup captures, in FK dependency order:
// restore inserts in this order and clears in reverse, so referenced tables
// (e.g. study_topics) must come before their dependents (study_cards/logs).
// MUST match restore_order in the latest restore_site_backup migration
// (today 20260822215051_rel004_loan_tables_backup.sql) — tables.test.ts fails
// otherwise. Tables deliberately NOT listed are in EXCLUDED_TABLES below, each
// with the reason. assertNoTableDrift() (index.ts) enforces at runtime that
// BACKUP_TABLES + EXCLUDED_TABLES covers the whole public schema.
export const BACKUP_TABLES = [
  "profiles",
  "invite_codes",
  "pages",
  "page_shares",
  "note_contents",
  "drawing_contents",
  "todos",
  "project_boards",
  "project_columns",
  "project_cards",
  "project_shares",
  "finance_workspaces",
  "finance_workspace_members",
  "finance_accounts",
  "finance_categories",
  "finance_budgets",
  "finance_goals",
  "finance_goal_shares",
  "finance_recurring",
  "finance_transactions",
  "finance_goal_contributions",
  "finance_recurring_entries",
  "finance_workspace_invites",
  "finance_suppliers",
  "finance_store_customers",
  "finance_store_products",
  "finance_store_purchases",
  "finance_store_sales",
  "finance_store_sale_items",
  // REL-001: loans module (migration 20260822171324). Order = restore_order of
  // rel004: borrowers → loans → payments → collaterals.
  "finance_loan_borrowers",
  "finance_loans",
  "finance_loan_payments",
  "finance_loan_collaterals",
  "notifications",
  "quick_notes",
  "study_topics",
  "study_cards",
  "study_logs",
] as const;

// Public-schema tables deliberately left out of the archive. Kept as data (not
// just prose) because assertNoTableDrift() checks against it.
export const EXCLUDED_TABLES = [
  // The backup system's own registry and config — clearing/rewriting them
  // mid-restore would corrupt the very backup being restored.
  "site_backups",
  "site_backup_settings",
  // Plaintext AI credentials (see migration 20260708100000). Copying secrets
  // into backup archives would leak them; the table is locked to service role
  // and users can re-enter keys after a restore.
  "profile_secrets",
  // Ephemeral realtime presence rows; stale by definition, nothing to restore.
  "page_presence",
  // Legacy tables with zero references in the app code — the current app can
  // neither read nor write them, so their data is dead weight and their exact
  // schema is unmanaged here. Decide to drop or re-integrate them before
  // moving either one into BACKUP_TABLES.
  "mindmap_contents",
  "finance_statements",
  // The audit trail must survive a restore: it is what records that the
  // restore happened. Including it would let a restore erase its own evidence.
  "audit_log",
  // Personal API tokens (hashes) for cards-api. Credentials, same reasoning as
  // profile_secrets: users generate new ones after a restore.
  "api_tokens",
  // AI development queue (cards-api). Work-in-progress state tied to a live
  // session; restoring an old queue would re-run finished work.
  "project_card_queue",
  // Shared cache of public-API lookups of the former study-lookup edge function
  // (migration 20260830200710; the function left on 2026-10-01, SEC-015, and the
  // table goes with DEV-010). Regenerable, service_role only, expires.
  "study_lookup_cache",
] as const;

// All buckets the app writes to (verified against src usages and the bucket
// migrations). The site-backups bucket itself is the backup destination and
// is intentionally not copied into itself.
// Left out on purpose:
// - bank-statements: belongs to finance_statements, the legacy table excluded
//   above; no reference anywhere in src/.
// - project-expense-files: its owning table (finance_project_expenses) was
//   dropped by migration 20260807120000, so whatever is left there is
//   unreachable by the app.
// - loan-files: loan attachments (migration 20260822171324). Left out by
//   decision on 2026-09-25 (REL-001), while it held 0 files and the loans UI
//   is not in this codebase. Revisit if loan attachments start being used.
export const STORAGE_BUCKETS = ["note-images", "project-card-images", "transaction-photos", "store-files", "avatars"] as const;

# Módulo de Backup (`src/modules/backup`)

Módulo **isolado** do backup do site (somente admin). Cria pontos de restauração
do workspace inteiro — dados (`profiles`, `pages`, `project_*`, `finance_*`, …) e
arquivos de storage (imagens/anexos) — e permite restaurar ou excluir.

## Limites do módulo

- **Entrada pública:** `index.ts` (barrel). Importe sempre por `../modules/backup`,
  nunca apontando direto para arquivos internos.
- **Depende apenas de infraestrutura compartilhada** do app: `contexts/AuthContext`,
  `contexts/PagesContext`, `i18n/LanguageContext`, `lib/supabase`,
  `hooks/useIsMobile`, `components/ConfirmDeleteModal` e os tipos `SiteBackup*`
  de `src/types`.

## Conteúdo

- `BackupPanel.tsx` — UI do painel (cabeçalho, ações, tabela de pontos de restauração).
- `useSiteBackup.ts` — hook de dados; conversa com a Edge Function via `get_overview`,
  `create_backup`, `restore_backup`, `delete_backup`, `update_settings`.
- `index.ts` — barrel (entrada pública).

## Backend

O backend é a **Edge Function `site-backup`** (`supabase/functions/site-backup/index.ts`),
que roda com a *service role* e é a **única fronteira de segurança** real:

- Verifica admin (`profiles.role = 'admin'`) ou o segredo de cron em **toda** chamada.
- Faz dump das tabelas + cópia do storage para o bucket privado `site-backups`,
  comprime em `.json.gz` e aplica retenção (`MAX_BACKUPS`).
- Restore é **destrutivo** (limpa e reinsere as tabelas) — não é testado em produção.

Tabelas/políticas: `supabase/migrations/20250622120000_site_backups.sql`
(`site_backups`, `site_backup_settings`, RLS de leitura para admin e job de cron
semanal). Escritas passam pela service role, que ignora RLS por design.

> ⚠️ Qualquer nova tabela/integração de backup **precisa nascer com RLS**.

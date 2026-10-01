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
(`site_backups`, `site_backup_settings` e RLS de leitura para admin). Escritas
passam pela service role, que ignora RLS por design.

## Backup automático (REL-008)

O agendamento fica no servidor, na migration `*_rel008_backup_cron.sql`:
- o `pg_cron` roda `private.request_site_backup()` todo dia às 06:00 UTC;
- a função faz um `net.http_post` na `site-backup` com `run_auto_backup`, e a Edge Function decide se já venceu o intervalo (`interval_days`);
- a URL e o segredo (`site_backup_url` e `backup_cron_secret`) ficam no **Vault**, fora do repositório;
- o segredo precisa ser igual ao `BACKUP_CRON_SECRET` das Edge Functions.

O painel só lista, mostra o atraso e dispara o backup manual. Antes, o automático só rodava quando um admin abria o painel.

> ⚠️ Qualquer nova tabela/integração de backup **precisa nascer com RLS**.

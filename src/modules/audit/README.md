# Módulo de Auditoria (`src/modules/audit`)

Visualização **somente leitura** da trilha de auditoria do site (`public.audit_log`),
restrita a admin. Mostra quem fez o quê, quando, em qual alvo e se deu certo.

## Limites do módulo

- **Entrada pública:** `index.ts` (barrel). Importe sempre por `../modules/audit`,
  nunca apontando direto para arquivos internos.
- **Depende apenas de infraestrutura compartilhada:** `contexts/AuthContext`,
  `i18n/LanguageContext`, `lib/supabase`, `hooks/useIsMobile` e o tipo
  `AuditLogEntry` de `src/types`.
- **Não escreve nada.** Não existe caminho de escrita a partir do cliente — e não
  deve existir: um log que o próprio ator pode editar não é auditoria.

## Conteúdo

- `AuditLogPanel.tsx` — UI do painel (filtro por ação, tabela, linha expansível
  com o `details` jsonb e o `error_message`, paginação por `.range()`).
- `index.ts` — barrel (entrada pública).

## Backend

A tabela `public.audit_log` nasceu em
`supabase/migrations/20260810130000_rel001_transactional_restore.sql` (REL-001),
genérica de propósito para servir a qualquer ação administrativa.

- **Leitura:** policy `"Admins can read audit_log"` (`SELECT` para `authenticated`
  onde `profiles.role = 'admin'`). Por isso este painel consulta o PostgREST
  direto, sem edge function no meio.
- **Escrita:** só pela *service role*. Não há policy de INSERT/UPDATE/DELETE para
  `authenticated`. Quem grava hoje:
  - `supabase/functions/admin-ops/index.ts` — `set_role`, `ban_user`,
    `unban_user`, `delete_user` (sucesso, falha e tentativa negada);
  - `supabase/functions/site-backup/index.ts` — `restore_backup` e `delete_backup`
    (sucesso e falha; o `details` do delete guarda `type`/`created_at`/`size_bytes`/
    `storage_path` lidos **antes** da remoção, mais `found: false` quando o id já
    não existia).

Ao adicionar uma ação nova numa edge function, chame o `logAudit` local dela e
acrescente a chave em `ACTION_LABEL_KEYS`/`ACTION_FILTERS` no painel — ações
desconhecidas aparecem com o nome cru, não somem da lista.

> ⚠️ Nota de dívida: `authenticated` ainda tem GRANT de INSERT/UPDATE/DELETE na
> tabela; hoje só a ausência de policy impede adulteração da trilha. Revogar
> esses grants fica como follow-up.

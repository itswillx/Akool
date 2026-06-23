# Backlog Akool — Segurança

> 12 cards · BacklogCard v1 · Importar via Projects → Importar

## Tópico: Segurança

---

### CARD SEC-001 — Versionar schema completo e políticas RLS


| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| **ID**         | SEC-001                                    |
| **Prioridade** | P0                                         |
| **Esforço**    | L                                          |
| **Labels**     | segurança, supabase, migrations            |
| **Arquivos**   | `supabase/migrations/`, dashboard Supabase |


**Problema:** Apenas `[supabase/migrations/20250622120000_site_backups.sql](supabase/migrations/20250622120000_site_backups.sql)` existe no repo. Tabelas `pages`, `profiles`, `finance_`*, RPCs e RLS vivem só no projeto remoto.

**Subtarefas Kanban:**

- [ ] Rodar `supabase db pull` ou export manual de todas as tabelas
- [ ] Exportar todas as policies RLS (`pg_policies`) para migrations
- [ ] Exportar functions/triggers (`validate_invite_code`, signup hooks)
- [ ] Exportar storage policies dos 4 buckets
- [ ] Revisar cada policy: SELECT/INSERT/UPDATE/DELETE por role
- [ ] Documentar matriz role × tabela × operação
- [ ] Adicionar migration check no CI (falha se drift)
- [ ] Criar checklist de review obrigatório antes de deploy DB

---

### CARD SEC-002 — Adicionar edge function admin-ops ao repositório


| Campo          | Valor                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-002                                                                                              |
| **Prioridade** | P0                                                                                                   |
| **Esforço**    | M                                                                                                    |
| **Labels**     | segurança, edge-functions, admin                                                                     |
| **Arquivos**   | `[UserManagementPanel.tsx](src/components/UserManagementPanel.tsx)`, `supabase/functions/admin-ops/` |


**Problema:** Frontend chama `/functions/v1/admin-ops` (`list_users`, `ban_user`, `unban_user`, `delete_user`) mas a função **não está versionada** em `supabase/functions/`.

**Subtarefas Kanban:**

- [ ] Recuperar código deployado ou reimplementar `admin-ops/index.ts`
- [ ] Validar JWT + `profiles.role = admin` em toda action
- [ ] Usar service role apenas após verificação admin
- [ ] Implementar audit log (quem baniu/deletou/quando)
- [ ] CORS allowlist igual `site-backup`
- [ ] Adicionar testes unitários Deno para cada action
- [ ] Deploy e smoke test via UserManagementPanel
- [ ] Documentar actions e payloads no README interno

---

### CARD SEC-003 — Migrar buckets públicos para acesso privado


| Campo          | Valor                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-003                                                                                                                                                           |
| **Prioridade** | P0                                                                                                                                                                |
| **Esforço**    | M                                                                                                                                                                 |
| **Labels**     | segurança, storage, PII                                                                                                                                           |
| **Arquivos**   | `[NoteEditor.tsx](src/components/NoteEditor.tsx)`, `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)`, `[FinancePanel.tsx](src/components/FinancePanel.tsx)` |


**Problema:** `note-images`, `project-card-images`, `transaction-photos` usam `getPublicUrl`. Recibos financeiros são dados sensíveis.

**Subtarefas Kanban:**

- [ ] Alterar buckets para `public: false` no Supabase
- [ ] Criar storage policies: owner + share-role pode ler
- [ ] Substituir `getPublicUrl` por `createSignedUrl` (TTL 1h)
- [ ] Atualizar NoteEditor upload + render de imagens
- [ ] Atualizar ProjectsPanel anexos de cards
- [ ] Atualizar FinancePanel fotos de transação (prioridade máxima)
- [ ] Atualizar `site-backup` restore paths se necessário
- [ ] Testar compartilhamento: viewer deve ver imagem, stranger não
- [ ] Migrar URLs existentes (script one-time se bucket já tem arquivos)

---

### CARD SEC-004 — Proteger chaves de IA em profiles


| Campo          | Valor                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-004                                                                                                                                                  |
| **Prioridade** | P0                                                                                                                                                       |
| **Esforço**    | M                                                                                                                                                        |
| **Labels**     | segurança, secrets, edge-functions                                                                                                                       |
| **Arquivos**   | `[ai-chat/index.ts](supabase/functions/ai-chat/index.ts)`, `[analyze-transaction-photo/index.ts](supabase/functions/analyze-transaction-photo/index.ts)` |


**Problema:** Edge functions leem `profiles.ai_api_key` via service role. Colunas podem ser legíveis via RLS mal configurado.

**Subtarefas Kanban:**

- [ ] Confirmar que `ai_api_key` nunca aparece em SELECT client-side
- [ ] Adicionar policy explícita DENY para colunas sensíveis no client
- [ ] Migrar para Supabase Vault ou pgcrypto
- [ ] Mascarar chave na UI (últimos 4 chars)
- [ ] Implementar rotação de chave
- [ ] Log de acesso à chave (edge function only)
- [ ] Decidir: conectar UI ou remover funções órfãs (ver ARCH-008)

---

### CARD SEC-005 — Corrigir fluxo de invite codes (atomicidade)


| Campo          | Valor                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| **ID**         | SEC-005                                                                                     |
| **Prioridade** | P1                                                                                          |
| **Esforço**    | M                                                                                           |
| **Labels**     | segurança, auth                                                                             |
| **Arquivos**   | `[AuthPage.tsx](src/pages/AuthPage.tsx)`, `[AuthContext.tsx](src/contexts/AuthContext.tsx)` |


**Problema:** Cliente chama `validate_invite_code` e depois `signUp` — janela TOCTOU (código pode ser usado duas vezes).

**Subtarefas Kanban:**

- [ ] Mover consumo do código para trigger DB no signup
- [ ] Tornar `validate_invite_code` apenas hint UX (opcional)
- [ ] Garantir rollback se signup falhar após consumo
- [ ] Testar concorrência (2 signups simultâneos, 1 código)
- [ ] Adicionar rate limit no RPC
- [ ] Log de tentativas inválidas

---

### CARD SEC-006 — Endurecer sessão (daily login + usuários inativos)


| Campo          | Valor                                                                       |
| -------------- | --------------------------------------------------------------------------- |
| **ID**         | SEC-006                                                                     |
| **Prioridade** | P1                                                                          |
| **Esforço**    | M                                                                           |
| **Labels**     | segurança, auth, sessão                                                     |
| **Arquivos**   | `[App.tsx](src/App.tsx)`, `[AuthContext.tsx](src/contexts/AuthContext.tsx)` |


**Problema:** Daily login usa data UTC e faz logout hard. Usuário desativado mantém sessão após refresh.

**Subtarefas Kanban:**

- [ ] Verificar `is_active` em `getSession` / `onAuthStateChange`
- [ ] Sign out imediato se `!profile.is_active`
- [ ] Revisar daily login: timezone do usuário vs UTC
- [ ] Considerar re-auth modal em vez de logout total
- [ ] Documentar política de sessão no Help/Admin
- [ ] Testar: admin desativa user → sessão encerra em <30s

---

### CARD SEC-007 — Restringir enumeração de profiles por email


| Campo          | Valor                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-007                                                                                                                                                                   |
| **Prioridade** | P1                                                                                                                                                                        |
| **Esforço**    | M                                                                                                                                                                         |
| **Labels**     | segurança, privacidade                                                                                                                                                    |
| **Arquivos**   | `[SharePageModal.tsx](src/components/SharePageModal.tsx)`, `[FinancePanel.tsx](src/components/FinancePanel.tsx)`, `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)` |


**Subtarefas Kanban:**

- [ ] Criar RPC `search_users_for_share(term)` com rate limit
- [ ] Exigir mínimo 3 caracteres + debounce 300ms
- [ ] Retornar só id + display name (sem email completo se possível)
- [ ] RLS: só usuários autenticados
- [ ] Substituir queries `.ilike` diretas nos 3 componentes
- [ ] Testar que user comum não lista todos os profiles

---

### CARD SEC-008 — Mover ações admin sensíveis para edge function


| Campo          | Valor                                                               |
| -------------- | ------------------------------------------------------------------- |
| **ID**         | SEC-008                                                             |
| **Prioridade** | P1                                                                  |
| **Esforço**    | M                                                                   |
| **Labels**     | segurança, admin                                                    |
| **Arquivos**   | `[UserManagementPanel.tsx](src/components/UserManagementPanel.tsx)` |


**Subtarefas Kanban:**

- [ ] Mover toggle `profiles.role` para `admin-ops`
- [ ] Mover `profiles.is_active` para `admin-ops`
- [ ] Verificar RLS impede UPDATE direto de role por standard user
- [ ] Adicionar confirmação dupla para delete_user
- [ ] Audit trail por ação admin

---

### CARD SEC-009 — Padronizar CORS em todas edge functions


| Campo          | Valor                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| **ID**         | SEC-009                                                                                     |
| **Prioridade** | P1                                                                                          |
| **Esforço**    | S                                                                                           |
| **Labels**     | segurança, cors                                                                             |
| **Arquivos**   | `[google-calendar/index.ts](supabase/functions/google-calendar/index.ts)`, demais functions |


**Subtarefas Kanban:**

- [ ] Substituir `Access-Control-Allow-Origin:` * em google-calendar
- [ ] Extrair helper CORS compartilhado `_shared/cors.ts`
- [ ] Usar `ALLOWED_ORIGINS` env em todas as functions
- [ ] Validar preflight OPTIONS em todas
- [ ] Documentar origens permitidas por ambiente

---

### CARD SEC-010 — Auditar uso de service role


| Campo          | Valor                     |
| -------------- | ------------------------- |
| **ID**         | SEC-010                   |
| **Prioridade** | P1                        |
| **Esforço**    | M                         |
| **Labels**     | segurança, edge-functions |
| **Arquivos**   | Todas edge functions      |


**Subtarefas Kanban:**

- [ ] Listar cada ponto que instancia client com service role
- [ ] Confirmar auth check **antes** de service role em todas
- [ ] site-backup: log restore/delete com admin id
- [ ] google-calendar: criptografar tokens OAuth
- [ ] Proibir service role no frontend (grep no repo)
- [ ] Rotacionar service role key se vazou em logs

---

### CARD SEC-011 — Endurecer CSP e headers Netlify


| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | SEC-011                        |
| **Prioridade** | P2                             |
| **Esforço**    | M                              |
| **Labels**     | segurança, headers             |
| **Arquivos**   | `[netlify.toml](netlify.toml)` |


**Subtarefas Kanban:**

- [ ] Revisar CSP atual (`unsafe-inline`, `unsafe-eval`)
- [ ] Testar app com CSP mais restritivo
- [ ] Adicionar `Referrer-Policy`, `Permissions-Policy`
- [ ] Verificar HSTS (se domínio custom)
- [ ] Documentar exceções necessárias (Excalidraw inline)

---

### CARD SEC-012 — Rate limiting em RPCs e edge functions


| Campo          | Valor                         |
| -------------- | ----------------------------- |
| **ID**         | SEC-012                       |
| **Prioridade** | P2                            |
| **Esforço**    | M                             |
| **Labels**     | segurança, abuse              |
| **Arquivos**   | Edge functions, RPCs Supabase |


**Subtarefas Kanban:**

- [ ] Rate limit em `validate_invite_code`
- [ ] Rate limit em `site-backup` create/restore
- [ ] Rate limit em `ai-chat` / OCR por user_id
- [ ] Rate limit em search profiles RPC
- [ ] Monitorar 429 no Supabase logs
- [ ] Feedback UI quando rate limited

---

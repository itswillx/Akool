# Backlog Akool — Mapa System Design

> Arquivo gerado para importação Kanban (BacklogCard v1).
> Importar via Projects → Importar ou `npm run import:cards -- <arquivo> --board-id=<uuid>`

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

## Tópico: Performance

---

### CARD PERF-001 — Paginar transações financeiras


| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | PERF-001                                                              |
| **Prioridade** | P1                                                                    |
| **Esforço**    | M                                                                     |
| **Labels**     | performance, finance                                                  |
| **Arquivos**   | `[FinancePanel.tsx](src/components/FinancePanel.tsx)` ~linhas 279–291 |


**Problema:** `finance_transactions.select('*')` sem filtro de data ou limite.

**Subtarefas Kanban:**

- [ ] Filtrar por mês/intervalo selecionado na UI
- [ ] Adicionar `.range(offset, limit)` com paginação
- [ ] Criar RPC `finance_month_summary` para totais
- [ ] Manter contagem total via `count: 'exact'`
- [ ] Prefetch mês anterior/próximo
- [ ] Atualizar Dashboard para não carregar all transactions
- [ ] Benchmark: 10k transações → tempo de load < 2s

---

### CARD PERF-002 — Eliminar reload completo no FinancePanel


| Campo          | Valor                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| **ID**         | PERF-002                                                               |
| **Prioridade** | P1                                                                     |
| **Esforço**    | L                                                                      |
| **Labels**     | performance, finance                                                   |
| **Arquivos**   | `[FinancePanel.tsx](src/components/FinancePanel.tsx)` — 19× `reload()` |


**Subtarefas Kanban:**

- [ ] Mapear cada mutation → tabelas afetadas
- [ ] Substituir `reload()` por update local do slice
- [ ] Introduzir TanStack Query com invalidation granular
- [ ] Manter `reload()` só em troca de workspace
- [ ] Medir re-renders antes/depois (React DevTools)
- [ ] Testar CRUD de transação, meta, orçamento sem full fetch

---

### CARD PERF-003 — Otimizar PagesContext refresh


| Campo          | Valor                                               |
| -------------- | --------------------------------------------------- |
| **ID**         | PERF-003                                            |
| **Prioridade** | P1                                                  |
| **Esforço**    | M                                                   |
| **Labels**     | performance, workspace                              |
| **Arquivos**   | `[PagesContext.tsx](src/contexts/PagesContext.tsx)` |


**Subtarefas Kanban:**

- [ ] Separar `loading` inicial de background refresh
- [ ] Não chamar `setLoading(true)` em refresh silencioso
- [ ] Realtime subscription em `pages` + `page_shares`
- [ ] Otimizar fetch de shared pages (não buscar all pages do owner)
- [ ] Optimistic reparent sem full refetch
- [ ] Virtualizar árvore no Sidebar (>100 páginas)

---

### CARD PERF-004 — Dividir FinancePanel em submódulos


| Campo          | Valor                                                           |
| -------------- | --------------------------------------------------------------- |
| **ID**         | PERF-004                                                        |
| **Prioridade** | P1                                                              |
| **Esforço**    | L                                                               |
| **Labels**     | performance, modularização                                      |
| **Arquivos**   | `[FinancePanel.tsx](src/components/FinancePanel.tsx)` ~3919 LOC |


**Subtarefas Kanban:**

- [ ] Extrair `useFinanceData` → `modules/finance/hooks/`
- [ ] Extrair cada tab (Contas, Transações, Orçamentos, Metas, Recorrentes, Workspace)
- [ ] Lazy import por tab (`React.lazy` dentro do painel)
- [ ] Extrair modals para arquivos separados
- [ ] Shared `FinanceModal` / `FinanceInput` styles
- [ ] Verificar chunk size pós-split (`vite build --report`)
- [ ] Meta: nenhum arquivo > 400 LOC

---

### CARD PERF-005 — Dividir ProjectsPanel


| Campo          | Valor                                                             |
| -------------- | ----------------------------------------------------------------- |
| **ID**         | PERF-005                                                          |
| **Prioridade** | P2                                                                |
| **Esforço**    | L                                                                 |
| **Labels**     | performance, projects                                             |
| **Arquivos**   | `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)` ~2235 LOC |


**Subtarefas Kanban:**

- [ ] Extrair `BoardList`, `KanbanView`, `CardModal`, `ShareBoardModal`
- [ ] Extrair hook `useProjectsData`
- [ ] Lazy load CardModal (pesado com imagens)
- [ ] Memoizar colunas e cards (`React.memo`)
- [ ] Meta: chunk projects < 500KB gzip

---

### CARD PERF-006 — Lazy load i18n e help content


| Campo          | Valor                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| **ID**         | PERF-006                                                                                   |
| **Prioridade** | P2                                                                                         |
| **Esforço**    | M                                                                                          |
| **Labels**     | performance, i18n                                                                          |
| **Arquivos**   | `[translations.ts](src/i18n/translations.ts)`, `[helpContent.ts](src/i18n/helpContent.ts)` |


**Subtarefas Kanban:**

- [ ] Split `translations.ts` por módulo (core, finance, projects, workspace)
- [ ] Dynamic import só do locale ativo (`pt-BR` OR `en`)
- [ ] Dynamic import de `helpContent` ao abrir HelpPanel
- [ ] Dynamic import de tour steps ao iniciar WelcomeTour
- [ ] Medir redução do bundle inicial
- [ ] Manter fallback sync para auth page

---

### CARD PERF-007 — Otimizar Realtime e presence


| Campo          | Valor                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **ID**         | PERF-007                                                                                            |
| **Prioridade** | P2                                                                                                  |
| **Esforço**    | M                                                                                                   |
| **Labels**     | performance, realtime                                                                               |
| **Arquivos**   | `[usePagePresence.ts](src/hooks/usePagePresence.ts)`, `[TodoList.tsx](src/components/TodoList.tsx)` |


**Subtarefas Kanban:**

- [ ] Substituir poll 15s de presence por Realtime channel
- [ ] TodoList: aplicar delta do payload em vez de `refresh()` full
- [ ] Unificar padrão de subscription (hook `useSupabaseChannel`)
- [ ] Cleanup de channels ao desmontar (audit memory leaks)
- [ ] Limitar presence a páginas com >1 usuário ativo

---

### CARD PERF-008 — Lazy load modals e Excalidraw inline


| Campo          | Valor                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **ID**         | PERF-008                                                                                           |
| **Prioridade** | P2                                                                                                 |
| **Esforço**    | M                                                                                                  |
| **Labels**     | performance, bundle                                                                                |
| **Arquivos**   | `[Sidebar.tsx](src/components/Sidebar.tsx)`, `[DiagramBlock.tsx](src/components/DiagramBlock.tsx)` |


**Subtarefas Kanban:**

- [ ] Lazy load `UserSettingsModal`, `ExportPdfModal` no Sidebar
- [ ] Lazy load Excalidraw em `DiagramBlock` (segundo embed pesado)
- [ ] Lazy load `LinkedNotePanel` dentro de DrawingCanvas
- [ ] Avaliar link para drawing page vs inline diagram
- [ ] Revisar `vite.config.ts` manualChunks pós-mudanças

---

### CARD PERF-009 — Vite build optimization


| Campo          | Valor                                                              |
| -------------- | ------------------------------------------------------------------ |
| **ID**         | PERF-009                                                           |
| **Prioridade** | P2                                                                 |
| **Esforço**    | M                                                                  |
| **Labels**     | performance, build                                                 |
| **Arquivos**   | `[vite.config.ts](vite.config.ts)`, `[package.json](package.json)` |


**Subtarefas Kanban:**

- [ ] Rodar `vite build` + analyzer de chunks
- [ ] Configurar `manualChunks` por vendor (excalidraw, blocknote, supabase)
- [ ] Configurar `manualChunks` por módulo app (finance, projects)
- [ ] Remover `react-router-dom` se não for usar (ou implementar ARCH-003)
- [ ] Avaliar tree-shaking lucide-react (import por ícone)
- [ ] Meta: initial JS < 300KB gzip

---

### CARD PERF-010 — Compressão e resize de imagens no upload


| Campo          | Valor                                   |
| -------------- | --------------------------------------- |
| **ID**         | PERF-010                                |
| **Prioridade** | P2                                      |
| **Esforço**    | M                                       |
| **Labels**     | performance, storage                    |
| **Arquivos**   | NoteEditor, ProjectsPanel, FinancePanel |


**Subtarefas Kanban:**

- [ ] Criar util `compressImage(file, maxWidth, quality)`
- [ ] Aplicar antes de upload nos 3 componentes
- [ ] Converter para WebP quando suportado
- [ ] Limitar tamanho máx 2MB client-side
- [ ] Loading indicator durante compressão
- [ ] Medir redução média de storage

---

### CARD PERF-011 — Debounce padronizado em buscas


| Campo          | Valor                                                              |
| -------------- | ------------------------------------------------------------------ |
| **ID**         | PERF-011                                                           |
| **Prioridade** | P2                                                                 |
| **Esforço**    | S                                                                  |
| **Labels**     | performance                                                        |
| **Arquivos**   | `[FinancePanel.tsx](src/components/FinancePanel.tsx)` autocomplete |


**Subtarefas Kanban:**

- [ ] Criar constante `SEARCH_DEBOUNCE_MS = 300`
- [ ] Aplicar em FinancePanel partner/invite search
- [ ] Verificar SharePageModal (já 300ms) e ProjectsPanel
- [ ] Hook reutilizável `useDebouncedValue`

---

### CARD PERF-012 — TanStack Query como cache layer


| Campo          | Valor                     |
| -------------- | ------------------------- |
| **ID**         | PERF-012                  |
| **Prioridade** | P2                        |
| **Esforço**    | L                         |
| **Labels**     | performance, architecture |
| **Arquivos**   | App-wide                  |


**Subtarefas Kanban:**

- [ ] Instalar `@tanstack/react-query`
- [ ] Wrapper `QueryClientProvider` em App.tsx
- [ ] Migrar PagesContext fetch para queries
- [ ] Migrar NotificationsContext
- [ ] Migrar useFinanceData
- [ ] Configurar staleTime por domínio
- [ ] DevTools em development only

---

## Tópico: Arquitetura / Modularização

---

### CARD ARCH-001 — Criar estrutura de pastas modular


| Campo          | Valor                      |
| -------------- | -------------------------- |
| **ID**         | ARCH-001                   |
| **Prioridade** | P1                         |
| **Esforço**    | L                          |
| **Labels**     | arquitetura, modularização |


**Subtarefas Kanban:**

- [ ] Criar `src/core/` (auth, supabase, i18n base, theme)
- [ ] Criar `src/modules/workspace/`, `finance/`, `projects/`, `admin/`
- [ ] Criar `src/shared/` (modals, hooks genéricos)
- [ ] Definir regra ESLint: modules não importam entre si
- [ ] Barrel `index.ts` por módulo (API pública)
- [ ] Mover arquivos incrementalmente (1 módulo por PR)
- [ ] Atualizar imports com path aliases `@core`, `@modules`, `@shared`

---

### CARD ARCH-002 — Camada de repositórios Supabase


| Campo          | Valor                   |
| -------------- | ----------------------- |
| **ID**         | ARCH-002                |
| **Prioridade** | P2                      |
| **Esforço**    | L                       |
| **Labels**     | arquitetura, data-layer |


**Subtarefas Kanban:**

- [ ] Criar `src/core/db/client.ts` (re-export supabase)
- [ ] `pagesRepo.ts` — CRUD pages, shares, contents
- [ ] `financeRepo.ts` — queries + RPCs finance
- [ ] `projectsRepo.ts` — boards, cards, columns
- [ ] `adminRepo.ts` — profiles, invites, edge calls
- [ ] `mapSupabaseError()` centralizado
- [ ] Substituir calls inline nos contexts primeiro
- [ ] Depois nos panels

---

### CARD ARCH-003 — Implementar React Router (URLs reais)


| Campo          | Valor                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| **ID**         | ARCH-003                                                                      |
| **Prioridade** | P2                                                                            |
| **Esforço**    | L                                                                             |
| **Labels**     | arquitetura, routing                                                          |
| **Arquivos**   | `[App.tsx](src/App.tsx)`, `[PagesContext.tsx](src/contexts/PagesContext.tsx)` |


**Subtarefas Kanban:**

- [ ] Definir rotas: `/`, `/finance`, `/projects`, `/help`, `/admin/users`, `/admin/backup`, `/p/:pageId`
- [ ] Sync URL ↔ PagesContext (replace state navigation)
- [ ] Manter localStorage como fallback
- [ ] Guard routes admin (`isAdmin`)
- [ ] Netlify redirect SPA já existe — validar deep links
- [ ] Botão voltar do browser funcional
- [ ] Share link copiável por página

---

### CARD ARCH-004 — Gerar tipos TypeScript do Supabase


| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| **ID**         | ARCH-004                                   |
| **Prioridade** | P2                                         |
| **Esforço**    | M                                          |
| **Labels**     | arquitetura, types                         |
| **Arquivos**   | `[src/types/index.ts](src/types/index.ts)` |


**Subtarefas Kanban:**

- [ ] Script `npm run gen:types` → `src/types/database.generated.ts`
- [ ] Estender tipos gerados com campos UI-only (`share_role`, etc.)
- [ ] Tipar `supabase.from()` com Database generic
- [ ] Deprecar interfaces manuais duplicadas
- [ ] Rodar gen:types no CI após migration check

---

### CARD ARCH-005 — Desacoplar providers (feature flags)


| Campo          | Valor                 |
| -------------- | --------------------- |
| **ID**         | ARCH-005              |
| **Prioridade** | P3                    |
| **Esforço**    | M                     |
| **Labels**     | arquitetura, contexts |


**Subtarefas Kanban:**

- [ ] Lazy mount NotificationsProvider só após auth
- [ ] FinanceProvider local ao FinancePanel (não global)
- [ ] Avaliar Zustand para navigation state vs PagesContext
- [ ] Documentar árvore de providers alvo

---

### CARD ARCH-006 — Normalizar paths duplicados no Git (Windows)


| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | ARCH-006         |
| **Prioridade** | P2               |
| **Esforço**    | S                |
| **Labels**     | arquitetura, git |


**Problema:** Git status mostra `src/components/Sidebar.tsx` e `src\components\Sidebar.tsx`.

**Subtarefas Kanban:**

- [ ] `git ls-files` identificar duplicatas
- [ ] Remover cópias divergentes
- [ ] Configurar `core.autocrlf` / `.gitattributes`
- [ ] Usar só forward slashes nos imports
- [ ] Verificar CI no Windows + Linux

---

### CARD ARCH-007 — Adicionar supabase/config.toml


| Campo          | Valor                         |
| -------------- | ----------------------------- |
| **ID**         | ARCH-007                      |
| **Prioridade** | P1                            |
| **Esforço**    | M                             |
| **Labels**     | arquitetura, supabase, devops |


**Subtarefas Kanban:**

- [ ] `supabase init` ou criar config.toml manual
- [ ] Configurar project_id linked
- [ ] Documentar edge function secrets locais
- [ ] Enable local stack para dev (`supabase start`)
- [ ] Seed script para dev data

---

### CARD ARCH-008 — Decidir destino das edge functions órfãs


| Campo          | Valor                                               |
| -------------- | --------------------------------------------------- |
| **ID**         | ARCH-008                                            |
| **Prioridade** | P2                                                  |
| **Esforço**    | M                                                   |
| **Labels**     | arquitetura, produto                                |
| **Arquivos**   | ai-chat, analyze-transaction-photo, google-calendar |


**Subtarefas Kanban:**

- [ ] **Opção A — Integrar:** UI settings para AI key + botão OCR em Finance + sync Calendar
- [ ] **Opção B — Remover:** deletar functions não usadas e limpar profiles columns
- [ ] Documentar decisão no README
- [ ] Se integrar: cards filhos PERF/SEC específicos
- [ ] Se remover: migration drop columns + undeploy functions

---

### CARD ARCH-009 — Event bus / invalidação desacoplada


| Campo          | Valor                                               |
| -------------- | --------------------------------------------------- |
| **ID**         | ARCH-009                                            |
| **Prioridade** | P3                                                  |
| **Esforço**    | S                                                   |
| **Labels**     | arquitetura                                         |
| **Arquivos**   | `[BackupPanel.tsx](src/components/BackupPanel.tsx)` |


**Subtarefas Kanban:**

- [ ] BackupPanel não importar PagesContext diretamente
- [ ] Usar query invalidation ou custom event `backup:restored`
- [ ] Padrão replicável para cross-module refresh

---

### CARD ARCH-010 — Feature modules bundle boundaries


| Campo          | Valor                    |
| -------------- | ------------------------ |
| **ID**         | ARCH-010                 |
| **Prioridade** | P2                       |
| **Esforço**    | M                        |
| **Labels**     | arquitetura, performance |


**Subtarefas Kanban:**

- [ ] Cada módulo exporta apenas `ModuleRoutes` + `ModuleSidebarItems`
- [ ] App.tsx compõe módulos registrados
- [ ] Preparar para lazy registration (plugin pattern)
- [ ] Documentar contrato de módulo (README por pasta)

---

## Tópico: UX / Acessibilidade

---

### CARD UX-001 — Sidebar drawer acessível


| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | UX-001                                                                |
| **Prioridade** | P2                                                                    |
| **Esforço**    | M                                                                     |
| **Labels**     | ux, a11y                                                              |
| **Arquivos**   | `[App.tsx](src/App.tsx)`, `[Sidebar.tsx](src/components/Sidebar.tsx)` |


**Subtarefas Kanban:**

- [ ] Focus trap dentro do drawer quando aberto
- [ ] Escape fecha drawer
- [ ] `aria-expanded` no botão hamburger
- [ ] Return focus ao botão ao fechar
- [ ] `aria-modal="true"` no drawer
- [ ] Testar com NVDA/VoiceOver

---

### CARD UX-002 — Modais acessíveis (padrão unificado)


| Campo          | Valor    |
| -------------- | -------- |
| **ID**         | UX-002   |
| **Prioridade** | P2       |
| **Esforço**    | M        |
| **Labels**     | ux, a11y |


**Subtarefas Kanban:**

- [ ] Criar `AccessibleModal` base (role=dialog, aria-labelledby)
- [ ] Migrar FinancePanel Modal
- [ ] Migrar ProjectsPanel Modal
- [ ] Migrar SharePageModal
- [ ] Migrar ConfirmDeleteModal
- [ ] Focus trap + Escape em todos
- [ ] Seguir padrão já usado em WelcomeTour

---

### CARD UX-003 — Split view touch/mobile


| Campo          | Valor                                               |
| -------------- | --------------------------------------------------- |
| **ID**         | UX-003                                              |
| **Prioridade** | P2                                                  |
| **Esforço**    | S                                                   |
| **Labels**     | ux, mobile                                          |
| **Arquivos**   | `[MainContent.tsx](src/components/MainContent.tsx)` |


**Subtarefas Kanban:**

- [ ] Adicionar Pointer Events no drag divider
- [ ] Testar split em iOS Safari
- [ ] Fallback: tabs Note | Drawing em mobile (sem split)

---

### CARD UX-004 — Corrigir emojis corrompidos no PageHeader


| Campo          | Valor                                             |
| -------------- | ------------------------------------------------- |
| **ID**         | UX-004                                            |
| **Prioridade** | P2                                                |
| **Esforço**    | S                                                 |
| **Labels**     | ux, bug                                           |
| **Arquivos**   | `[PageHeader.tsx](src/components/PageHeader.tsx)` |


**Subtarefas Kanban:**

- [ ] Re-salvar arquivo UTF-8
- [ ] Substituir caracteres `` nos ICONS
- [ ] Validar render em Windows + Mac

---

### CARD UX-005 — Completar i18n (strings hardcoded)


| Campo          | Valor    |
| -------------- | -------- |
| **ID**         | UX-005   |
| **Prioridade** | P3       |
| **Esforço**    | S        |
| **Labels**     | ux, i18n |


**Subtarefas Kanban:**

- [ ] Mover banner daily login PT em AuthPage para translations
- [ ] Mover badges UserManagementPanel
- [ ] Mover "Loading canvas..." em DrawingCanvas
- [ ] Grep por strings PT/EN hardcoded restantes

---

### CARD UX-006 — Tabs WAI-ARIA em Finance e Projects


| Campo          | Valor    |
| -------------- | -------- |
| **ID**         | UX-006   |
| **Prioridade** | P3       |
| **Esforço**    | M        |
| **Labels**     | ux, a11y |


**Subtarefas Kanban:**

- [ ] `role="tablist"` nos tab containers
- [ ] `role="tab"` + `aria-selected`
- [ ] Roving tabindex (Arrow keys)
- [ ] `role="tabpanel"` no conteúdo

---

### CARD UX-007 — Feedback de erro visível ao usuário


| Campo          | Valor           |
| -------------- | --------------- |
| **ID**         | UX-007          |
| **Prioridade** | P2              |
| **Esforço**    | M               |
| **Labels**     | ux, reliability |


**Subtarefas Kanban:**

- [ ] Toast system global (sucesso/erro/info)
- [ ] PagesContext errors → toast (não só console)
- [ ] Save failures em NoteEditor/DrawingCanvas → banner
- [ ] Network offline → banner persistente

---

### CARD UX-008 — Melhorar onboarding e discoverability


| Campo          | Valor                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **ID**         | UX-008                                                                                               |
| **Prioridade** | P3                                                                                                   |
| **Esforço**    | M                                                                                                    |
| **Labels**     | ux, onboarding                                                                                       |
| **Arquivos**   | `[WelcomeTour.tsx](src/components/WelcomeTour.tsx)`, `[HelpPanel.tsx](src/components/HelpPanel.tsx)` |


**Subtarefas Kanban:**

- [ ] Tour por módulo (finance, projects) além do welcome
- [ ] Empty states com CTA em Dashboard
- [ ] Atalhos de teclado documentados no Help
- [ ] Highlight de features admin para novos admins

---

## Tópico: Confiabilidade

---

### CARD REL-001 — Backup restore transacional e seguro


| Campo          | Valor                                                             |
| -------------- | ----------------------------------------------------------------- |
| **ID**         | REL-001                                                           |
| **Prioridade** | P0                                                                |
| **Esforço**    | L                                                                 |
| **Labels**     | reliability, backup, crítico                                      |
| **Arquivos**   | `[site-backup/index.ts](supabase/functions/site-backup/index.ts)` |


**Problema:** Restore deleta todas as 24 tabelas e re-insere — falha parcial = DB corrompido.

**Subtarefas Kanban:**

- [ ] Backup automático antes de restore (snapshot)
- [ ] Restore em transação PostgreSQL (ou staging tables)
- [ ] Dry-run mode (validar JSON sem aplicar)
- [ ] Status `restoring` com lock UI
- [ ] Rollback automático em erro
- [ ] Teste de restore em ambiente staging
- [ ] Documentar procedimento de disaster recovery

---

### CARD REL-002 — Fila offline para saves de conteúdo


| Campo          | Valor                |
| -------------- | -------------------- |
| **ID**         | REL-002              |
| **Prioridade** | P2                   |
| **Esforço**    | L                    |
| **Labels**     | reliability, offline |


**Subtarefas Kanban:**

- [ ] Detectar `navigator.onLine`
- [ ] Banner offline global
- [ ] Queue IndexedDB para note/drawing saves
- [ ] Retry exponential backoff ao reconectar
- [ ] Indicador "salvo localmente / pendente sync"
- [ ] Conflict resolution ao voltar online

---

### CARD REL-003 — Rollback em optimistic updates


| Campo          | Valor                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **ID**         | REL-003                                                                                            |
| **Prioridade** | P2                                                                                                 |
| **Esforço**    | S                                                                                                  |
| **Labels**     | reliability                                                                                        |
| **Arquivos**   | `[PagesContext.tsx](src/contexts/PagesContext.tsx)`, `[TodoList.tsx](src/components/TodoList.tsx)` |


**Subtarefas Kanban:**

- [ ] deletePage: reverter árvore + toast em erro
- [ ] TodoList toggle: reverter checkbox em erro
- [ ] Padrão `try/catch` + snapshot pré-mutation

---

### CARD REL-004 — Colaboração: conflitos note/drawing


| Campo          | Valor                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| **ID**         | REL-004                                                                                                    |
| **Prioridade** | P2                                                                                                         |
| **Esforço**    | L                                                                                                          |
| **Labels**     | reliability, collab                                                                                        |
| **Arquivos**   | `[NoteEditor.tsx](src/components/NoteEditor.tsx)`, `[DrawingCanvas.tsx](src/components/DrawingCanvas.tsx)` |


**Subtarefas Kanban:**

- [ ] Banner "Editado por X — clique para atualizar"
- [ ] Avaliar Yjs/CRDT para BlockNote
- [ ] Avaliar Excalidraw collab mode
- [ ] Estender janela post-save protection ou version vector
- [ ] Teste E2E: 2 users editando mesma nota

---

### CARD REL-005 — Realtime em Projects (multi-user)


| Campo          | Valor                 |
| -------------- | --------------------- |
| **ID**         | REL-005               |
| **Prioridade** | P2                    |
| **Esforço**    | M                     |
| **Labels**     | reliability, projects |


**Subtarefas Kanban:**

- [ ] Subscribe `project_cards` + `project_columns` por board_id
- [ ] Merge remote changes sem perder draft local do modal
- [ ] Indicador "outro usuário moveu card"
- [ ] Debounce conflito com autosave 800ms

---

### CARD REL-006 — Notifications Realtime completo


| Campo          | Valor                                                               |
| -------------- | ------------------------------------------------------------------- |
| **ID**         | REL-006                                                             |
| **Prioridade** | P3                                                                  |
| **Esforço**    | S                                                                   |
| **Labels**     | reliability                                                         |
| **Arquivos**   | `[NotificationsContext.tsx](src/contexts/NotificationsContext.tsx)` |


**Subtarefas Kanban:**

- [ ] Subscribe UPDATE (mark read em outra tab)
- [ ] Subscribe DELETE
- [ ] Sync unread count em tempo real

---

### CARD REL-007 — Auto-backup só via cron (não browser)


| Campo          | Valor                                            |
| -------------- | ------------------------------------------------ |
| **ID**         | REL-007                                          |
| **Prioridade** | P2                                               |
| **Esforço**    | S                                                |
| **Labels**     | reliability, backup                              |
| **Arquivos**   | `[useSiteBackup.ts](src/hooks/useSiteBackup.ts)` |


**Subtarefas Kanban:**

- [ ] Remover trigger client-side de auto-backup
- [ ] Confiar em pg_cron + `check_auto_site_backup_due()`
- [ ] UI mostra próximo backup agendado
- [ ] Botão manual continua disponível

---

### CARD REL-008 — Health checks e monitoring


| Campo          | Valor                      |
| -------------- | -------------------------- |
| **ID**         | REL-008                    |
| **Prioridade** | P3                         |
| **Esforço**    | M                          |
| **Labels**     | reliability, observability |


**Subtarefas Kanban:**

- [ ] Error boundary global React
- [ ] Log structured errors (Sentry ou similar)
- [ ] Monitorar Supabase logs / advisors
- [ ] Alertas em backup failed
- [ ] Uptime check Netlify + Supabase

---

## Tópico: DevOps / Infra

---

### CARD DEV-001 — CI pipeline GitHub Actions


| Campo          | Valor      |
| -------------- | ---------- |
| **ID**         | DEV-001    |
| **Prioridade** | P1         |
| **Esforço**    | M          |
| **Labels**     | devops, ci |


**Subtarefas Kanban:**

- [ ] Workflow: lint + `tsc -b` + `vite build`
- [ ] Cache npm
- [ ] Fail on TypeScript errors
- [ ] Optional: Supabase migration lint
- [ ] Badge status no README

---

### CARD DEV-002 — Documentação de variáveis de ambiente


| Campo          | Valor        |
| -------------- | ------------ |
| **ID**         | DEV-002      |
| **Prioridade** | P1           |
| **Esforço**    | S            |
| **Labels**     | devops, docs |


**Subtarefas Kanban:**

- [ ] Criar `.env.example` com VITE_SUPABASE_*
- [ ] Documentar edge secrets (ALLOWED_ORIGINS, BACKUP_CRON_SECRET, etc.)
- [ ] Validação runtime em supabase.ts se env missing
- [ ] Seção deploy Netlify no README

---

### CARD DEV-003 — Gitignore de artefatos de deploy


| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | DEV-003          |
| **Prioridade** | P1               |
| **Esforço**    | S                |
| **Labels**     | devops, security |


**Subtarefas Kanban:**

- [ ] Adicionar `.deploy-*.json`, `.mcp-deploy*.json`, `deploy-out.json` ao .gitignore
- [ ] Remover do tracking se commitados
- [ ] Scan por secrets acidentais

---

### CARD DEV-004 — Ambiente local Supabase completo


| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | DEV-004          |
| **Prioridade** | P2               |
| **Esforço**    | M                |
| **Labels**     | devops, supabase |


**Subtarefas Kanban:**

- [ ] `supabase start` funcional com migrations
- [ ] Seed data script
- [ ] Documentar fluxo dev local
- [ ] Testar edge functions local (`supabase functions serve`)

---

### CARD DEV-005 — Pipeline deploy edge functions


| Campo          | Valor          |
| -------------- | -------------- |
| **ID**         | DEV-005        |
| **Prioridade** | P2             |
| **Esforço**    | M              |
| **Labels**     | devops, deploy |


**Subtarefas Kanban:**

- [ ] Script `deploy:functions` por ambiente
- [ ] CI deploy on tag release (optional)
- [ ] Versionamento sync frontend ↔ functions
- [ ] Smoke tests pós-deploy

---

### CARD DEV-006 — Preview deployments


| Campo          | Valor   |
| -------------- | ------- |
| **ID**         | DEV-006 |
| **Prioridade** | P3      |
| **Esforço**    | M       |
| **Labels**     | devops  |


**Subtarefas Kanban:**

- [ ] Netlify deploy previews por PR
- [ ] Supabase branch database (se plano permitir)
- [ ] Checklist QA em preview URL

---

### CARD DEV-007 — README do projeto (substituir boilerplate)


| Campo          | Valor        |
| -------------- | ------------ |
| **ID**         | DEV-007      |
| **Prioridade** | P3           |
| **Esforço**    | S            |
| **Labels**     | devops, docs |


**Subtarefas Kanban:**

- [ ] Descrição Akool/Excalinotion
- [ ] Setup local passo a passo
- [ ] Arquitetura resumida + link este plano
- [ ] Contribuição e convenções

---

### CARD DEV-008 — Dependabot / renovação de deps


| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | DEV-008          |
| **Prioridade** | P3               |
| **Esforço**    | S                |
| **Labels**     | devops, security |


**Subtarefas Kanban:**

- [ ] Dependabot para npm
- [ ] Audit `npm audit` no CI
- [ ] Pin major versions críticas (supabase-js, excalidraw)

---

## Tópico: Qualidade de código

---

### CARD QA-001 — TypeScript strict mode incremental


| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | QA-001                                   |
| **Prioridade** | P2                                       |
| **Esforço**    | M                                        |
| **Labels**     | quality, typescript                      |
| **Arquivos**   | `[tsconfig.app.json](tsconfig.app.json)` |


**Subtarefas Kanban:**

- [ ] Enable `strict: true` ou flags individuais
- [ ] Fix errors em core/ primeiro
- [ ] Fix errors em modules/
- [ ] CI fail on new `any`

---

### CARD QA-002 — ESLint type-aware


| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | QA-002                                 |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | quality, lint                          |
| **Arquivos**   | `[eslint.config.js](eslint.config.js)` |


**Subtarefas Kanban:**

- [ ] Adicionar `typescript-eslint` strict configs
- [ ] Fix violations existentes (batch por pasta)
- [ ] Pre-commit hook lint (optional)
- [ ] CI lint obrigatório

---

### CARD QA-003 — Testes unitários (Vitest)


| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | QA-003           |
| **Prioridade** | P2               |
| **Esforço**    | L                |
| **Labels**     | quality, testing |


**Subtarefas Kanban:**

- [ ] Setup Vitest + RTL
- [ ] Tests: AuthContext (signIn, is_active)
- [ ] Tests: PagesContext (CRUD optimistic)
- [ ] Tests: useCollaborativeContent merge logic
- [ ] Tests: mapBackupError, formatBackupSize
- [ ] Tests: getT interpolation
- [ ] Coverage mínimo 40% core/

---

### CARD QA-004 — Testes E2E (Playwright)


| Campo          | Valor        |
| -------------- | ------------ |
| **ID**         | QA-004       |
| **Prioridade** | P3           |
| **Esforço**    | L            |
| **Labels**     | quality, e2e |


**Subtarefas Kanban:**

- [ ] Setup Playwright
- [ ] Test: login + daily login flow
- [ ] Test: criar nota + save
- [ ] Test: admin backup list (mock ou staging)
- [ ] CI nightly E2E

---

### CARD QA-005 — Componente Modal/Sheet compartilhado


| Campo          | Valor        |
| -------------- | ------------ |
| **ID**         | QA-005       |
| **Prioridade** | P3           |
| **Esforço**    | M            |
| **Labels**     | quality, DRY |


**Subtarefas Kanban:**

- [ ] Extrair `SheetModal` de FinancePanel + ProjectsPanel
- [ ] Props: open, onClose, title, mobile/desktop layout
- [ ] Substituir duplicatas
- [ ] Reduzir ~200 LOC duplicadas

---

### CARD QA-006 — Tipar APIs Excalidraw/BlockNote


| Campo          | Valor                                   |
| -------------- | --------------------------------------- |
| **ID**         | QA-006                                  |
| **Prioridade** | P3                                      |
| **Esforço**    | M                                       |
| **Labels**     | quality, types                          |
| **Arquivos**   | DrawingCanvas, DiagramBlock, NoteEditor |


**Subtarefas Kanban:**

- [ ] Remover `eslint-disable @typescript-eslint/no-explicit-any`
- [ ] Wrappers tipados para Excalidraw API
- [ ] Tipos BlockNote content blocks

---

### CARD QA-007 — Alinhar naming Akool vs Excalinotion


| Campo          | Valor                |
| -------------- | -------------------- |
| **ID**         | QA-007               |
| **Prioridade** | P3                   |
| **Esforço**    | S                    |
| **Labels**     | quality, consistency |


**Subtarefas Kanban:**

- [ ] Decidir nome oficial (Akool)
- [ ] Alinhar package.json, localStorage keys (breaking?)
- [ ] Documentar aliases históricos

---

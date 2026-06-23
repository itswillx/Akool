# Backlog Akool — Arquitetura / Modularização

> 10 cards · BacklogCard v1 · Importar via Projects → Importar

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

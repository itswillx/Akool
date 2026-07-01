# Backlog Akool — Plano de Execução (milestones)

> 6 cards · BacklogCard v1 · Importar via Projects → Importar
> Tracker do roadmap. As subtarefas apontam os cards a executar em cada fase
> (importe `backlog-resto.md` + `backlog-card-sample.md` para os cards detalhados).

## Tópico: Planejamento / Execução

---

### CARD PLAN-001 — Executar Semana 1: fundação segura e fim da exposição de dados (P0)

| Campo          | Valor                                          |
| -------------- | ---------------------------------------------- |
| **ID**         | PLAN-001                                       |
| **Prioridade** | P0                                             |
| **Esforço**    | L                                              |
| **Labels**     | planejamento, execução, segurança, p0          |
| **Arquivos**   | `docs/plano-execucao.md`, `supabase/migrations/` |

**Problema:** O maior risco é dado exposto por RLS frágil e banco não versionado no Git. Esta fase fecha a exposição P0 e monta a base (stack local + CI) para iterar com segurança.

**Subtarefas Kanban:**

- [ ] SEC-001 — Versionar schema completo e políticas RLS
- [ ] ARCH-007 — Adicionar supabase/config.toml
- [ ] DEV-004 — Ambiente local Supabase completo
- [ ] DEV-002 — Documentar variáveis de ambiente
- [ ] DEV-003 — Gitignore de artefatos de deploy
- [ ] DEV-001 — CI pipeline GitHub Actions
- [ ] SEC-003 — Migrar buckets públicos para acesso privado

---

### CARD PLAN-002 — Executar Semana 2: controle de acesso (admin, segredos e auth)

| Campo          | Valor                                                              |
| -------------- | ------------------------------------------------------------------ |
| **ID**         | PLAN-002                                                           |
| **Prioridade** | P0                                                                 |
| **Esforço**    | L                                                                  |
| **Labels**     | planejamento, execução, segurança, auth                            |
| **Arquivos**   | `supabase/functions/`, `src/components/UserManagementPanel.tsx`    |

**Problema:** Ações de admin e leitura de segredos precisam ser verificadas no servidor, não no client. Esta fase move ações sensíveis para edge functions e protege chaves e segredos.

**Subtarefas Kanban:**

- [ ] ARCH-008 — Decidir destino das edge functions órfãs (gateia SEC-004)
- [ ] SEC-004 — Proteger chaves de IA em profiles
- [ ] SEC-002 — Adicionar edge function admin-ops ao repositório
- [ ] SEC-008 — Mover ações admin sensíveis para edge function
- [ ] SEC-005 — Corrigir fluxo de invite codes (atomicidade)
- [ ] SEC-006 — Endurecer sessão (daily login + usuários inativos)
- [ ] SEC-009 — Padronizar CORS em todas edge functions
- [ ] SEC-010 — Auditar uso de service role

---

### CARD PLAN-003 — Executar Semana 3: confiabilidade de dados e performance percebida

| Campo          | Valor                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **ID**         | PLAN-003                                                                                          |
| **Prioridade** | P1                                                                                                |
| **Esforço**    | L                                                                                                 |
| **Labels**     | planejamento, execução, confiabilidade, performance                                               |
| **Arquivos**   | `supabase/functions/site-backup/index.ts`, `src/modules/finance/FinancePanel.tsx`, `src/contexts/PagesContext.tsx` |

**Problema:** O restore de backup deleta e re-insere todas as tabelas (risco de DB corrompido) e o Finance recarrega tudo a cada ação. Esta fase torna o restore transacional e elimina recargas caras.

**Subtarefas Kanban:**

- [ ] REL-001 — Backup restore transacional e seguro
- [ ] REL-007 — Auto-backup só via cron (não browser)
- [ ] REL-003 — Rollback em optimistic updates
- [ ] PERF-001 — Paginar transações financeiras
- [ ] PERF-003 — Otimizar PagesContext refresh
- [ ] PERF-002 — Eliminar reload completo no FinancePanel

---

### CARD PLAN-004 — Executar Sprint 4: modularização e escala

| Campo          | Valor                                                              |
| -------------- | ------------------------------------------------------------------ |
| **ID**         | PLAN-004                                                           |
| **Prioridade** | P1                                                                 |
| **Esforço**    | L                                                                  |
| **Labels**     | planejamento, execução, arquitetura, performance                   |
| **Arquivos**   | `src/modules/`, `src/components/ProjectsPanel.tsx`, `vite.config.ts` |

**Problema:** Componentes gigantes e ausência de fronteiras de módulo travam a escala. Finance e backup já viraram módulos; esta fase completa a estrutura e divide os painéis grandes.

**Subtarefas Kanban:**

- [ ] ARCH-001 — Criar estrutura de pastas modular (core, projects, workspace, admin)
- [ ] PERF-004 — Dividir FinancePanel em submódulos
- [ ] PERF-005 — Dividir ProjectsPanel
- [ ] ARCH-002 — Camada de repositórios Supabase
- [ ] ARCH-004 — Gerar tipos TypeScript do Supabase
- [ ] ARCH-010 — Feature modules bundle boundaries
- [ ] PERF-006 — Lazy load i18n e help content
- [ ] PERF-008 — Lazy load modals e Excalidraw inline
- [ ] PERF-009 — Vite build optimization (decidir react-router / ARCH-003)

---

### CARD PLAN-005 — Executar Sprint 5: colaboração robusta e qualidade

| Campo          | Valor                                                                       |
| -------------- | --------------------------------------------------------------------------- |
| **ID**         | PLAN-005                                                                    |
| **Prioridade** | P2                                                                          |
| **Esforço**    | L                                                                           |
| **Labels**     | planejamento, execução, confiabilidade, qualidade                           |
| **Arquivos**   | `src/hooks/`, `src/contexts/`, `eslint.config.js`, `tsconfig.app.json`      |

**Problema:** Edição multiusuário ainda tem conflitos e faltam gates de qualidade automatizados. Esta fase unifica o padrão de realtime e liga lint, tipos e testes ao CI.

**Subtarefas Kanban:**

- [ ] REL-004 — Colaboração: conflitos note/drawing
- [ ] REL-005 — Realtime em Projects (multi-user)
- [ ] PERF-007 — Otimizar Realtime e presence
- [ ] REL-002 — Fila offline para saves de conteúdo
- [ ] QA-001 — TypeScript strict mode incremental
- [ ] QA-002 — ESLint type-aware
- [ ] QA-003 — Testes unitários (Vitest)
- [ ] QA-005 — Componente Modal/Sheet compartilhado
- [ ] SEC-011 — Endurecer CSP e headers Netlify
- [ ] SEC-012 — Rate limiting em RPCs e edge functions
- [ ] PERF-010 — Compressão e resize de imagens no upload
- [ ] PERF-011 — Debounce padronizado em buscas

---

### CARD PLAN-006 — Executar Sprint 6: polish e itens P3

| Campo          | Valor                                                       |
| -------------- | ----------------------------------------------------------- |
| **ID**         | PLAN-006                                                    |
| **Prioridade** | P3                                                          |
| **Esforço**    | L                                                           |
| **Labels**     | planejamento, execução, ux, p3                              |
| **Arquivos**   | `src/components/`, `src/pages/`, `docs/plano-execucao.md`   |

**Problema:** Itens de menor risco (a11y, onboarding, routing, observabilidade, docs) ficam para o fim. Esta fase agrupa o polish e os P3 contínuos.

**Subtarefas Kanban:**

- [ ] UX-001..004 — a11y de drawer/modais, split mobile, emojis do PageHeader
- [ ] UX-005..008 — i18n restante, tabs WAI-ARIA, toast de erro, onboarding
- [ ] ARCH-003 — Implementar React Router (ou remover react-router-dom)
- [ ] ARCH-005 — Desacoplar providers (feature flags)
- [ ] ARCH-006 — Normalizar paths duplicados no Git (Windows)
- [ ] ARCH-009 — Event bus / invalidação desacoplada
- [ ] REL-006 — Notifications Realtime completo
- [ ] REL-008 — Health checks e monitoring
- [ ] DEV-005..006 — Deploy de edge functions + preview deployments
- [ ] DEV-007..008 — README do projeto + Dependabot
- [ ] QA-004 — Testes E2E (Playwright)
- [ ] QA-006..007 — Tipar APIs Excalidraw/BlockNote + alinhar naming

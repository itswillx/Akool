# Backlog Akool — DevOps / Infra

> 8 cards · BacklogCard v1 · Importar via Projects → Importar

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

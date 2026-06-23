# Backlog Akool — Qualidade de código

> 7 cards · BacklogCard v1 · Importar via Projects → Importar

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

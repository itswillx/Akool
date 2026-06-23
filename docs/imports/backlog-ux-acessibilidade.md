# Backlog Akool — UX / Acessibilidade

> 8 cards · BacklogCard v1 · Importar via Projects → Importar

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

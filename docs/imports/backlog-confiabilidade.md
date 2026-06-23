# Backlog Akool — Confiabilidade

> 8 cards · BacklogCard v1 · Importar via Projects → Importar

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

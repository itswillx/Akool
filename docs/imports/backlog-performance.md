# Backlog Akool — Performance

> 12 cards · BacklogCard v1 · Importar via Projects → Importar

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

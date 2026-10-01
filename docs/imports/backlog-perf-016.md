# Backlog Akool: Projetos no react-query (saiu do PERF-015)

> 1 card no formato BacklogCard v1. Importar em Projetos → Importar, no quadro da auditoria 2026-09.
> Separado do PERF-015 em 01/10/2026, por decisão do usuário: primeiro a base e o Dashboard (lote 19), depois Projetos, que tem arrastar, otimismo e realtime próprios.

## Tópico: Performance

### CARD PERF-016 — Migrar o carregamento de Projetos para o react-query

| Campo          | Valor                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- |
| **ID**         | PERF-016                                                                                      |
| **Prioridade** | P3                                                                                            |
| **Esforço**    | M                                                                                             |
| **Labels**     | performance, projetos, cache                                                                  |
| **Arquivos**   | `src/modules/projects/useBoardData.ts`, `src/modules/projects/boardLoader.ts`, `src/lib/queryClient.ts` |

**Problema:** O PERF-015 colocou o react-query no Dashboard (`src/lib/queryClient.ts`, chaves `dashboardKeys`). Projetos ainda recarrega quadros, colunas, cards, membros e fila a cada troca de quadro ou volta à seção, com estado de loading, erro e retry à mão em `useBoardData`. A troca de quadro sem corrida (REL-006), o merge do realtime sem perder o arrasto (REL-010) e as escritas otimistas (REL-004, PERF-004) precisam continuar valendo.

**Subtarefas Kanban:**

- [ ] `useQuery` por quadro (`['projects', boardId]`) usando o `boardLoader` atual, com o cache por quadro
- [ ] Escritas otimistas via `queryClient.setQueryData` + rollback, mantendo `runOptimistic`
- [ ] Realtime do quadro invalidando ou mesclando no cache, sem interromper um arrasto em andamento
- [ ] Provider do react-query num ponto comum (sem entrar no boot: conferir o orçamento do PERF-012)
- [ ] Rodar o E2E de quadro (`e2e/app/board.spec.ts`) antes e depois

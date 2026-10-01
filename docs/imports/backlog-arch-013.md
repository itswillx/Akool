# Backlog Akool: unificação dos kanbans (saiu do ARCH-002)

> 1 card no formato BacklogCard v1. Importar em Projetos → Importar, no quadro da auditoria 2026-09.
> Separado do ARCH-002 em 30/09/2026, por decisão do usuário: primeiro quebrar o arquivo, depois unificar com o E2E de mover card rodando.

## Tópico: Arquitetura

### CARD ARCH-013 — Unificar o kanban do ProjectsPanel com o components/board

| Campo          | Valor                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| **ID**         | ARCH-013                                                                                   |
| **Prioridade** | P3                                                                                         |
| **Esforço**    | M                                                                                          |
| **Labels**     | arquitetura, projetos, refactor                                                            |
| **Arquivos**   | `src/modules/projects/board/`, `src/modules/projects/useBoardDnd.ts`, `src/components/board/` |

**Problema:** Existem dois kanbans. O de `src/components/board/` (`KanbanBoard`, `BoardColumn`, `BoardCard`) serve os quadros do financeiro (Loja e Meus projetos). O do ProjectsPanel (`src/modules/projects/board/Column.tsx` e `Card.tsx`, com o arrastar em `useBoardDnd.ts`) tem recursos que o outro não tem: reordenar colunas, limite WIP, modo compacto com mover para a coluna anterior/seguinte e o selo da fila. Cada correção de acessibilidade ou de arrastar precisa ser feita duas vezes.

**Subtarefas Kanban:**

- [ ] Levar reordenar colunas, limite WIP, modo compacto e selo da fila para `components/board`
- [ ] Trocar o kanban do ProjectsPanel pelo componente comum, mantendo `lib/boardMoves.ts`
- [ ] Rodar o E2E de mover card (`e2e/app/board.spec.ts`) antes e depois
- [ ] Apagar `src/modules/projects/board/` quando não tiver mais uso

# Módulo de Projetos

Mini-app de quadros kanban montado dentro da visão Documentos
(`DocumentsPanel` → seção "Projetos", lazy-loaded via o barrel `index.ts`).
Era um painel irmão de Documentos (`activePanel: 'projects'` + modo
`'projects'` na barra superior); a migração das chaves legadas vive em
`src/lib/docsNavigation.ts` e roda uma vez no boot (`main.tsx`).

## Estrutura

- `ProjectsPanel.tsx` — orquestrador: quadros, colunas, cards, os cinco modos de
  visualização e todos os modais. Grande de propósito por enquanto — a divisão é
  o card PERF-005, fora do escopo da migração de navegação.
- `ProjectsNav.tsx` — a faixa lateral (desktop) / chips de visualização (mobile),
  no padrão do `modules/study/StudyNav.tsx`.
- `CardFilterBar.tsx`, `GanttView.tsx`, `ImportCardsModal.tsx`, `QueueModal.tsx`
  — usados só pelo painel. `ModalShell.tsx` é a casca comum dos modais do módulo.

## Fila de desenvolvimento (IA)

- Tabela `project_card_queue` + RPCs `cq_*`
  (`supabase/migrations/20260925123814_project_card_queue_api.sql`). Toda escrita
  passa pelas RPCs; o app só lê a tabela (selos no kanban + realtime).
- O app monta a fila no `QueueModal` (colunas, urgência, cards) e pelo botão
  "Adicionar à fila" do card. A IA consome pela edge `cards-api`, autenticada
  por token pessoal (Configurações → API), via `npm run cards` / skill `/fila`.
- `cq_next` move o card para a coluna "Fazendo" e `cq_complete` para
  "Concluído", achadas pelo nome; sem essas colunas o card fica onde está.
- Espelho da ordenação para a prévia do modal: `src/lib/cardQueue.ts`
  (`previewQueueOrder`). Mudou a ordem no SQL, mude lá também.

## Regras

- **Entrada pública:** `index.ts`. Importe por `../modules/projects`.
- Depende apenas de infraestrutura compartilhada (`contexts/`, `i18n/`, `lib/`,
  `hooks/`, `components/` neutros). Nada do módulo financeiro importa daqui e
  vice-versa — a fronteira do `modules/finance/README.md` vale nos dois sentidos.
- Navegar para uma página vinculada a um card passa pela prop `onOpenPage`
  quando o host fornece (DocumentsPanel resolve dentro da própria visão);
  `setActivePage` é só o fallback autônomo.
- **Não renomear chaves de storage** (`projects_view`, `projects_active_board`,
  `projects_open_card`, `projects_compact_column:*`, `projects_card_draft:*`,
  `projects_card_modal_state`, `projects_gantt_zoom:*`) — é estado vivo de
  usuário; deep links do Dashboard/QuickNotes gravam essas chaves antes de
  trocar a seleção de Documentos.
- Strings novas sempre em pt-BR **e** en (`src/i18n/translations.ts` tem teste
  de paridade).

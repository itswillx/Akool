// Board genérico e sem domínio: colunas, cards, drag-and-drop, busca,
// ordenação e chips de visibilidade. Não conhece finanças nem o kanban de
// tarefas (`ProjectsPanel`) — é infraestrutura compartilhada, e é por isso que
// o módulo financeiro pode importá-lo sem furar a fronteira declarada no seu
// README.

export { KanbanBoard, type BoardSortOption, type KanbanBoardProps } from './KanbanBoard'
export { BoardStepper } from './BoardStepper'
export { useBoardPrefs, type BoardPrefs, type BoardView } from './useBoardPrefs'
export {
  aggregate, columnDroppableId, filterBySearch, groupByColumn,
  neighborColumnId, normalizeSearch, resolveDropColumnId, visibleColumns,
  type BoardColumnDef, type ColumnAggregate,
} from './boardModel'

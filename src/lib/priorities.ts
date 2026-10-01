import type { ProjectCardPriority, TodoPriority } from '../types'

// QA-004: a prioridade dos cards de projeto e das tarefas num lugar só. Antes,
// a ordem, as cores e as chaves de tradução viviam em 9 cópias (kanban, fila,
// filtros, importação, bloco de card, PDF, tarefas).

/** Da mais urgente para a menos (ordem de exibição e de desempate). */
export const PROJECT_PRIORITIES: readonly ProjectCardPriority[] = ['urgent', 'high', 'medium', 'low']

export const PROJECT_PRIORITY_COLORS: Record<ProjectCardPriority, string> = {
  low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
}

export function isProjectPriority(value: string): value is ProjectCardPriority {
  return (PROJECT_PRIORITIES as readonly string[]).includes(value)
}

export function projectPriorityLabelKey(priority: ProjectCardPriority): `projects_priority_${ProjectCardPriority}` {
  return `projects_priority_${priority}`
}

/** As tarefas têm 3 níveis e a sua própria paleta. */
export const TODO_PRIORITIES: readonly TodoPriority[] = ['high', 'medium', 'low']

export const TODO_PRIORITY_COLORS: Record<TodoPriority, string> = {
  low: '#6b7280', medium: '#0ea5e9', high: '#ef4444',
}

export function todoPriorityLabelKey(priority: TodoPriority): `todo_priority_${TodoPriority}` {
  return `todo_priority_${priority}`
}

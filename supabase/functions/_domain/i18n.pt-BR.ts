// Dicionário pt-BR do _domain. Os módulos puros não podem importar o i18n do
// app (src/i18n), então os textos que eles produzem (Markdown de card, avisos
// de importação) moram aqui. Cada chave tem o mesmo texto no app: o teste de
// paridade em src/lib/projectDomain.test.ts confere.
//
// A interpolação é a mesma do getT do app (src/i18n/translations.ts): {nome}
// vira o valor, numa passada só, e um placeholder sem valor fica como está.

export const DOMAIN_PT_BR = {
  // Markdown do card (cardMarkdown, API-027): as mesmas chaves do app.
  projects_new_card: 'Novo card',
  projects_table_column: 'Coluna',
  projects_priority: 'Prioridade',
  projects_priority_urgent: 'Urgente',
  projects_priority_high: 'Alta',
  projects_priority_medium: 'Média',
  projects_priority_low: 'Baixa',
  projects_assignee: 'Responsável',
  projects_unassigned: 'Sem responsável',
  projects_start_date: 'Início',
  projects_due_date: 'Prazo',
  projects_estimated_days: 'Duração estimada (dias)',
  projects_labels: 'Etiquetas',
  projects_parent_task: 'Tarefa-pai',
  projects_dependencies: 'Dependências',
  projects_card_completed: 'Concluído',
  projects_card_description: 'Descrição',
  projects_checklist: 'Checklist',
  projects_links: 'Links',
  projects_attachments: 'Imagens',
  // Avisos do parser de backlog na tela de importação (backlogIssueText, API-027).
  // Cada BacklogIssueCode, ImportWarningCode e ImportIssueCode tem a sua chave (o tsc confere).
  projects_import_issue_invalid_heading: 'Bloco ignorado: cabeçalho CARD inválido ou ausente',
  projects_import_issue_id_mismatch: '{id}: o ID da tabela ({detail}) é diferente do cabeçalho',
  projects_import_issue_no_subtasks: '{id}: nenhuma subtarefa encontrada',
  projects_import_issue_no_priority: '{id}: sem prioridade, usando média',
  projects_import_issue_no_effort: '{id}: sem esforço',
  projects_import_issue_no_topic: '{id}: sem seção Tópico',
  projects_import_issue_duplicate_id: '{id}: ID repetido, só a primeira ocorrência entra',
  projects_import_issue_no_cards: 'Nenhum card encontrado no arquivo',
  // Depende de (API-033): avisos do parser e do plano (importWarningText).
  projects_import_issue_invalid_dependency: '{id}: "{detail}" em Depende de não é um ID de card e ficou de fora',
  projects_import_issue_self_dependency: '{id}: o card depende de si mesmo, e a dependência ficou de fora',
  projects_import_warning_dependency_not_found: '{id}: a dependência {detail} não está no arquivo nem no quadro e ficou de fora',
  projects_import_warning_dependency_not_applied: '{id}: já está no quadro, então as dependências {detail} não foram gravadas nele',
  // O que impede a importação (importIssueText, API-033): {max} é o limite.
  projects_import_error_no_column: '{id}: sem coluna de destino',
  projects_import_error_checklist_too_many: '{id}: mais de {max} subtarefas',
  projects_import_error_checklist_text_too_long: '{id}: subtarefa com mais de {max} caracteres',
  projects_import_error_dependency_cycle: '{id}: dependência em ciclo ({detail})',
  projects_import_error_depends_on_too_many: '{id}: mais de {max} dependências',
} as const satisfies Record<string, string>

export type DomainKey = keyof typeof DOMAIN_PT_BR
export type DomainT = (key: DomainKey, vars?: Record<string, string | number>) => string

/**
 * API-027: o `t` de um módulo que só usa as chaves `K` (o Markdown do card, os
 * avisos da importação). O tPtBR serve, e o `t` do app também, desde que as `K`
 * existam no app (src/lib/projectDomain.test.ts confere pelo tsc).
 */
export type DomainTFor<K extends DomainKey> = (key: K, vars?: Record<string, string | number>) => string

/** O `t` do _domain em pt-BR. O `t` do app também serve onde as chaves existem nos dois. */
export const tPtBR: DomainT = (key, vars) => {
  const str: string = DOMAIN_PT_BR[key]
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match))
}

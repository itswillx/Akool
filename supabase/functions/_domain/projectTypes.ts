// API-027: os tipos de Projetos que os módulos de _domain usam (agenda,
// estatísticas, importação, Markdown do card). _domain não importa src/types:
// src/lib/projectDomain.test.ts confere, pelo tsc, que estes tipos e os do app
// continuam iguais.
//
// A linha de project_cards que vem do banco tem priority em texto e labels,
// checklist e links em JSON. Quem chama o domínio (o handler da API) estreita
// esses campos antes e recusa prioridade fora das quatro (isProjectPriority):
// uma prioridade desconhecida ordenaria primeiro na agenda, sem aviso.

export type ProjectCardPriority = 'low' | 'medium' | 'high' | 'urgent'

/** Da mais urgente para a menos (ordem de exibição e de desempate). */
export const PROJECT_PRIORITIES: readonly ProjectCardPriority[] = ['urgent', 'high', 'medium', 'low']

export function isProjectPriority(value: string): value is ProjectCardPriority {
  return (PROJECT_PRIORITIES as readonly string[]).includes(value)
}

export interface ProjectChecklistItem {
  id: string
  text: string
  completed: boolean
  /** Item que só o usuário pode fazer (fila: card "Aguardando você"). */
  owner?: 'user'
}

export interface ProjectCardLinkItem {
  id: string
  url: string
  title: string
}

export interface ProjectCardAttachmentItem {
  id: string
  url: string
  name: string
}

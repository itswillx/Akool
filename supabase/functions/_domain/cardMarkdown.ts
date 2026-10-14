// Serializa um card do kanban como Markdown, para colar em outra ferramenta
// (chat de IA, issue, editor). Puro e sem React/Supabase, como cardLinks.ts, para
// ser testável — os rótulos entram por `t` em vez de virem de um contexto.
// API-027: mora em _domain (a API exporta o mesmo Markdown). O app passa o seu
// `t`; a API passa o tPtBR de ./i18n.pt-BR.ts.

import { linkDisplay } from './cardLinks.ts'
import type { DomainTFor } from './i18n.pt-BR.ts'
import type {
  ProjectCardAttachmentItem as ProjectCardAttachment,
  ProjectCardLinkItem as ProjectCardLink,
  ProjectCardPriority,
  ProjectChecklistItem as ProjectCardChecklistItem,
} from './projectTypes.ts'

/** As chaves que o Markdown do card usa (todas existem também no app). */
export type CardMarkdownKey =
  | 'projects_new_card' | 'projects_table_column' | 'projects_priority' | `projects_priority_${ProjectCardPriority}`
  | 'projects_assignee' | 'projects_unassigned' | 'projects_start_date' | 'projects_due_date'
  | 'projects_estimated_days' | 'projects_labels' | 'projects_parent_task' | 'projects_dependencies'
  | 'projects_card_completed' | 'projects_card_description' | 'projects_checklist' | 'projects_links'
  | 'projects_attachments'

type TFn = DomainTFor<CardMarkdownKey>

// Satisfeito estruturalmente tanto por ProjectCard quanto pelo CardForm do
// CardModal — copiar do formulário leva junto as edições ainda não salvas.
export interface CardMarkdownSource {
  title: string
  description: string
  priority: ProjectCardPriority
  start_date: string | null
  due_date: string | null
  estimated_days: number
  labels: string[]
  completed: boolean
  checklist: ProjectCardChecklistItem[]
  links: ProjectCardLink[]
  attachments: ProjectCardAttachment[]
}

// Nomes que o card guarda só por id — quem chama resolve com o que tem em mãos.
export interface CardMarkdownContext {
  columnName?: string | null
  assigneeName?: string | null
  parentTitle?: string | null
  dependencyTitles?: string[]
}

function metaLine(label: string, value: string): string {
  return `- **${label}:** ${value}`
}

export function formatCardAsMarkdown(
  card: CardMarkdownSource,
  ctx: CardMarkdownContext,
  t: TFn,
): string {
  const blocks: string[] = []

  const title = (card.title ?? '').trim() || t('projects_new_card')
  blocks.push(`# ${title}`)

  const meta: string[] = []
  if (ctx.columnName) meta.push(metaLine(t('projects_table_column'), ctx.columnName))
  meta.push(metaLine(
    t('projects_priority'),
    t(`projects_priority_${card.priority}`),
  ))
  meta.push(metaLine(t('projects_assignee'), ctx.assigneeName?.trim() || t('projects_unassigned')))
  if (card.start_date) meta.push(metaLine(t('projects_start_date'), card.start_date))
  if (card.due_date) meta.push(metaLine(t('projects_due_date'), card.due_date))
  meta.push(metaLine(t('projects_estimated_days'), String(card.estimated_days)))
  const labels = (card.labels ?? []).map(l => l.trim()).filter(Boolean)
  if (labels.length > 0) meta.push(metaLine(t('projects_labels'), labels.join(', ')))
  if (ctx.parentTitle) meta.push(metaLine(t('projects_parent_task'), ctx.parentTitle))
  const deps = (ctx.dependencyTitles ?? []).filter(Boolean)
  if (deps.length > 0) meta.push(metaLine(t('projects_dependencies'), deps.join(', ')))
  if (card.completed) meta.push(`- **${t('projects_card_completed')}**`)
  blocks.push(meta.join('\n'))

  const description = (card.description ?? '').trim()
  if (description) {
    blocks.push(`## ${t('projects_card_description')}\n\n${description}`)
  }

  const checklist = card.checklist ?? []
  if (checklist.length > 0) {
    const done = checklist.filter(i => i.completed).length
    const items = checklist
      .map(i => `- [${i.completed ? 'x' : ' '}] ${i.text}`)
      .join('\n')
    blocks.push(`## ${t('projects_checklist')} (${done}/${checklist.length})\n\n${items}`)
  }

  const links = card.links ?? []
  if (links.length > 0) {
    const items = links.map(l => `- [${linkDisplay(l)}](${l.url})`).join('\n')
    blocks.push(`## ${t('projects_links')}\n\n${items}`)
  }

  // Só os nomes: attachment.url aponta para o bucket privado project-card-images
  // e só abre via URL assinada — colar esse caminho fora do app não serve de nada.
  const attachments = card.attachments ?? []
  if (attachments.length > 0) {
    const items = attachments.map(a => `- ${a.name}`).join('\n')
    blocks.push(`## ${t('projects_attachments')}\n\n${items}`)
  }

  return blocks.join('\n\n')
}

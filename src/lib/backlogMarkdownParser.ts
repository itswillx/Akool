import type { ProjectCardChecklistItem, ProjectCardPriority } from '../types'

export interface ParsedBacklogCard {
  externalId: string
  title: string
  fullTitle: string
  topic: string | null
  priority: ProjectCardPriority
  effort: 'S' | 'M' | 'L' | null
  labels: string[]
  description: string
  checklist: ProjectCardChecklistItem[]
  files: string[]
}

// UX-011: cada aviso também sai estruturado (código + card), para a tela de
// importação traduzir. `warnings` continua em português para a CLI
// (scripts/import-backlog-cards.ts).
export type BacklogIssueCode =
  | 'invalid_heading' | 'id_mismatch' | 'no_subtasks' | 'no_priority'
  | 'no_effort' | 'no_topic' | 'duplicate_id' | 'no_cards'

export interface BacklogIssue {
  code: BacklogIssueCode
  cardId?: string
  /** id_mismatch: o ID da tabela. */
  detail?: string
}

export interface ParseResult {
  cards: ParsedBacklogCard[]
  warnings: string[]
  issues: BacklogIssue[]
  topics: string[]
}

const ISSUE_TEXT: Record<BacklogIssueCode, (i: BacklogIssue) => string> = {
  invalid_heading: () => 'Bloco ignorado: heading CARD inválido ou ausente',
  id_mismatch: i => `${i.cardId}: ID na tabela (${i.detail}) difere do heading`,
  no_subtasks: i => `${i.cardId}: nenhuma subtarefa encontrada`,
  no_priority: i => `${i.cardId}: prioridade ausente — usando medium`,
  no_effort: i => `${i.cardId}: esforço ausente`,
  no_topic: i => `${i.cardId}: sem seção Tópico associada`,
  duplicate_id: i => `${i.cardId}: ID duplicado — apenas a primeira ocorrência será importada`,
  no_cards: () => 'Nenhum card encontrado no arquivo',
}

interface Report {
  warnings: string[]
  issues: BacklogIssue[]
}

function warn(report: Report, issue: BacklogIssue) {
  report.issues.push(issue)
  report.warnings.push(ISSUE_TEXT[issue.code](issue))
}

const CARD_HEADING_RE = /^###\s+CARD\s+([A-Z]{2,5}-\d{3})\s+[—-]\s+(.+)$/m
const TOPIC_RE = /^##\s+(?:\d+\.\s+)?Tópico:\s*(.+)$/im
const SUBTASKS_MARKER_RE = /^\*\*Subtarefas Kanban:\*\*\s*$/im
const CHECKLIST_ITEM_RE = /^-\s+\[([ xX])\]\s+(.+)$/
const TABLE_ROW_RE = /^\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|\s*(.+?)\s*\|$/
const LIST_META_RE = /^-\s+\*{0,2}([^:*]+?):\*{0,2}\s*(.+)$/
const PROBLEM_RE = /^\*\*Problema:\*\*\s*(.+)$/im
const CONTEXT_RE = /^\*\*Contexto:\*\*\s*([\s\S]+?)(?=^\*\*Subtarefas|\n---|\n###\s+CARD|\s*$)/im

const PRIORITY_MAP: Record<string, ProjectCardPriority> = {
  P0: 'urgent',
  P1: 'high',
  P2: 'medium',
  P3: 'low',
}

function normalizeFieldName(raw: string): string {
  return raw.replace(/\*\*/g, '').trim().toLowerCase()
}

function parseLabels(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.replace(/`/g, '').trim().toLowerCase())
    .filter(Boolean)
}

function parseFiles(raw: string): string[] {
  const matches = raw.match(/`([^`]+)`/g)
  if (matches) return matches.map(m => m.replace(/`/g, '').trim())
  return raw.split(',').map(s => s.replace(/`/g, '').trim()).filter(Boolean)
}

function mapPriority(raw: string | undefined): ProjectCardPriority {
  if (!raw) return 'medium'
  const key = raw.trim().toUpperCase()
  return PRIORITY_MAP[key] ?? 'medium'
}

function parseEffort(raw: string | undefined): 'S' | 'M' | 'L' | null {
  if (!raw) return null
  const v = raw.trim().toUpperCase()
  return v === 'S' || v === 'M' || v === 'L' ? v : null
}

function parseMetadata(block: string): Record<string, string> {
  const meta: Record<string, string> = {}
  const lines = block.split('\n')

  for (const line of lines) {
    const tableMatch = line.match(TABLE_ROW_RE)
    if (tableMatch) {
      const field = normalizeFieldName(tableMatch[1])
      if (field === 'campo' || field.startsWith('---')) continue
      meta[field] = tableMatch[2].replace(/\*\*/g, '').trim()
      continue
    }
    const listMatch = line.match(LIST_META_RE)
    if (listMatch) {
      meta[normalizeFieldName(listMatch[1])] = listMatch[2].replace(/\*\*/g, '').trim()
    }
  }

  return meta
}

function parseChecklist(block: string): ProjectCardChecklistItem[] {
  const markerMatch = block.match(SUBTASKS_MARKER_RE)
  const startIdx = markerMatch?.index != null ? markerMatch.index + markerMatch[0].length : 0
  const tail = block.slice(startIdx)
  const items: ProjectCardChecklistItem[] = []

  for (const line of tail.split('\n')) {
    const m = line.match(CHECKLIST_ITEM_RE)
    if (!m) {
      if (items.length > 0 && line.trim() && !line.startsWith('-')) break
      continue
    }
    items.push({
      id: crypto.randomUUID(),
      text: m[2].trim(),
      completed: m[1].toLowerCase() === 'x',
    })
  }

  return items
}

function buildDescription(
  problem: string | null,
  effort: 'S' | 'M' | 'L' | null,
  files: string[],
  context: string | null,
): string {
  const parts: string[] = []
  if (problem) parts.push(`**Problema:** ${problem.trim()}`)
  if (effort) parts.push(`**Esforço:** ${effort}`)
  if (files.length > 0) parts.push(`**Arquivos:** ${files.map(f => `\`${f}\``).join(', ')}`)
  if (context) parts.push(`**Contexto:** ${context.trim()}`)
  return parts.join('\n\n')
}

function slugTopic(topic: string): string {
  return topic.trim().toLowerCase()
}

function parseCardBlock(block: string, topic: string | null, report: Report): ParsedBacklogCard | null {
  const headingMatch = block.match(CARD_HEADING_RE)
  if (!headingMatch) {
    warn(report, { code: 'invalid_heading' })
    return null
  }

  const externalId = headingMatch[1]
  const title = headingMatch[2].trim()
  const meta = parseMetadata(block)

  if (meta.id && meta.id !== externalId) {
    warn(report, { code: 'id_mismatch', cardId: externalId, detail: meta.id })
  }

  const priority = mapPriority(meta.prioridade)
  const effort = parseEffort(meta.esforço ?? meta.esforco)
  const labels = parseLabels(meta.labels ?? '')
  const files = parseFiles(meta.arquivos ?? '')

  if (topic) labels.push(slugTopic(topic))
  if (effort) labels.push(`esforço:${effort.toLowerCase()}`)

  const uniqueLabels = [...new Set(labels.filter(Boolean))]

  const problemMatch = block.match(PROBLEM_RE)
  const problem = problemMatch?.[1]?.trim() ?? null

  const contextMatch = block.match(CONTEXT_RE)
  const context = contextMatch?.[1]?.trim() ?? null

  const checklist = parseChecklist(block)

  if (checklist.length === 0) {
    warn(report, { code: 'no_subtasks', cardId: externalId })
  }
  if (!meta.prioridade) {
    warn(report, { code: 'no_priority', cardId: externalId })
  }
  if (!effort) {
    warn(report, { code: 'no_effort', cardId: externalId })
  }
  if (!topic) {
    warn(report, { code: 'no_topic', cardId: externalId })
  }

  return {
    externalId,
    title,
    fullTitle: `${externalId} — ${title}`,
    topic,
    priority,
    effort,
    labels: uniqueLabels,
    files,
    description: buildDescription(problem, effort, files, context),
    checklist,
  }
}

export function parseBacklogMarkdown(source: string): ParseResult {
  const report: Report = { warnings: [], issues: [] }
  const topics: string[] = []
  const cards: ParsedBacklogCard[] = []

  let currentTopic: string | null = null
  const lines = source.split('\n')
  const cardStarts: { index: number; topic: string | null }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const topicMatch = line.match(TOPIC_RE)
    if (topicMatch) {
      currentTopic = topicMatch[1].trim()
      if (!topics.includes(currentTopic)) topics.push(currentTopic)
    }
    if (/^###\s+CARD\s+[A-Z]{2,5}-\d{3}\s+[—-]/.test(line)) {
      cardStarts.push({ index: i, topic: currentTopic })
    }
  }

  const seenIds = new Set<string>()

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i].index
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1].index : lines.length
    const block = lines.slice(start, end).join('\n')
    const card = parseCardBlock(block, cardStarts[i].topic, report)
    if (!card) continue

    if (seenIds.has(card.externalId)) {
      warn(report, { code: 'duplicate_id', cardId: card.externalId })
      continue
    }
    seenIds.add(card.externalId)
    cards.push(card)
  }

  if (cards.length === 0) {
    warn(report, { code: 'no_cards' })
  }

  return { cards, warnings: report.warnings, issues: report.issues, topics }
}

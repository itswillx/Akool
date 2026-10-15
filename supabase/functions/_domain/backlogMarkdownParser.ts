import type { ProjectCardPriority, ProjectChecklistItem as ProjectCardChecklistItem } from './projectTypes.ts'

// Parser dos backlogs em Markdown (docs/imports): `### CARD ABC-123 — Título`,
// tabela ou lista de metadados, `**Problema:**`, `**Contexto:**`,
// `**Subtarefas Kanban:**` e seções `## Tópico:`.
// API-027: mora em _domain; o app reexporta por src/lib/backlogMarkdownParser.ts,
// de onde a tela e a CLI (import:cards) importam. O id de cada subtarefa vem de
// `newId`: os testes passam um determinístico.
// API-033: tudo é lido em tempo linear, sem regex com retrocesso (a tela
// reparseia a cada tecla). CRLF vira LF.
// Problema e Contexto vão até o próximo marcador, fora de cerca de código. Os
// metadados são lidos fora dessas seções, da lista de subtarefas e das cercas,
// e `Depende de` vira `dependsOn`.
// O texto na linha do rótulo continua depois dele (`**Problema:** > 2 s` é
// parágrafo, como antes); o rótulo só fica sozinho na linha quando a seção
// começa na linha de baixo com um bloco, ou com uma cerca aberta na linha dele.

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
  /** API-033: os IDs de `Depende de`, em maiúsculas, na ordem do arquivo e sem repetir. */
  dependsOn: string[]
}

// UX-011: cada aviso também sai estruturado (código + card), para a tela de
// importação traduzir. `warnings` continua em português para a CLI
// (scripts/import-backlog-cards.ts).
export type BacklogIssueCode =
  | 'invalid_heading' | 'id_mismatch' | 'no_subtasks' | 'no_priority'
  | 'no_effort' | 'no_topic' | 'duplicate_id' | 'no_cards'
  | 'invalid_dependency' | 'self_dependency'

export interface BacklogIssue {
  code: BacklogIssueCode
  cardId?: string
  /** id_mismatch: o ID da tabela; invalid_dependency: o trecho que não é ID. */
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
  invalid_dependency: i => `${i.cardId}: "${i.detail}" em Depende de não é um ID de card — ignorado`,
  self_dependency: i => `${i.cardId}: depende de si mesmo — ignorado`,
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
const PROBLEM_MARKER_RE = /^\*\*Problema:\*\*/i
const CONTEXT_MARKER_RE = /^\*\*Contexto:\*\*/i
const SECTION_MARKER_RE = /^\*\*(?:Problema|Contexto):\*\*/i
/** Os rótulos do card, que encerram a seção até dentro de uma cerca que não fecha. */
const CARD_LABEL_RE = /^\*\*(?:Subtarefas|Problema:\*\*|Contexto:\*\*)/i
/** Fim de Problema e de Contexto: o próximo marcador do card (fora de cerca de código). */
const SECTION_END_RE = /^(?:\*\*Subtarefas|\*\*Problema:\*\*|\*\*Contexto:\*\*|---|###\s+CARD|#{1,2}\s)/i
/** Seção que começa na linha de baixo com bloco (lista, título, citação, cerca, tabela): o rótulo fica na linha de cima. */
const BLOCK_START_RE = /^(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|~~~|\|)/
const DEPENDENCY_ID_RE = /\b[A-Z]{2,5}-\d{3}\b/gi
const NO_DEPENDENCY = new Set(['', '-', '—', '–', 'nenhum', 'nenhuma'])
const DEPENDENCY_JOINERS = new Set(['e', 'and', '&', '+', '/'])
const SPACE_RE = /\s/
/** Os fins de linha que o `.` de uma regex não aceita (o \r já virou \n). */
const LINE_BREAK_RE = /[\n\r\u2028\u2029]/
const NOT_LINE_BREAK_RE = /[^\n\r\u2028\u2029]/

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

// ── Linhas, sem retrocesso ───────────────────────────────────────────────────
// API-033: as regex de antes eram quadráticas com uma linha longa (20 s com 64
// KiB numa linha de tabela sem `|` no fim). Estas funções dão o mesmo campo e o
// mesmo valor que elas davam, depois de normalizados (o teste diferencial em
// backlogMarkdownParser.test.ts confere). Só o campo vazio ou só de espaço, que
// a regex aceitava e virava a chave '' (nunca lida), aqui não é linha.

const isSpace = (c: string | undefined) => c !== undefined && SPACE_RE.test(c)

/**
 * O que `\*{0,2}\s*(.+)$` (`\s+` com `minSpaces` = 1) captura de `rest`: até
 * dois asteriscos e os espaços do começo saem, e o resto não pode ter fim de
 * linha. Null se não casa.
 */
function lineTail(rest: string, minSpaces: 0 | 1, maxStars: 0 | 2): string | null {
  let stars = 0
  while (stars < maxStars && rest[stars] === '*') stars++
  const tail = rest.slice(stars)
  let spaces = 0
  while (isSpace(tail[spaces])) spaces++
  let lastBreak = -1
  for (let i = 0; i < tail.length; i++) if (LINE_BREAK_RE.test(tail[i])) lastBreak = i
  // `(.+)$`: pelo menos um caractere, sem fim de linha, até o fim; os espaços
  // do começo ficam com o `\s*` o quanto der.
  const start = Math.min(spaces, tail.length - 1)
  if (tail.length > 0 && start >= minSpaces && start > lastBreak) return tail.slice(start)
  // Sem espaço obrigatório, um asterisco devolvido vira o valor (`- a:**` dá `*`).
  if (minSpaces === 0 && stars > 0 && lastBreak < 0) return rest.slice(stars - 1)
  return null
}

/** `| campo | valor |` → [campo, valor], como `^\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|\s*(.+?)\s*\|$`. */
export function tableRow(line: string): [string, string] | null {
  const n = line.length
  if (n < 2 || line[0] !== '|' || line[n - 1] !== '|') return null
  const bar = line.indexOf('|', 1)
  if (bar === n - 1) return null
  // Campo: espaços, até dois asteriscos, o nome (sem `|` nem `*`), até dois asteriscos, espaços.
  let i = 1
  while (i < bar && isSpace(line[i])) i++
  for (let k = 0; k < 2 && line[i] === '*'; k++) i++
  let j = bar
  while (j > i && isSpace(line[j - 1])) j--
  for (let k = 0; k < 2 && j > i && line[j - 1] === '*'; k++) j--
  const field = line.slice(i, j)
  if (!field.trim() || field.includes('*')) return null
  // Valor: até o `|` do fim; aparado, não pode ter fim de linha (só espaço: algum que não seja).
  const value = line.slice(bar + 1, n - 1)
  const core = value.trim()
  if (core ? LINE_BREAK_RE.test(core) : !NOT_LINE_BREAK_RE.test(value)) return null
  return [field, value]
}

/** `- **campo:** valor` → [campo, valor], como `^-\s+\*{0,2}([^:*]+?):\*{0,2}\s*(.+)$`. */
export function listMeta(line: string): [string, string] | null {
  if (line[0] !== '-' || !isSpace(line[1])) return null
  let i = 1
  while (isSpace(line[i])) i++
  for (let k = 0; k < 2 && line[i] === '*'; k++) i++
  const colon = line.indexOf(':', i)
  if (colon < 0) return null
  const field = line.slice(i, colon)
  if (!field.trim() || field.includes('*')) return null
  const value = lineTail(line.slice(colon + 1), 0, 2)
  return value === null ? null : [field, value]
}

/** `- [ ] texto` / `- [x] texto`, como `^-\s+\[([ xX])\]\s+(.+)$`. */
export function checklistItem(line: string): { done: boolean; text: string } | null {
  if (line[0] !== '-') return null
  let i = 1
  while (isSpace(line[i])) i++
  if (i === 1 || line[i] !== '[' || line[i + 2] !== ']') return null
  const mark = line[i + 1]
  if (mark !== ' ' && mark !== 'x' && mark !== 'X') return null
  const text = lineTail(line.slice(i + 3), 1, 0)
  return text === null ? null : { done: mark !== ' ', text }
}

// ── Cercas de código ─────────────────────────────────────────────────────────

interface Fence { char: '`' | '~'; size: number; rest: string }

/** A sequência de 3+ crases ou tis no começo (até 3 espaços antes), ou null. */
function fenceRun(text: string): Fence | null {
  let i = 0
  while (i < 3 && text[i] === ' ') i++
  const char = text[i]
  if (char !== '`' && char !== '~') return null
  let j = i
  while (text[j] === char) j++
  return j - i >= 3 ? { char, size: j - i, rest: text.slice(j) } : null
}

/** Abre cerca: na de crases, o resto da linha não tem crase (senão é código na linha). */
function fenceOpens(text: string): Fence | null {
  const run = fenceRun(text)
  return run && (run.char === '~' || !run.rest.includes('`')) ? run : null
}

/** O tamanho da cerca `char` que a linha fecha (só a sequência e espaços), ou 0. */
function closingSize(line: string, char: Fence['char']): number {
  const run = fenceRun(line)
  return run && run.char === char && !run.rest.trim() ? run.size : 0
}

/** Onde a linha está: fora de cerca, numa cerca que fecha ou numa que não fecha. */
type Fenced = 'no' | 'closed' | 'open'

/**
 * Cada linha do card em relação às cercas de código. A cerca pode abrir logo
 * depois do rótulo (`**Contexto:** ```bash`). A que não fecha vai até o fim do
 * card (nunca entra no seguinte), e nela só os rótulos do card encerram a
 * seção: senão um Contexto sem o fechamento engoliria as subtarefas.
 */
function fencedLines(lines: readonly string[]): Fenced[] {
  const n = lines.length
  const fenced = new Array<Fenced>(n).fill('no')
  for (let i = 0; i < n; i++) {
    const line = lines[i]
    const open = fenceOpens(SECTION_MARKER_RE.test(line) ? line.replace(SECTION_MARKER_RE, '').trimStart() : line)
    if (!open) continue
    let j = i + 1
    while (j < n && closingSize(lines[j], open.char) < open.size) j++
    const state = j < n ? 'closed' : 'open'
    for (let k = i + 1; k <= j && k < n; k++) fenced[k] = state
    i = j
  }
  return fenced
}

// ── Seções, subtarefas e metadados ───────────────────────────────────────────

/**
 * Onde o texto da seção começa: na linha do rótulo (`**Problema:** texto`),
 * numa cerca aberta na linha do rótulo (`**Contexto:** ```bash`) ou na linha
 * de baixo.
 */
type SectionStart = 'inline' | 'fence' | 'below'

interface Section {
  text: string | null
  begins: SectionStart
  /** Linhas [start, end) do card que a seção ocupa, do rótulo ao próximo marcador. */
  start: number
  end: number
}

/** A linha encerra a seção: um marcador fora de cerca, ou um rótulo na cerca que não fecha. */
function endsSection(line: string, fenced: Fenced): boolean {
  if (fenced === 'closed' || !SECTION_END_RE.test(line)) return false
  return fenced === 'no' || CARD_LABEL_RE.test(line)
}

/** A 1ª seção com o rótulo `marker`, até o próximo marcador; null se não há. */
function readSection(lines: readonly string[], fenced: readonly Fenced[], marker: RegExp): Section | null {
  let start = 0
  while (start < lines.length && (fenced[start] === 'closed' || !marker.test(lines[start]))) start++
  if (start === lines.length) return null
  let end = start + 1
  while (end < lines.length && !endsSection(lines[end], fenced[end])) end++
  const first = lines[start].replace(marker, '')
  const text = [first, ...lines.slice(start + 1, end)].join('\n').trim()
  // A cerca da linha do rótulo é a mesma que o fencedLines abriu.
  const begins: SectionStart = !first.trim() ? 'below' : fenceOpens(first.trimStart()) ? 'fence' : 'inline'
  return { text: text || null, begins, start, end }
}

interface Checklist {
  items: ProjectCardChecklistItem[]
  /** Linhas [start, end) da lista, do 1º item ao que a encerra. */
  start: number
  end: number
}

function parseChecklist(lines: readonly string[], newId: () => string): Checklist {
  const marker = lines.findIndex(line => SUBTASKS_MARKER_RE.test(line))
  const items: ProjectCardChecklistItem[] = []
  let start = lines.length
  let end = lines.length

  for (let i = marker + 1; i < lines.length; i++) {
    const line = lines[i]
    const item = checklistItem(line)
    if (!item) {
      if (items.length > 0 && line.trim() && !line.startsWith('-')) {
        end = i
        break
      }
      continue
    }
    if (items.length === 0) start = i
    items.push({ id: newId(), text: item.text.trim(), completed: item.done })
  }

  return { items, start, end }
}

function parseMetadata(lines: readonly string[], skip: readonly boolean[]): Record<string, string> {
  const meta: Record<string, string> = {}

  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) continue
    const row = tableRow(lines[i])
    if (row) {
      const field = normalizeFieldName(row[0])
      if (field === 'campo' || field.startsWith('---')) continue
      meta[field] = row[1].replace(/\*\*/g, '').trim()
      continue
    }
    const item = listMeta(lines[i])
    if (item) meta[normalizeFieldName(item[0])] = item[1].replace(/\*\*/g, '').trim()
  }

  return meta
}

/**
 * `Depende de`: os IDs (`ABC-123`, sem diferença de caixa) separados por
 * vírgula, ponto e vírgula, espaço ou "e". O que sobra num trecho e não é ID
 * vira invalid_dependency; o próprio card, self_dependency.
 */
function parseDependsOn(raw: string | undefined, self: string, report: Report): string[] {
  const ids = new Set<string>()
  let selfWarned = false
  for (const piece of (raw ?? '').split(/[,;]/)) {
    const text = piece.replace(/`/g, '').trim().replace(/\.$/, '')
    if (NO_DEPENDENCY.has(text.toLowerCase())) continue
    for (const [match] of text.matchAll(DEPENDENCY_ID_RE)) {
      const id = match.toUpperCase()
      if (id !== self) ids.add(id)
      else if (!selfWarned) {
        selfWarned = true
        warn(report, { code: 'self_dependency', cardId: self })
      }
    }
    const rest = text.replace(DEPENDENCY_ID_RE, ' ').split(/\s+/).filter(w => w && !DEPENDENCY_JOINERS.has(w.toLowerCase()))
    if (rest.length > 0) warn(report, { code: 'invalid_dependency', cardId: self, detail: rest.join(' ') })
  }
  return [...ids]
}

/**
 * Rótulo e texto da seção. O rótulo fica na linha de cima só quando o texto é
 * um bloco que começa na linha de baixo, ou uma cerca aberta na linha do
 * rótulo. O resto segue o rótulo depois de um espaço: na linha do rótulo,
 * `> 2 s` ou `2. fase` é parágrafo (no Markdown e no parser de antes), e
 * passá-lo para a linha de baixo viraria citação ou lista.
 */
function labeled(name: string, text: string, begins: SectionStart): string {
  const ownLine = begins === 'fence' || (begins === 'below' && BLOCK_START_RE.test(text))
  return `**${name}:**${ownLine ? '\n' : ' '}${text}`
}

function buildDescription(
  problem: Section | null,
  effort: 'S' | 'M' | 'L' | null,
  files: string[],
  context: Section | null,
): string {
  const parts: string[] = []
  if (problem?.text) parts.push(labeled('Problema', problem.text, problem.begins))
  if (effort) parts.push(`**Esforço:** ${effort}`)
  if (files.length > 0) parts.push(`**Arquivos:** ${files.map(f => `\`${f}\``).join(', ')}`)
  if (context?.text) parts.push(labeled('Contexto', context.text, context.begins))
  return parts.join('\n\n')
}

function slugTopic(topic: string): string {
  return topic.trim().toLowerCase()
}

function markLines(skip: boolean[], span: { start: number; end: number } | null) {
  if (span) for (let i = span.start; i < span.end; i++) skip[i] = true
}

function parseCardBlock(lines: readonly string[], topic: string | null, report: Report, newId: () => string): ParsedBacklogCard | null {
  const headingMatch = lines.join('\n').match(CARD_HEADING_RE)
  if (!headingMatch) {
    warn(report, { code: 'invalid_heading' })
    return null
  }

  const externalId = headingMatch[1]
  const title = headingMatch[2].trim()

  const fenced = fencedLines(lines)
  const problem = readSection(lines, fenced, PROBLEM_MARKER_RE)
  const context = readSection(lines, fenced, CONTEXT_MARKER_RE)
  const checklist = parseChecklist(lines, newId)
  // Uma tabela ou um `- Campo: valor` no Contexto, no Problema ou entre as
  // subtarefas não passa por cima dos metadados do card.
  const skip = fenced.map(f => f === 'closed')
  markLines(skip, problem)
  markLines(skip, context)
  markLines(skip, checklist)
  const meta = parseMetadata(lines, skip)

  if (meta.id && meta.id !== externalId) {
    warn(report, { code: 'id_mismatch', cardId: externalId, detail: meta.id })
  }
  const dependsOn = parseDependsOn(meta['depende de'], externalId, report)

  const priority = mapPriority(meta.prioridade)
  const effort = parseEffort(meta.esforço ?? meta.esforco)
  const labels = parseLabels(meta.labels ?? '')
  const files = parseFiles(meta.arquivos ?? '')

  if (topic) labels.push(slugTopic(topic))
  if (effort) labels.push(`esforço:${effort.toLowerCase()}`)

  const uniqueLabels = [...new Set(labels.filter(Boolean))]

  if (checklist.items.length === 0) {
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
    checklist: checklist.items,
    dependsOn,
  }
}

export interface ParseOptions {
  /** Id de cada subtarefa, na ordem do arquivo (padrão: crypto.randomUUID). */
  newId?: () => string
}

export function parseBacklogMarkdown(source: string, { newId = () => crypto.randomUUID() }: ParseOptions = {}): ParseResult {
  const report: Report = { warnings: [], issues: [] }
  // Na ordem do arquivo, sem repetir. Um Set: o includes num array era
  // quadrático com milhares de `## Tópico:` distintos (1,5 s a 512 KiB).
  const topics = new Set<string>()
  const cards: ParsedBacklogCard[] = []

  let currentTopic: string | null = null
  // API-033: arquivo salvo no Windows (CRLF) ou no Mac antigo (CR) lê igual.
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const cardStarts: { index: number; topic: string | null }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const topicMatch = line.match(TOPIC_RE)
    if (topicMatch) {
      currentTopic = topicMatch[1].trim()
      topics.add(currentTopic)
    }
    if (/^###\s+CARD\s+[A-Z]{2,5}-\d{3}\s+[—-]/.test(line)) {
      cardStarts.push({ index: i, topic: currentTopic })
    }
  }

  const seenIds = new Set<string>()

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i].index
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1].index : lines.length
    const card = parseCardBlock(lines.slice(start, end), cardStarts[i].topic, report, newId)
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

  return { cards, warnings: report.warnings, issues: report.issues, topics: [...topics] }
}

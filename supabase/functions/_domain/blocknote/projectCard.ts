// API-020: o bloco projectCard das notas (src/components/blocks/ProjectCardBlock.tsx).
// O snapshot do card vai em JSON numa prop de texto, montado por
// buildCardSnapshot (src/lib/projectImport.ts, que importa o tipo daqui).
//
// Duas classes de regra:
// - fatal: o tipo dos campos que o bloco React desenha. Título em objeto,
//   rótulos ou checklist em texto derrubam o render, e o erro vai para o
//   ErrorBoundary da seção (a nota inteira some);
// - contrato: as 12 chaves exatas, os limites do API-013 (cardLimits.ts e
//   cardLabels.ts) contados por code point, como o Postgres, a data válida por
//   Date.UTC e o enum de prioridade. Prioridade desconhecida não quebra o render
//   (cai na cor padrão). No modo gravado, chave a mais é tolerada: uma versão
//   nova do app pode gravar um campo que a function ainda não conhece.

import { compileSchema, jsonPointer, type JsonSchema, type SchemaIssue } from '../../_api/schema.ts'
import { HARD_MAX_DEPTH } from './spec.ts'

export type ProjectCardPriority = 'low' | 'medium' | 'high' | 'urgent'

/**
 * Snapshot de um card de projeto dentro do bloco `projectCard` de uma nota:
 * plano e serializável em JSON (o propSchema do BlockNote só guarda texto), e
 * completo, para o bloco aparecer mesmo se o card de origem mudar ou sumir.
 */
export interface ProjectCardSnapshot {
  title: string
  description: string
  priority: ProjectCardPriority
  startDate: string | null
  dueDate: string | null
  labels: string[]
  checklist: { text: string; completed: boolean }[]
  completed: boolean
  columnName: string | null
  boardName: string
  boardIcon: string
  boardColor: string
}

export const PROJECT_CARD_PRIORITIES: readonly ProjectCardPriority[] = ['low', 'medium', 'high', 'urgent']

// Os números do API-013 (src/lib/cardLimits.ts e src/lib/cardLabels.ts).
export const SNAPSHOT_LIMITS = { labels: 30, labelLength: 50, checklist: 500, checklistText: 2000, boardColor: 64 } as const

const dateOrNull: JsonSchema = { type: ['string', 'null'], format: 'date' }

/** Contrato completo do snapshot. */
export const SNAPSHOT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'priority', 'startDate', 'dueDate', 'labels', 'checklist', 'completed', 'columnName', 'boardName', 'boardIcon', 'boardColor'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    priority: { type: 'string', enum: PROJECT_CARD_PRIORITIES },
    startDate: dateOrNull,
    dueDate: dateOrNull,
    labels: { type: 'array', maxItems: SNAPSHOT_LIMITS.labels, items: { type: 'string', minLength: 1, maxLength: SNAPSHOT_LIMITS.labelLength } },
    checklist: {
      type: 'array',
      maxItems: SNAPSHOT_LIMITS.checklist,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'completed'],
        properties: { text: { type: 'string', maxLength: SNAPSHOT_LIMITS.checklistText }, completed: { type: 'boolean' } },
      },
    },
    completed: { type: 'boolean' },
    columnName: { type: ['string', 'null'] },
    boardName: { type: 'string' },
    boardIcon: { type: 'string' },
    // project_boards.color não tem CHECK: texto curto, que vai só para um style inline.
    boardColor: { type: 'string', maxLength: SNAPSHOT_LIMITS.boardColor },
  },
}

/** Só os tipos que o render do bloco (e o PDF) usam sem conferir: fatais. */
export const SNAPSHOT_RENDER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    boardName: { type: 'string' },
    boardIcon: { type: 'string' },
    columnName: { type: ['string', 'null'] },
    labels: { type: 'array', items: { type: 'string' } },
    checklist: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, completed: { type: 'boolean' } } } },
    completed: { type: 'boolean' },
  },
}

const checkContract = compileSchema(SNAPSHOT_SCHEMA)
const checkRender = compileSchema(SNAPSHOT_RENDER_SCHEMA)

export interface InnerIssue extends SchemaIssue {
  fatal: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Problemas do texto da prop `snapshot`, com o caminho DENTRO do JSON. O
 * validador da nota os reporta no ponteiro da prop (`/3/props/snapshot`).
 */
export function snapshotIssues(raw: unknown, { stored = false, fatalOnly = false }: { stored?: boolean; fatalOnly?: boolean } = {}): InnerIssue[] {
  // Tipo da prop e texto ilegível: o bloco desenha o rótulo padrão.
  if (typeof raw !== 'string') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fatalOnly ? [] : [{ path: '', keyword: 'json', message: 'JSON inválido', fatal: false }]
  }
  const issues: InnerIssue[] = []
  if (isPlainObject(parsed)) {
    const render = checkRender(parsed)
    if (!render.ok) for (const issue of render.issues) issues.push({ ...issue, fatal: true })
  }
  if (fatalOnly) return issues
  const contract = checkContract(parsed)
  if (!contract.ok) {
    const seen = new Set(issues.map(i => `${i.path} ${i.keyword}`))
    for (const issue of contract.issues) {
      if (seen.has(`${issue.path} ${issue.keyword}`)) continue
      // Chave a mais na raiz do snapshot gravado: tolerada.
      if (stored && issue.keyword === 'additionalProperties' && issue.path.lastIndexOf('/') === 0) continue
      issues.push({ ...issue, fatal: false })
    }
  }
  return issues
}

/** Um bloco projectCard novo (ou com props alteradas) entre a nota gravada e a nova. */
export interface ProjectCardRef {
  /** Id do bloco; null se o bloco veio sem id (rode depois do normalize). */
  id: string | null
  /** JSON Pointer do bloco no documento novo. */
  path: string
}

type Frame = { block: unknown; path: (string | number)[]; depth: number }

function pushReversed(stack: Frame[], list: unknown[], path: (string | number)[], depth: number) {
  for (let i = list.length - 1; i >= 0; i--) stack.push({ block: list[i], path: [...path, i], depth })
}

// Percurso em pré-ordem (a ordem do documento), com pilha explícita e teto de
// profundidade: o documento pode ainda não ter passado pelo validador.
function projectCards(doc: unknown, maxDepth = HARD_MAX_DEPTH): { id: unknown; path: (string | number)[]; props: unknown }[] {
  const found: { id: unknown; path: (string | number)[]; props: unknown }[] = []
  if (!Array.isArray(doc)) return found
  const stack: Frame[] = []
  pushReversed(stack, doc, [], 1)
  while (stack.length > 0) {
    const { block, path, depth } = stack.pop() as Frame
    if (!isPlainObject(block)) continue
    if (block.type === 'projectCard') found.push({ id: block.id, path, props: block.props })
    if (Array.isArray(block.children) && depth < maxDepth) pushReversed(stack, block.children, [...path, 'children'], depth + 1)
  }
  return found
}

const CARD_PROPS = ['cardId', 'boardId', 'snapshot'] as const

function sameCardProps(a: unknown, b: unknown): boolean {
  const pa = isPlainObject(a) ? a : {}
  const pb = isPlainObject(b) ? b : {}
  return CARD_PROPS.every(key => pa[key] === pb[key])
}

/**
 * API-044: os blocos projectCard de `after` que não estavam em `before` com o
 * mesmo id e as mesmas props (cardId, boardId e snapshot). Inserir card de
 * projeto pela API exige também projetos.cards:ler, e o snapshot é montado no
 * servidor (docs/api-arquitetura.md); com isto a API recusa, ou remonta, o
 * snapshot inventado por quem só tem documentos.notas:escrever.
 */
export function newProjectCardIds(before: unknown, after: unknown): ProjectCardRef[] {
  const known = new Map<string, unknown>()
  for (const card of projectCards(before)) if (typeof card.id === 'string') known.set(card.id, card.props)
  const changed: ProjectCardRef[] = []
  for (const card of projectCards(after)) {
    const id = typeof card.id === 'string' ? card.id : null
    if (id !== null && known.has(id) && sameCardProps(known.get(id), card.props)) continue
    changed.push({ id, path: jsonPointer(card.path) })
  }
  return changed
}

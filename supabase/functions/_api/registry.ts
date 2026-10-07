// API-008: o registro de ações e as invariantes do §4 (docs/api-arquitetura.md).
// Um lugar só para o que a API faz: o MCP (API-015), o REST (API-010) e o
// OpenAPI (API-017) saem daqui. registryProblems() é pura: o teste roda contra
// o registro real (zero problemas) e contra uma fixture quebrada por regra.

import { META_ACTIONS } from './actions/meta.ts'
import { COMPOSITE_VIEWS, getSubsection } from './catalog.ts'
import { schemaProblems, validate, type JsonSchema, type JsonType } from './schema.ts'
import { levelRank } from './scopes.ts'
import type { ActionDef } from './types.ts'

/** O Claude Code prefixa `mcp__akool__` e recusa nomes acima de 64. */
export const MAX_MCP_NAME = 48
export const MAX_DESCRIPTION = 300

const ID_PATTERN = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/
const SCALAR_TYPES: ReadonlySet<JsonType> = new Set(['string', 'integer', 'number', 'boolean', 'null'])

/**
 * Frases dirigidas ao modelo: a descrição diz o que a ação faz, não manda na
 * IA (texto de ferramenta é canal de prompt injection).
 */
export const MODEL_DIRECTED: readonly RegExp[] = [
  /\bvoc[eê] deve\b/i, /\bsempre (chame|use)\b/i, /\bnunca (chame|use)\b/i, /\bignore\b/i, /\bo modelo\b/i,
  /\byou must\b/i, /\balways (call|use)\b/i, /\bnever (call|use)\b/i, /\bthe model\b/i, /\bIMPORTANT\b/,
]

export const mcpName = (id: string) => id.replaceAll('.', '_')

const typesOf = (schema: JsonSchema): readonly JsonType[] =>
  schema.type === undefined ? [] : typeof schema.type === 'string' ? [schema.type] : schema.type

/** Entrada plana: objeto só com propriedades escalares (vira query string de GET). */
export function isFlatInput(schema: JsonSchema): boolean {
  if (!typesOf(schema).includes('object')) return false
  return Object.values(schema.properties ?? {}).every(prop =>
    !prop.properties && !prop.items && !prop.oneOf && typesOf(prop).every(t => SCALAR_TYPES.has(t)))
}

const compositeOf = (id: string) => COMPOSITE_VIEWS.find(view => id.startsWith(`${view.key}.`))

/** Problemas de uma ação, sem as regras que dependem das vizinhas (id repetido e ordem). */
function actionProblems(action: ActionDef): string[] {
  const out: string[] = []
  const { annotations: ann, kind } = action

  if (!ID_PATTERN.test(action.id)) out.push('id precisa de 3 segmentos só com [a-z_]')
  if (mcpName(action.id).length > MAX_MCP_NAME) out.push(`nome MCP com mais de ${MAX_MCP_NAME} caracteres`)
  if (!action.title.trim()) out.push('sem título')
  if (!action.description.trim()) out.push('sem descrição')
  if (action.description.length > MAX_DESCRIPTION) out.push(`descrição com mais de ${MAX_DESCRIPTION} caracteres`)
  if (MODEL_DIRECTED.some(re => re.test(action.description))) out.push('descrição com frase dirigida ao modelo')

  // Anotações pelo tipo da ação (§4, Convenções).
  if (ann.openWorldHint !== false) out.push('openWorldHint precisa ser false')
  if (kind === 'read') {
    if (!ann.readOnlyHint) out.push('leitura sem readOnlyHint')
    if (ann.destructiveHint) out.push('leitura com destructiveHint')
    if (!isFlatInput(action.input)) out.push('leitura com entrada que não é plana')
  } else {
    if (ann.readOnlyHint) out.push(`${kind} com readOnlyHint`)
    if (kind === 'create' && ann.destructiveHint) out.push('criação com destructiveHint')
    if (kind !== 'create' && !ann.destructiveHint) out.push(`${kind} sem destructiveHint`)
  }

  // Permissões: só subseções reais, até o máximo de cada uma.
  const requirements = [...(action.requires.allOf ?? []), ...(action.requires.anyOf ?? [])]
  for (const req of requirements) {
    const sub = getSubsection(req.sub)
    if (!sub) out.push(`requires com subseção inexistente: ${req.sub}`)
    else if (levelRank(req.level) > levelRank(sub.maxLevel)) out.push(`requires acima do máximo de ${req.sub} (${sub.maxLevel})`)
  }
  if (kind === 'read' && requirements.some(req => req.level !== 'read')) out.push('leitura exigindo mais que Ler')
  if (kind === 'delete' && !requirements.some(req => req.level === 'delete')) out.push('exclusão sem nível delete no requires')

  // Namespace composto: sem nível próprio, anyOf igual ao da visão. Senão, a
  // ação é de uma subseção do catálogo e a exige.
  const view = compositeOf(action.id)
  if (view) {
    const anyOf = action.requires.anyOf ?? []
    const sameSources = [...view.anyOf].sort().join() === anyOf.map(req => req.sub).sort().join()
    if (action.requires.allOf?.length) out.push(`namespace composto ${view.key} sem nível próprio: só requires.anyOf`)
    if (!sameSources || anyOf.some(req => req.level !== 'read')) out.push(`requires.anyOf difere da visão ${view.key}`)
  } else {
    const own = action.id.split('.').slice(0, 2).join('.')
    if (!getSubsection(own)) out.push(`${own} não é subseção nem namespace composto do catálogo`)
    else if (!requirements.some(req => req.sub === own)) out.push(`requires não cita a própria subseção ${own}`)
  }

  // Schemas no subconjunto e exemplos válidos.
  const inputProblems = schemaProblems(action.input)
  const outputProblems = schemaProblems(action.output)
  out.push(...inputProblems.map(p => `input ${p}`), ...outputProblems.map(p => `output ${p}`))
  if (action.examples.input.length === 0) out.push('sem exemplo de entrada')
  if (action.examples.output.length === 0) out.push('sem exemplo de saída')
  const checkExamples = (label: string, schema: JsonSchema, examples: readonly unknown[]) => examples.forEach((example, i) => {
    const result = validate(schema, example)
    if (!result.ok) out.push(`exemplo de ${label} ${i} inválido: ${result.issues[0].path || '(raiz)'} ${result.issues[0].message}`)
  })
  if (inputProblems.length === 0) checkExamples('entrada', action.input, action.examples.input)
  if (outputProblems.length === 0) checkExamples('saída', action.output, action.examples.output)
  return out
}

/** Todas as violações das invariantes do §4; vazio = registro válido. */
export function registryProblems(actions: readonly ActionDef[]): string[] {
  const seen = new Set<string>()
  return actions.flatMap((action, i) => {
    const out = actionProblems(action)
    if (seen.has(action.id)) out.push('id repetido')
    else if (i > 0 && actions[i - 1].id > action.id) out.push('fora de ordem (o registro é ordenado por id)')
    seen.add(action.id)
    return out.map(problem => `${action.id || `#${i}`}: ${problem}`)
  })
}

const byId = (a: ActionDef, b: ActionDef) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** O registro, em ordem de id (ordem determinística para o MCP e o OpenAPI). */
export const REGISTRY: readonly ActionDef[] = [...META_ACTIONS].sort(byId)

const BY_ID = new Map(REGISTRY.map(action => [action.id, action]))

export function getAction(id: string): ActionDef | undefined {
  return BY_ID.get(id)
}

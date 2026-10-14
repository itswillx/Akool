// API-005: validador do subconjunto de JSON Schema das ações da API
// (docs/api-arquitetura.md §4). Puro e sem dependência: o Vitest, o gateway
// (API-010) e o gerador do OpenAPI (API-017) usam o mesmo arquivo.
//
// Sem coerção e sem default: converter texto de query string em número é do
// http.ts (API-010), e o handler recebe exatamente o que foi validado.

export type JsonType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null'
export type JsonFormat = 'date' | 'month' | 'date-time' | 'uuid' | 'email'
type Primitive = string | number | boolean | null

export interface JsonSchema {
  type?: JsonType | readonly JsonType[]
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  additionalProperties?: false
  enum?: readonly Primitive[]
  const?: Primitive
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: JsonFormat
  items?: JsonSchema
  minItems?: number
  maxItems?: number
  oneOf?: readonly JsonSchema[]
  // Só documentação (OpenAPI e MCP): não validam nada.
  title?: string
  description?: string
  default?: unknown
  examples?: readonly unknown[]
  deprecated?: boolean
}

export interface SchemaIssue {
  /** JSON Pointer (RFC 6901) do valor com problema; '' é a raiz. */
  path: string
  keyword: string
  message: string
}

export type Validation = { ok: true } | { ok: false; issues: SchemaIssue[] }

/** Teto de problemas por resposta: o bastante para corrigir, sem virar despejo. */
export const MAX_ISSUES = 20

const TYPES: readonly JsonType[] = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']
const FORMATS: readonly JsonFormat[] = ['date', 'month', 'date-time', 'uuid', 'email']
const KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'format', 'items', 'minItems', 'maxItems', 'oneOf',
  'title', 'description', 'default', 'examples', 'deprecated',
])

const TYPE_LABEL: Record<JsonType, string> = {
  object: 'objeto', array: 'lista', string: 'texto', integer: 'inteiro', number: 'número', boolean: 'booleano', null: 'nulo',
}
const FORMAT_LABEL: Record<JsonFormat, string> = {
  date: 'data AAAA-MM-DD', month: 'mês AAAA-MM', 'date-time': 'data e hora com fuso (RFC 3339)', uuid: 'UUID', email: 'e-mail',
}

/** RFC 6901: `~` vira `~0` e `/` vira `~1`. */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments.map(s => '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPrimitive(value: unknown): value is Primitive {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function isCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/**
 * Problemas do próprio schema (palavra-chave fora do subconjunto, valor de
 * tipo errado, mínimo maior que máximo…). Vazio = schema aceito.
 */
export function schemaProblems(schema: unknown, at = ''): string[] {
  const where = at || '(raiz)'
  if (!isPlainObject(schema)) return [`${where}: o schema deve ser um objeto`]
  const problems: string[] = []
  const add = (message: string) => problems.push(`${where}: ${message}`)

  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) add(`palavra-chave fora do subconjunto: ${key}`)
  }
  const s = schema as Record<string, unknown>
  if ('type' in s) {
    const list = Array.isArray(s.type) ? s.type : [s.type]
    if (list.length === 0 || list.some(t => !TYPES.includes(t as JsonType)) || new Set(list).size !== list.length) add('type inválido')
  }
  if ('properties' in s) {
    if (!isPlainObject(s.properties)) add('properties deve ser um objeto')
    else for (const [name, sub] of Object.entries(s.properties)) problems.push(...schemaProblems(sub, `${at}/properties${jsonPointer([name])}`))
  }
  if ('required' in s) {
    const props = isPlainObject(s.properties) ? s.properties : {}
    if (!Array.isArray(s.required) || s.required.some(r => typeof r !== 'string')) add('required deve ser uma lista de nomes')
    else for (const name of s.required as string[]) if (!(name in props)) add(`required cita campo sem properties: ${name}`)
  }
  if ('additionalProperties' in s && s.additionalProperties !== false) add('additionalProperties só aceita false')
  if ('enum' in s && (!Array.isArray(s.enum) || s.enum.length === 0 || !s.enum.every(isPrimitive))) add('enum deve ser uma lista não vazia de valores simples')
  if ('const' in s && !isPrimitive(s.const)) add('const deve ser um valor simples')
  for (const key of ['minimum', 'maximum'] as const) {
    if (key in s && !Number.isFinite(s[key])) add(`${key} deve ser um número`)
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (key in s && !isCount(s[key])) add(`${key} deve ser um inteiro >= 0`)
  }
  for (const [min, max] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']] as const) {
    if (typeof s[min] === 'number' && typeof s[max] === 'number' && (s[min] as number) > (s[max] as number)) add(`${min} maior que ${max}`)
  }
  if ('pattern' in s) {
    if (typeof s.pattern !== 'string') add('pattern deve ser texto')
    else {
      try { new RegExp(s.pattern, 'u') } catch { add('pattern não compila') }
      // Teto de tamanho para a regex nunca rodar sobre um texto enorme.
      if (!('maxLength' in s)) add('pattern exige maxLength')
    }
  }
  if ('format' in s && !FORMATS.includes(s.format as JsonFormat)) add(`format fora do subconjunto: ${String(s.format)}`)
  if ('items' in s) problems.push(...schemaProblems(s.items, `${at}/items`))
  if ('oneOf' in s) {
    if (!Array.isArray(s.oneOf) || s.oneOf.length === 0) add('oneOf deve ser uma lista não vazia')
    else s.oneOf.forEach((sub, i) => problems.push(...schemaProblems(sub, `${at}/oneOf/${i}`)))
  }
  for (const key of ['title', 'description'] as const) {
    if (key in s && typeof s[key] !== 'string') add(`${key} deve ser texto`)
  }
  if ('examples' in s && !Array.isArray(s.examples)) add('examples deve ser uma lista')
  if ('deprecated' in s && typeof s.deprecated !== 'boolean') add('deprecated deve ser booleano')
  return problems
}

function typeOf(value: unknown): JsonType | 'other' {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string': return 'string'
    case 'boolean': return 'boolean'
    case 'number': return Number.isFinite(value) ? (Number.isSafeInteger(value) ? 'integer' : 'number') : 'other'
    case 'object': return 'object'
    default: return 'other'
  }
}

function matchesType(value: unknown, type: JsonType): boolean {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function matchesFormat(value: string, format: JsonFormat): boolean {
  switch (format) {
    case 'date': {
      const m = DATE_RE.exec(value)
      return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))
    }
    case 'month': return MONTH_RE.test(value)
    case 'date-time': {
      const m = DATE_TIME_RE.exec(value)
      return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))
    }
    case 'uuid': return UUID_RE.test(value)
    case 'email': return value.length <= 254 && EMAIL_RE.test(value)
  }
}

const patternCache = new Map<string, RegExp>()
function compiledPattern(pattern: string): RegExp {
  let re = patternCache.get(pattern)
  if (!re) {
    re = new RegExp(pattern, 'u')
    patternCache.set(pattern, re)
  }
  return re
}

// Campo com `const` presente em todas as opções: decide qual opção explicar.
function discriminator(options: readonly JsonSchema[]): string | null {
  const first = options[0]?.properties
  if (!first) return null
  return Object.keys(first).find(key => options.every(o => o.properties?.[key]?.const !== undefined)) ?? null
}


/**
 * Caracteres como o Postgres conta (char_length): pontos de código, não UTF-16;
 * um surrogate solto conta 1, como no spread. Para em `limit + 1`: um texto
 * enorme num campo curto não vira um array inteiro na memória da edge.
 */
function codePoints(value: string, limit: number): number {
  let n = 0
  for (let i = 0; i < value.length && n <= limit; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    }
    n++
  }
  return n
}
function check(schema: JsonSchema, value: unknown, at: (string | number)[], issues: SchemaIssue[]): void {
  const push = (keyword: string, message: string, extra: (string | number)[] = []) => {
    if (issues.length < MAX_ISSUES) issues.push({ path: jsonPointer([...at, ...extra]), keyword, message })
  }

  if (schema.type !== undefined) {
    const types = typeof schema.type === 'string' ? [schema.type] : schema.type
    if (!types.some(t => matchesType(value, t))) {
      push('type', `Tipo inválido: esperado ${types.map(t => TYPE_LABEL[t]).join(' ou ')}`)
      return
    }
  }
  if (schema.const !== undefined && value !== schema.const) push('const', `Deve ser ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value as Primitive)) push('enum', 'Valor fora da lista permitida')

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) push('minimum', `Deve ser no mínimo ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) push('maximum', `Deve ser no máximo ${schema.maximum}`)
  }

  if (typeof value === 'string') {
    const length = schema.minLength === undefined && schema.maxLength === undefined
      ? 0
      : codePoints(value, Math.max(schema.minLength ?? 0, schema.maxLength ?? 0))
    if (schema.minLength !== undefined && length < schema.minLength) push('minLength', `Deve ter no mínimo ${schema.minLength} caractere(s)`)
    if (schema.maxLength !== undefined && length > schema.maxLength) push('maxLength', `Deve ter no máximo ${schema.maxLength} caractere(s)`)
    else if (schema.pattern !== undefined && !compiledPattern(schema.pattern).test(value)) push('pattern', 'Formato inválido')
    if (schema.format !== undefined && !matchesFormat(value, schema.format)) push('format', `Formato inválido: esperado ${FORMAT_LABEL[schema.format]}`)
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push('minItems', `Deve ter no mínimo ${schema.minItems} item(ns)`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push('maxItems', `Deve ter no máximo ${schema.maxItems} item(ns)`)
    if (schema.items) value.forEach((item, i) => check(schema.items as JsonSchema, item, [...at, i], issues))
  }

  if (isPlainObject(value)) {
    const props = schema.properties ?? {}
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) push('required', 'Campo obrigatório', [name])
    }
    for (const [name, item] of Object.entries(value)) {
      if (Object.hasOwn(props, name)) check(props[name], item, [...at, name], issues)
      else if (schema.additionalProperties === false) push('additionalProperties', 'Campo não permitido', [name])
    }
  }

  if (schema.oneOf) {
    const results = schema.oneOf.map(option => {
      const found: SchemaIssue[] = []
      check(option, value, at, found)
      return found
    })
    const passing = results.filter(r => r.length === 0).length
    if (passing === 1) return
    if (passing > 1) {
      push('oneOf', 'Corresponde a mais de uma opção')
      return
    }
    const key = discriminator(schema.oneOf)
    const chosen = key && isPlainObject(value)
      ? schema.oneOf.findIndex(o => o.properties?.[key]?.const === value[key])
      : -1
    if (chosen >= 0) {
      for (const issue of results[chosen]) if (issues.length < MAX_ISSUES) issues.push(issue)
    } else {
      push('oneOf', 'Não corresponde a nenhuma das opções')
    }
  }
}

const compiled = new WeakMap<JsonSchema, (value: unknown) => Validation>()

/** Confere o schema uma vez (lança se estiver fora do subconjunto) e devolve o validador. */
export function compileSchema(schema: JsonSchema): (value: unknown) => Validation {
  const cached = compiled.get(schema)
  if (cached) return cached
  const problems = schemaProblems(schema)
  if (problems.length > 0) throw new Error(`Schema fora do subconjunto:\n${problems.join('\n')}`)
  const validator = (value: unknown): Validation => {
    const issues: SchemaIssue[] = []
    check(schema, value, [], issues)
    return issues.length === 0 ? { ok: true } : { ok: false, issues }
  }
  compiled.set(schema, validator)
  return validator
}

export function validate(schema: JsonSchema, value: unknown): Validation {
  return compileSchema(schema)(value)
}

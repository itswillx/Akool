// API-020: validador do conteúdo das notas (BlockNote 0.50, spec.ts). Puro: a
// API (API-044 e API-023) e o app (guarda do NoteEditor) usam o mesmo arquivo.
//
// Cada problema sai com o JSON Pointer, a palavra-chave e a marca `fatal`:
// - fatal: o que faz o BlockNoteEditor.create lançar, quebra o render no
//   navegador (inclusive os blocos React), quebra o PDF ou corrompe outro bloco
//   (id repetido: o updateBlock do segundo bloco grava no primeiro);
// - contrato: o que o editor carrega, mas perde ou guarda errado (prop
//   desconhecida, cor longa, link javascript:, tipos das props…), mais os
//   limites da API (2 MiB, 5000 blocos, profundidade 10, células de tabela e
//   nós em linha).
// A guarda do NoteEditor usa só as fatais (fatalOnly): conteúdo gravado pode
// ter desvios de contrato e continuar abrindo.
//
// O percurso usa pilha explícita e confere a profundidade antes de descer; em
// props e estilos só entram valores simples; os bytes são medidos no fim (com
// o valor já limitado), e um RangeError vira problema, nunca um 500.
//
// As partes planas (props de cada tipo, props da célula, snapshot do card e
// appState do diagrama) são JSON Schema do subconjunto do _api/schema.ts, que
// conta caracteres por code point (como o Postgres) e confere datas por
// Date.UTC. _api/schema.ts é folha (não importa nada); ele nunca importa _domain.

import { compileSchema, jsonPointer, MAX_ISSUES, type JsonSchema, type SchemaIssue } from '../../_api/schema.ts'
import { diagramIssues } from './diagram.ts'
import { snapshotIssues } from './projectCard.ts'
import { tableGridProblem, tableWidth, widthSpan } from './table.ts'
import {
  BLOCK_SPECS, COLOR_PROPS, HARD_MAX_DEPTH, LIMITS, MAX_COLOR_LENGTH, MAX_INLINE_NODES, TABLE_CELL_DEFAULTS, TABLE_LIMITS,
  blockSpecOf, isAllowedHref, styleKindOf,
  type BlockSpecDef, type BlockType, type Limits, type PropSpec,
} from './spec.ts'

export interface BlockIssue extends SchemaIssue {
  /** O editor lança, o render ou o PDF quebram, ou outro bloco é corrompido. */
  fatal: boolean
}

/** `partial`: a entrada do BlockNote (PartialBlock). `full`: a forma canônica (editor.document e normalize). */
export type NoteForm = 'partial' | 'full'

export interface ValidateOptions {
  form?: NoteForm
  /** Modo gravado: conteúdo que já está no banco (tolera chave a mais no snapshot do card). */
  stored?: boolean
  /** Só as regras fatais, sem os limites de contrato (guarda do NoteEditor). */
  fatalOnly?: boolean
  /** Ids que já existem na nota (anexar): repetir um deles é fatal. */
  reservedIds?: Iterable<string>
  /** Uso interno do normalize com renameDuplicateIds: id repetido não é problema. */
  duplicateIds?: 'reject' | 'ignore'
  limits?: Partial<Limits>
  maxIssues?: number
  /** Tamanho já medido (corpo cru do gateway); sem ele, mede o JSON compacto. */
  bytes?: number
}

export interface NoteStats {
  blocks: number
  depth: number
  /** Bytes UTF-8 do JSON compacto; null quando não foi medido (fatalOnly ou erro). */
  bytes: number | null
}

export type NoteValidation =
  | { ok: true; issues: []; stats: NoteStats }
  | { ok: false; issues: BlockIssue[]; stats: NoteStats }

type Segments = (string | number)[]
type Json = Record<string, unknown>

const BLOCK_KEYS = new Set(['id', 'type', 'props', 'content', 'children'])
const TEXT_KEYS = new Set(['type', 'text', 'styles'])
const LINK_KEYS = new Set(['type', 'href', 'content'])
const TABLE_KEYS = new Set(['type', 'columnWidths', 'headerRows', 'headerCols', 'rows'])
const CELL_KEYS = new Set(['type', 'props', 'content'])
const MAX_ID_LENGTH = 128

// \u0000 e surrogate solto: o jsonb do Postgres recusa (22P05), e a gravação falharia.
// eslint-disable-next-line no-control-regex
const BAD_CHAR = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mais de `limit` caracteres contados por code point (como o Postgres), sem espalhar um texto enorme. */
function longerThan(value: string, limit: number): boolean {
  if (value.length <= limit) return false
  if (value.length > limit * 2) return true
  return [...value].length > limit
}

/**
 * Quantos nós o BlockNote cria para um texto (styledTextToNodes): fora do
 * bloco de código, cada \n vira um hardBreak e cada trecho não vazio entre
 * eles, um nó de texto; no código, o texto inteiro é um nó. Sem alocar.
 */
export function textNodeCount(text: string, code: boolean): number {
  if (code) return text.length > 0 ? 1 : 0
  let nodes = 0
  let start = 0
  for (;;) {
    const at = text.indexOf('\n', start)
    if (at === -1) return nodes + (start < text.length ? 1 : 0)
    nodes += at > start ? 2 : 1
    start = at + 1
  }
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

// ── Schemas das partes planas ─────────────────────────────────────────────────

const colorSchema: JsonSchema = { type: 'string', minLength: 1, maxLength: MAX_COLOR_LENGTH }
const UUID_OR_EMPTY = '^(?:|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'

const PROP_OVERRIDES: Record<string, JsonSchema> = {
  // Fatal à parte (o render faz document.createElement(`h${level}`)): aqui só ocupa o lugar.
  'heading.level': {},
  'numberedListItem.start': { type: 'integer' },
  'image.previewWidth': { type: 'number', minimum: 1 },
  'video.previewWidth': { type: 'number', minimum: 1 },
  'diagram.collapsed': { type: 'string', enum: ['true', 'false'] },
  'projectCard.cardId': { type: 'string', maxLength: 36, pattern: UUID_OR_EMPTY },
  'projectCard.boardId': { type: 'string', maxLength: 36, pattern: UUID_OR_EMPTY },
}

function propSchemaOf(type: string, name: string, spec: PropSpec): JsonSchema {
  const override = PROP_OVERRIDES[`${type}.${name}`]
  if (override) return override
  if (COLOR_PROPS.has(name)) return colorSchema
  const kind = spec.type ?? typeof spec.default
  const schema: JsonSchema = { type: kind === 'number' ? 'number' : kind === 'boolean' ? 'boolean' : 'string' }
  return spec.values ? { ...schema, enum: spec.values } : schema
}

function propsSchema(type: string, spec: BlockSpecDef, form: NoteForm): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [name, prop] of Object.entries(spec.propSchema)) {
    properties[name] = propSchemaOf(type, name, prop)
    if (form === 'full' && prop.default !== undefined) required.push(name)
  }
  return { type: 'object', additionalProperties: false, properties, ...(required.length > 0 ? { required } : {}) }
}

const PROPS_CHECKS = new Map<string, { partial: ReturnType<typeof compileSchema>; full: ReturnType<typeof compileSchema> }>(
  Object.entries(BLOCK_SPECS).map(([type, spec]) => [type, {
    partial: compileSchema(propsSchema(type, spec, 'partial')),
    full: compileSchema(propsSchema(type, spec, 'full')),
  }]),
)

// colspan e rowspan são fatais (conferidos à parte); aqui só ocupam o lugar.
const CELL_PROPS_PROPERTIES: Record<string, JsonSchema> = {
  colspan: {}, rowspan: {}, backgroundColor: colorSchema, textColor: colorSchema,
  textAlignment: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
}
const CELL_PROPS_CHECKS = {
  partial: compileSchema({ type: 'object', additionalProperties: false, properties: CELL_PROPS_PROPERTIES }),
  full: compileSchema({ type: 'object', additionalProperties: false, properties: CELL_PROPS_PROPERTIES, required: Object.keys(TABLE_CELL_DEFAULTS) }),
}

// ── Percurso ──────────────────────────────────────────────────────────────────

interface Frame { block: unknown; path: Segments; depth: number }

class Collector {
  readonly fatal: BlockIssue[] = []
  readonly contract: BlockIssue[] = []
  readonly max: number
  readonly fatalOnly: boolean

  constructor(max: number, fatalOnly: boolean) {
    this.max = max
    this.fatalOnly = fatalOnly
  }

  add(fatal: boolean, at: Segments, keyword: string, message: string): void {
    if (this.fatalOnly && !fatal) return
    const list = fatal ? this.fatal : this.contract
    if (list.length < this.max) list.push({ path: jsonPointer(at), keyword, message, fatal })
  }

  /** Problemas de um schema plano, com o ponteiro relativo a `at`. */
  addSchema(fatal: boolean, at: Segments, issues: readonly SchemaIssue[]): void {
    for (const issue of issues) {
      if (this.fatalOnly && !fatal) return
      const list = fatal ? this.fatal : this.contract
      if (list.length < this.max) list.push({ ...issue, path: jsonPointer(at) + issue.path, fatal })
    }
  }

  get full(): boolean {
    return this.fatal.length >= this.max && (this.fatalOnly || this.contract.length >= this.max)
  }

  result(): BlockIssue[] {
    return [...this.fatal, ...this.contract].slice(0, this.max)
  }
}

class Walker {
  readonly form: NoteForm
  readonly stored: boolean
  readonly fatalOnly: boolean
  readonly limits: Limits
  readonly out: Collector
  readonly ids = new Map<string, string>()
  readonly reserved: ReadonlySet<string>
  readonly duplicateIds: 'reject' | 'ignore'
  blocks = 0
  depth = 0
  /** Σ células² das tabelas já vistas (o custo quadrático do create). */
  tableCost = 0
  tableCostReported = false

  constructor(opts: ValidateOptions) {
    this.form = opts.form ?? 'partial'
    this.stored = opts.stored ?? false
    this.fatalOnly = opts.fatalOnly ?? false
    this.limits = { ...LIMITS, ...opts.limits }
    this.out = new Collector(Math.max(1, opts.maxIssues ?? MAX_ISSUES), this.fatalOnly)
    this.reserved = new Set(opts.reservedIds ?? [])
    this.duplicateIds = opts.duplicateIds ?? 'reject'
  }

  get full(): boolean {
    return this.form === 'full'
  }

  chars(value: string, at: Segments): void {
    if (!this.fatalOnly && BAD_CHAR.test(value)) this.out.add(false, at, 'char', 'Texto com \\u0000 ou surrogate solto (o banco recusa)')
  }

  keys(obj: Json, allowed: ReadonlySet<string>, at: Segments): void {
    if (this.fatalOnly) return
    for (const key of Object.keys(obj)) {
      this.chars(key, [...at, key])
      if (!allowed.has(key)) this.out.add(false, [...at, key], 'additionalProperties', 'Campo não permitido')
    }
  }

  run(value: unknown): void {
    if (!Array.isArray(value)) {
      this.out.add(true, [], 'type', 'A nota deve ser uma lista de blocos')
      return
    }
    const stack: Frame[] = []
    let depthReported = false
    this.pushChildren(stack, value, [], 1)
    while (stack.length > 0 && !this.out.full) {
      const frame = stack.pop() as Frame
      this.blocks++
      if (!this.fatalOnly && this.blocks > this.limits.maxBlocks) {
        this.out.add(false, [], 'maxBlocks', `A nota passa de ${this.limits.maxBlocks} blocos`)
        return
      }
      this.depth = Math.max(this.depth, frame.depth)
      const children = this.block(frame.block, frame.path)
      if (!children || children.length === 0) continue
      const at = [...frame.path, 'children']
      const depth = frame.depth + 1
      // Profundidade conferida antes de descer. Além do teto duro, o BlockNote
      // (recursivo) pode estourar a pilha: fatal, e não desce.
      if (depth > HARD_MAX_DEPTH) {
        this.out.add(true, at, 'maxDepth', `Mais de ${HARD_MAX_DEPTH} níveis de blocos aninhados`)
        continue
      }
      // O limite de contrato sai uma vez; o percurso segue até o teto duro, atrás do que é fatal.
      if (!this.fatalOnly && depth > this.limits.maxDepth && !depthReported) {
        depthReported = true
        this.out.add(false, at, 'maxDepth', `A nota passa de ${this.limits.maxDepth} níveis de blocos aninhados`)
      }
      this.pushChildren(stack, children, at, depth)
    }
  }

  pushChildren(stack: Frame[], list: unknown[], at: Segments, depth: number): void {
    for (let i = list.length - 1; i >= 0; i--) stack.push({ block: list[i], path: [...at, i], depth })
  }

  /** Confere o bloco; devolve os filhos para descer (ou null). */
  block(block: unknown, at: Segments): unknown[] | null {
    if (!isPlainObject(block)) {
      this.out.add(true, at, 'type', 'O bloco deve ser um objeto')
      return null
    }
    this.keys(block, BLOCK_KEYS, at)
    this.id(block, at)

    let spec: BlockSpecDef
    let type: string
    if (Object.hasOwn(block, 'type')) {
      if (typeof block.type !== 'string') {
        this.out.add(true, [...at, 'type'], 'type', 'O tipo do bloco deve ser texto')
        return null
      }
      const found = blockSpecOf(block.type)
      if (!found) {
        this.out.add(true, [...at, 'type'], 'enum', 'Tipo de bloco desconhecido')
        return null
      }
      spec = found
      type = block.type
    } else {
      if (this.full) this.out.add(false, at, 'required', 'Bloco sem type')
      spec = BLOCK_SPECS.paragraph
      type = 'paragraph'
    }

    this.props(block, type as BlockType, at)
    this.content(block, type, spec, at)

    if (!Object.hasOwn(block, 'children') || block.children === null) {
      if (this.full) this.out.add(false, [...at, 'children'], 'required', 'Bloco sem children')
      return null
    }
    if (!Array.isArray(block.children)) {
      this.out.add(true, [...at, 'children'], 'type', 'children deve ser uma lista de blocos')
      return null
    }
    return block.children
  }

  id(block: Json, at: Segments): void {
    if (!Object.hasOwn(block, 'id') || block.id === undefined) {
      if (this.full) this.out.add(false, at, 'required', 'Bloco sem id')
      return
    }
    const id = block.id
    const where = [...at, 'id']
    // Sem id o BlockNote gera um; id que não é texto, ou vazio, derruba a
    // montagem do editor ("Block doesn't have id", ou o bloco não é achado).
    if (typeof id !== 'string' || id === '') {
      this.out.add(true, where, 'type', 'O id deve ser texto não vazio')
      return
    }
    this.chars(id, where)
    if (!this.fatalOnly && longerThan(id, MAX_ID_LENGTH)) this.out.add(false, where, 'maxLength', `O id deve ter no máximo ${MAX_ID_LENGTH} caracteres`)
    if (this.duplicateIds === 'ignore') return
    if (this.reserved.has(id)) {
      this.out.add(true, where, 'duplicateId', 'Id que já existe na nota')
      return
    }
    const first = this.ids.get(id)
    if (first !== undefined) this.out.add(true, where, 'duplicateId', `Id repetido no documento (o primeiro está em ${first})`)
    else this.ids.set(id, jsonPointer(at))
  }

  props(block: Json, type: BlockType, at: Segments): void {
    const where = [...at, 'props']
    if (!Object.hasOwn(block, 'props') || block.props === null) {
      if (this.full) this.out.add(false, where, 'required', 'Bloco sem props')
      else if (type === 'projectCard') this.missingSnapshot(where)
      return
    }
    const props = block.props
    if (!isPlainObject(props)) {
      // O BlockNote ignora; o próximo save grava as props padrão.
      this.out.add(false, where, 'type', 'props deve ser um objeto')
      return
    }
    let simple = true
    for (const [name, value] of Object.entries(props)) {
      const at2 = [...where, name]
      this.chars(name, at2)
      if (!isPrimitive(value)) {
        this.out.add(true, at2, 'type', 'Valor de prop deve ser texto, número, booleano ou nulo')
        simple = false
      } else if (typeof value === 'string') this.chars(value, at2)
    }
    // props.id entra nos attrs do blockContainer e troca o id do bloco.
    if (Object.hasOwn(props, 'id')) this.out.add(true, [...where, 'id'], 'additionalProperties', 'props.id troca o id do bloco')
    if (type === 'heading' && Object.hasOwn(props, 'level') && !(BLOCK_SPECS.heading.propSchema.level.values as readonly unknown[]).includes(props.level)) {
      this.out.add(true, [...where, 'level'], 'enum', 'O nível do título deve ser um número de 1 a 6')
    }
    if (type === 'projectCard') {
      // Na completa, o schema das props já exige o snapshot.
      if (!this.full && props.snapshot === undefined) this.missingSnapshot(where)
      for (const issue of snapshotIssues(props.snapshot, { stored: this.stored, fatalOnly: this.fatalOnly })) {
        this.out.add(issue.fatal, [...where, 'snapshot'], 'snapshot', `${issue.path || '(raiz)'}: ${issue.message}`)
      }
    }
    if (this.fatalOnly || !simple) return
    const check = PROPS_CHECKS.get(type)
    const result = this.full ? check?.full(props) : check?.partial(props)
    if (result && !result.ok) this.out.addSchema(false, where, result.issues.filter(i => i.path !== '/id'))
    if (type === 'diagram') {
      for (const issue of diagramIssues(props)) {
        this.out.add(false, [...where, issue.prop], issue.prop, `${issue.path || '(raiz)'}: ${issue.message}`)
      }
    }
  }

  /**
   * Card sem snapshot: o normalize completaria o padrão '{}', que o contrato do
   * snapshot recusa; aceitá-lo aqui faria a nota gravada não voltar num PUT.
   */
  missingSnapshot(where: Segments): void {
    this.out.add(false, [...where, 'snapshot'], 'required', 'O card de projeto precisa do snapshot')
  }

  /** Um item em linha vira `count` nós, empilhados pelo BlockNote num só push(...nós). */
  itemNodes(count: number, at: Segments): boolean {
    if (count <= MAX_INLINE_NODES) return false
    this.out.add(true, at, 'maxInlineNodes', `O trecho vira ${count} nós no editor (texto e quebras de linha); o máximo é ${MAX_INLINE_NODES}`)
    return true
  }

  content(block: Json, type: string, spec: BlockSpecDef, at: Segments): void {
    const where = [...at, 'content']
    const has = Object.hasOwn(block, 'content') && block.content !== undefined
    const content = block.content
    if (spec.content === 'none') {
      if (!has) return
      const empty = content === null || content === '' || (Array.isArray(content) && content.length === 0)
      if (!empty) this.out.add(true, where, 'type', `Bloco ${type} não tem conteúdo em linha`)
      else if (this.full) this.out.add(false, where, 'additionalProperties', `Bloco ${type} não leva content`)
      return
    }
    if (spec.content === 'table') {
      if (!isPlainObject(content) || content.type !== 'tableContent') {
        this.out.add(true, where, 'type', 'A tabela precisa de content {type: "tableContent", rows}')
        return
      }
      this.table(content, where)
      return
    }
    // inline
    if (!has || content === null) {
      if (this.full) this.out.add(false, where, 'required', 'Bloco sem content')
      return
    }
    // O bloco de código não quebra o texto em hardBreak (spec.code do BlockNote).
    const code = type === 'codeBlock'
    if (typeof content === 'string') {
      this.chars(content, where)
      if (this.full) this.out.add(false, where, 'type', 'Na forma completa, content é uma lista')
      this.itemNodes(textNodeCount(content, code), where)
      return
    }
    if (!Array.isArray(content)) {
      this.out.add(true, where, 'type', 'content deve ser texto ou lista de conteúdo em linha')
      return
    }
    this.inline(content, where, code)
  }

  inline(items: unknown[], at: Segments, code: boolean): void {
    let total = 0
    let fatal = false
    items.forEach((item, i) => {
      const where = [...at, i]
      let count = 0
      if (typeof item === 'string') {
        this.chars(item, where)
        if (this.full) this.out.add(false, where, 'type', 'Na forma completa, o texto é {type: "text"}')
        count = textNodeCount(item, code)
      } else if (!isPlainObject(item)) {
        this.out.add(true, where, 'type', 'Conteúdo em linha deve ser texto ou objeto')
      } else if (item.type === 'text') {
        count = this.styledText(item, where, code)
      } else if (item.type === 'link') {
        count = this.link(item, where)
      } else {
        this.out.add(true, [...where, 'type'], 'enum', 'Conteúdo em linha desconhecido (só text e link)')
      }
      if (this.itemNodes(count, where)) fatal = true
      total += count
    })
    // Contrato: o editor junta os trechos vizinhos ao ler de volta (e o
    // normalize também); a lista inteira cabe no teto, e a forma canônica, que
    // nunca tem mais nós que a entrada, também.
    if (!fatal && total > MAX_INLINE_NODES) {
      this.out.add(false, at, 'maxInlineNodes', `O conteúdo vira ${total} nós no editor; o máximo é ${MAX_INLINE_NODES} (divida em mais blocos)`)
    }
  }

  /** Confere o texto com estilo; devolve quantos nós ele vira no editor. */
  styledText(item: Json, at: Segments, code: boolean): number {
    this.keys(item, TEXT_KEYS, at)
    let count = 0
    if (typeof item.text !== 'string') {
      this.out.add(true, [...at, 'text'], 'type', 'text deve ser texto')
    } else {
      this.chars(item.text, [...at, 'text'])
      if (this.full && item.text.length === 0) this.out.add(false, [...at, 'text'], 'minLength', 'Na forma completa, texto vazio não existe')
      count = textNodeCount(item.text, code)
    }
    const where = [...at, 'styles']
    if (!Object.hasOwn(item, 'styles') || item.styles === null || item.styles === undefined) {
      if (this.full) this.out.add(false, where, 'required', 'Texto sem styles')
      return count
    }
    if (!isPlainObject(item.styles)) {
      this.out.add(true, where, 'type', 'styles deve ser um objeto')
      return count
    }
    for (const [name, value] of Object.entries(item.styles)) {
      const at2 = [...where, name]
      this.chars(name, at2)
      const kind = styleKindOf(name)
      if (!kind) {
        this.out.add(true, at2, 'enum', 'Estilo desconhecido')
        continue
      }
      if (!isPrimitive(value)) {
        this.out.add(true, at2, 'type', 'Valor de estilo deve ser texto ou booleano')
        continue
      }
      if (this.fatalOnly) continue
      if (kind === 'boolean') {
        if (typeof value !== 'boolean') this.out.add(false, at2, 'type', 'Tipo inválido: esperado booleano')
        else if (this.full && !value) this.out.add(false, at2, 'const', 'Na forma completa, estilo desligado não aparece')
      } else if (typeof value !== 'string') {
        this.out.add(false, at2, 'type', 'Tipo inválido: esperado texto')
      } else {
        this.chars(value, at2)
        if (value.length === 0) {
          if (this.full) this.out.add(false, at2, 'minLength', 'Na forma completa, cor vazia não aparece')
        } else if (longerThan(value, MAX_COLOR_LENGTH)) {
          this.out.add(false, at2, 'maxLength', `Deve ter no máximo ${MAX_COLOR_LENGTH} caractere(s)`)
        }
      }
    }
    return count
  }

  /** Confere o link; devolve quantos nós ele vira (a soma das partes, sempre quebradas). */
  link(item: Json, at: Segments): number {
    this.keys(item, LINK_KEYS, at)
    const href = item.href
    const hrefAt = [...at, 'href']
    if (typeof href === 'string') {
      this.chars(href, hrefAt)
      if (!isAllowedHref(href)) this.out.add(false, hrefAt, 'format', 'Link com protocolo não permitido')
    } else if (href === undefined || href === null) {
      this.out.add(false, hrefAt, 'required', 'O link precisa de href em texto')
    } else {
      // O render do link chama href.replace (isAllowedUri): número ou objeto derruba a montagem.
      this.out.add(true, hrefAt, 'type', 'href deve ser texto')
    }
    const where = [...at, 'content']
    const content = item.content
    // linkToNodes não passa o tipo do bloco: o link quebra até no bloco de código.
    if (typeof content === 'string') {
      this.chars(content, where)
      if (this.full) this.out.add(false, where, 'type', 'Na forma completa, o conteúdo do link é uma lista')
      return textNodeCount(content, false)
    }
    if (!Array.isArray(content)) {
      this.out.add(true, where, 'type', 'O conteúdo do link deve ser texto ou lista de textos')
      return 0
    }
    if (this.full && content.length === 0) this.out.add(false, where, 'minItems', 'Na forma completa, link vazio não existe')
    let count = 0
    content.forEach((part, i) => {
      if (isPlainObject(part) && part.type === 'text') count += this.styledText(part, [...where, i], false)
      else this.out.add(true, [...where, i], 'type', 'Dentro do link só entra {type: "text"} (nem link, nem texto solto)')
    })
    return count
  }

  table(content: Json, at: Segments): void {
    this.keys(content, TABLE_KEYS, at)
    const rows = content.rows
    if (!Array.isArray(rows) || rows.length === 0) {
      this.out.add(true, [...at, 'rows'], Array.isArray(rows) ? 'minItems' : 'type', 'A tabela precisa de pelo menos uma linha')
      return
    }
    let sound = true
    rows.forEach((row, r) => {
      const where = [...at, 'rows', r]
      if (!isPlainObject(row) || !Array.isArray(row.cells) || row.cells.length === 0) {
        this.out.add(true, where, 'type', 'A linha precisa de cells com pelo menos uma célula')
        sound = false
        return
      }
      this.keys(row, CELLS_KEYS, where)
      row.cells.forEach((cell, c) => {
        if (!this.cell(cell, [...where, 'cells', c])) sound = false
      })
    })
    for (const key of ['headerRows', 'headerCols'] as const) {
      if (!Object.hasOwn(content, key) || content[key] === undefined) continue
      const value = content[key]
      const where = [...at, key]
      const max = key === 'headerRows' ? TABLE_LIMITS.maxCells : TABLE_LIMITS.maxColumns
      if (value === null) {
        if (this.full) this.out.add(false, where, 'type', `${key} deve ser inteiro`)
      } else if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
        this.out.add(true, where, 'type', `${key} deve ser inteiro de 0 a ${max}`)
        sound = false
      } else if (this.full && value === 0) {
        this.out.add(false, where, 'minimum', `Na forma completa, ${key} 0 não aparece`)
      }
    }
    if (!sound) return
    const typedRows = rows as { cells: unknown[] }[]
    const grid = tableGridProblem(typedRows)
    if (grid) {
      this.out.add(true, [...at, ...grid.at], grid.keyword, grid.message)
      return
    }
    // Célula com props e sem content: o BlockNote a mede com largura 1 ao
    // carregar, mas o editor.document (o que o autosave grava) e o normalize a
    // completam, e aí o colspan conta. Se a grade não fecha nessa forma, a nota
    // salva não abre de novo: fatal já na entrada.
    if (typedRows.some(row => row.cells.some(cell => widthSpan(cell, false) !== widthSpan(cell, true)))) {
      const full = tableGridProblem(typedRows, true)
      if (full) {
        this.out.add(true, [...at, ...full.at], full.keyword, `Na forma completa (o colspan de toda célula conta na largura): ${full.message}`)
        return
      }
    }
    if (!this.fatalOnly) this.tableCells(typedRows.length * tableWidth(typedRows, false), at)
    this.columnWidths(content, typedRows, at)
  }

  /** Contrato: o create é quadrático por tabela; teto por tabela e por nota (Σ células²). */
  tableCells(cells: number, at: Segments): void {
    const over = cells > TABLE_LIMITS.contractCells
    if (over) this.out.add(false, at, 'maxCells', `A tabela passa de ${TABLE_LIMITS.contractCells} células (o editor fica lento)`)
    this.tableCost += cells * cells
    if (!over && !this.tableCostReported && this.tableCost > TABLE_LIMITS.noteCellCost) {
      this.tableCostReported = true
      this.out.add(false, at, 'maxCells', `As tabelas da nota passam do teto de células da nota inteira (soma de células² acima de ${TABLE_LIMITS.noteCellCost}; o editor fica lento)`)
    }
  }

  columnWidths(content: Json, rows: { cells: unknown[] }[], at: Segments): void {
    const where = [...at, 'columnWidths']
    if (!Object.hasOwn(content, 'columnWidths') || content.columnWidths === undefined) {
      if (this.full) this.out.add(false, where, 'required', 'Tabela sem columnWidths')
      return
    }
    const widths = content.columnWidths
    const width = tableWidth(rows, false)
    if (!Array.isArray(widths) || widths.length > width) {
      this.out.add(true, where, Array.isArray(widths) ? 'maxItems' : 'type', 'columnWidths deve ser uma lista do tamanho da grade')
      return
    }
    if (this.fatalOnly) return
    const firstRow = rows[0].cells.reduce<number>((sum, cell) => sum + widthSpan(cell, true), 0)
    if (this.full && widths.length !== firstRow) this.out.add(false, where, 'minItems', 'Na forma completa, columnWidths tem uma entrada por coluna')
    widths.forEach((w, i) => {
      if (w !== null && !(typeof w === 'number' && Number.isFinite(w) && w > 0)) this.out.add(false, [...where, i], 'type', 'Largura deve ser número maior que 0 ou nulo')
    })
  }

  /** Confere a célula; false quando ela impede a conta da grade. */
  cell(cell: unknown, at: Segments): boolean {
    if (cell === null || cell === undefined) {
      if (this.full) this.out.add(false, at, 'type', 'Na forma completa, a célula é {type: "tableCell"}')
      return true
    }
    if (typeof cell === 'string') {
      this.chars(cell, at)
      if (this.full) this.out.add(false, at, 'type', 'Na forma completa, a célula é {type: "tableCell"}')
      // Carrega como um nó só (schema.text), mas o editor.document e o normalize
      // a devolvem como [text], que na próxima abertura quebra em hardBreaks.
      this.itemNodes(textNodeCount(cell, false), at)
      return true
    }
    if (Array.isArray(cell)) {
      if (this.full) this.out.add(false, at, 'type', 'Na forma completa, a célula é {type: "tableCell"}')
      this.inline(cell, at, false)
      return true
    }
    if (!isPlainObject(cell) || cell.type !== 'tableCell') {
      this.out.add(true, at, 'type', 'A célula deve ser texto, lista em linha ou {type: "tableCell"}')
      return false
    }
    this.keys(cell, CELL_KEYS, at)
    let sound = true
    const where = [...at, 'props']
    if (cell.props === null) {
      // getColspan lê cell.props.colspan quando há content: null lança.
      this.out.add(true, where, 'type', 'props da célula não pode ser nulo')
      sound = false
    } else if (cell.props === undefined) {
      if (this.full) this.out.add(false, where, 'required', 'Célula sem props')
    } else if (!isPlainObject(cell.props)) {
      this.out.add(false, where, 'type', 'props da célula deve ser um objeto')
    } else {
      const props = cell.props
      let simple = true
      for (const [name, value] of Object.entries(props)) {
        this.chars(name, [...where, name])
        if (!isPrimitive(value)) {
          this.out.add(true, [...where, name], 'type', 'Valor de prop deve ser texto, número, booleano ou nulo')
          simple = false
        } else if (typeof value === 'string') this.chars(value, [...where, name])
      }
      for (const key of ['colspan', 'rowspan'] as const) {
        if (!Object.hasOwn(props, key)) continue
        const value = props[key]
        if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > TABLE_LIMITS.maxSpan) {
          this.out.add(true, [...where, key], 'type', `${key} deve ser inteiro de 1 a ${TABLE_LIMITS.maxSpan}`)
          sound = false
        }
      }
      if (simple && !this.fatalOnly) {
        const result = (this.full ? CELL_PROPS_CHECKS.full : CELL_PROPS_CHECKS.partial)(props)
        if (!result.ok) this.out.addSchema(false, where, result.issues)
      }
      if (!simple) sound = false
    }
    const content = cell.content
    const at2 = [...at, 'content']
    if (content === undefined || content === null || content === '') {
      if (this.full) this.out.add(false, at2, 'required', 'Célula sem content')
    } else if (typeof content === 'string') {
      this.chars(content, at2)
      if (this.full) this.out.add(false, at2, 'type', 'Na forma completa, content é uma lista')
      // Carrega letra a letra, mas volta como um texto só (ver a célula em texto).
      this.itemNodes(textNodeCount(content, false), at2)
    } else if (Array.isArray(content)) {
      this.inline(content, at2, false)
    } else {
      this.out.add(true, at2, 'type', 'content da célula deve ser texto ou lista em linha')
      sound = false
    }
    return sound
  }
}

const CELLS_KEYS = new Set(['cells'])

function measure(value: unknown, known: number | undefined): number | 'error' {
  if (known !== undefined) return known
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    // RangeError: aninhamento além da pilha do JSON.stringify ou texto além do teto do V8.
    return 'error'
  }
}

/**
 * Confere uma nota inteira. `ok` só sem nenhum problema; os fatais vêm
 * primeiro e, no máximo, `maxIssues` (20, como o _api/schema.ts).
 */
export function validateNoteContent(value: unknown, opts: ValidateOptions = {}): NoteValidation {
  const walker = new Walker(opts)
  try {
    walker.run(value)
  } catch (err) {
    // Nada aqui deveria lançar; se lançar (pilha, memória), a nota é recusada, nunca um 500.
    walker.out.add(true, [], 'internal', `Não foi possível conferir a nota (${err instanceof RangeError ? 'grande ou aninhada demais' : 'erro interno'})`)
  }
  let bytes: number | null = null
  if (!walker.fatalOnly && Array.isArray(value)) {
    const size = measure(value, opts.bytes)
    if (size === 'error') walker.out.add(false, [], 'maxBytes', 'Conteúdo grande ou aninhado demais para medir')
    else {
      bytes = size
      if (size > walker.limits.maxBytes) walker.out.add(false, [], 'maxBytes', `A nota passa de ${walker.limits.maxBytes} bytes`)
    }
  }
  const stats: NoteStats = { blocks: walker.blocks, depth: walker.depth, bytes }
  const issues = walker.out.result()
  return issues.length === 0 ? { ok: true, issues: [], stats } : { ok: false, issues, stats }
}

/**
 * Guarda do NoteEditor: o primeiro problema fatal do conteúdo (gravado,
 * rascunho offline ou remoto), ou null se o editor pode abri-lo.
 */
export function findFatalNoteIssue(value: unknown): BlockIssue | null {
  const result = validateNoteContent(value, { stored: true, fatalOnly: true, maxIssues: 1 })
  return result.ok ? null : result.issues[0]
}

/**
 * Para o corpo do erro da API (`validationFailed` do _api/errors.ts): o mesmo
 * formato do SchemaIssue, sem o campo `fatal` (que não é documentado), com os
 * fatais primeiro.
 */
export function toSchemaIssues(issues: readonly BlockIssue[]): SchemaIssue[] {
  return [...issues.filter(i => i.fatal), ...issues.filter(i => !i.fatal)].map(({ path, keyword, message }) => ({ path, keyword, message }))
}

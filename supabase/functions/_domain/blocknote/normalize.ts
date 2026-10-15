// API-020: leva uma nota válida (forma parcial do BlockNote) até a forma
// canônica: a que o editor devolve em editor.document. Assim a nota escrita
// pela API não muda ao ser aberta no app (nada de versão nova nem conflito do
// REL-009 só por abrir). O resultado é ponto fixo do BlockNote 0.50 (o
// src/components/noteSchema.test.ts carrega cada saída no editor e compara) e
// idempotente.
//
// O que muda (só forma, nunca conteúdo):
// - ids preservados ou gerados (newId injetável); com renameDuplicateIds, o
//   repetido que vem depois ganha id novo (conteúdo gravado);
// - props completas, na ordem do propSchema (start e previewWidth só se vieram);
// - conteúdo em linha como o ProseMirror o devolve: estilos desligados somem,
//   textos e links vizinhos iguais se juntam, texto vazio some, a quebra de
//   linha fica com o trecho anterior;
// - tabela com células tableCell completas, columnWidths do tamanho da
//   primeira linha e headerRows/headerCols no ponto fixo do editor;
// - bloco sem conteúdo fica sem a chave content; children sempre lista.
//
// Os limites de contrato valem sobre a saída, que é o que a API grava: a forma
// completa pode crescer muito (cada célula vira tableCell com props), então o
// normalize mede o que devolve (2 MiB) e confere de novo as tabelas com a
// largura completa. Assim, normalize ok ⇒ a saída passa na forma completa e
// normalizá-la de novo devolve o mesmo.

import { validateNoteContent, type BlockIssue } from './schema.ts'
import { tableGridProblem, tableWidth } from './table.ts'
import {
  BLOCK_SPECS, LIMITS, STYLE_SPECS, TABLE_CELL_DEFAULTS, TABLE_LIMITS, blockSpecOf,
  type BlockType, type Limits, type PropPrimitive, type StyleName,
} from './spec.ts'

export type Styles = Partial<Record<StyleName, true | string>>
export interface StyledText { type: 'text'; text: string; styles: Styles }
export interface LinkContent { type: 'link'; href: string; content: StyledText[] }
export type InlineItem = StyledText | LinkContent

export interface TableCell {
  type: 'tableCell'
  content: InlineItem[]
  props: { colspan: number; rowspan: number; backgroundColor: string; textColor: string; textAlignment: string }
}

export interface TableContent {
  type: 'tableContent'
  columnWidths: (number | null)[]
  headerRows?: number
  headerCols?: number
  rows: { cells: TableCell[] }[]
}

export interface NoteBlock {
  id: string
  type: BlockType
  props: Record<string, PropPrimitive>
  content?: InlineItem[] | TableContent
  children: NoteBlock[]
}

export interface NormalizeOptions {
  /** Gerador de ids (fixtures determinísticas); o padrão é UUID v4. */
  newId?: () => string
  /** Conteúdo gravado: troca o id repetido que vem depois, em vez de recusar. */
  renameDuplicateIds?: boolean
  /** Ids que já existem na nota (anexar): repetir um deles recusa, ou troca com renameDuplicateIds. */
  reservedIds?: Iterable<string>
  /** Modo gravado (tolera chave a mais no snapshot do card). */
  stored?: boolean
  limits?: Partial<Limits>
}

export type NoteNormalization = { ok: true; blocks: NoteBlock[] } | { ok: false; issues: BlockIssue[] }

type Json = Record<string, unknown>

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type CryptoLike = { randomUUID?: () => string; getRandomValues: <T extends Uint8Array>(array: T) => T }

/** UUID v4: crypto.randomUUID, ou getRandomValues onde ele não existe (http fora do localhost no navegador). */
export function defaultNewId(crypto: CryptoLike = (globalThis as unknown as { crypto: CryptoLike }).crypto): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── Tamanho da saída ──────────────────────────────────────────────────────────

/**
 * Estimativa corrente do JSON da saída, sempre por baixo (texto pelo
 * comprimento UTF-16, que nunca passa dos bytes UTF-8): passou do teto, para
 * antes de montar dezenas de MB (5000 tabelas 7x7 de células vazias, 1,4 MB na
 * entrada, viram uns 33 MB na forma completa). O tamanho exato é medido no fim.
 */
class Meter {
  remaining: number
  constructor(maxBytes: number) {
    this.remaining = maxBytes
  }

  spend(bytes: number): void {
    this.remaining -= bytes
    if (this.remaining < 0) throw new OverBudget()
  }

  inline(items: readonly InlineItem[]): void {
    for (const item of items) {
      if (item.type === 'text') {
        this.spend(TEXT_MIN_BYTES + item.text.length)
        continue
      }
      this.spend(LINK_MIN_BYTES + item.href.length)
      for (const part of item.content) this.spend(TEXT_MIN_BYTES + part.text.length)
    }
  }
}

class OverBudget extends Error {}

const BLOCK_MIN_BYTES = JSON.stringify({ id: '', type: '', props: {}, children: [] }).length
const CELL_MIN_BYTES = JSON.stringify({ type: 'tableCell', content: [], props: { colspan: 1, rowspan: 1, backgroundColor: '', textColor: '', textAlignment: '' } }).length
const ROW_MIN_BYTES = JSON.stringify({ cells: [] }).length
const TEXT_MIN_BYTES = JSON.stringify({ type: 'text', text: '', styles: {} }).length
const LINK_MIN_BYTES = JSON.stringify({ type: 'link', href: '', content: [] }).length

function primitiveBytes(value: PropPrimitive): number {
  return typeof value === 'string' ? value.length + 2 : (JSON.stringify(value) ?? '').length
}

// ── Conteúdo em linha ─────────────────────────────────────────────────────────

/** Um nó de texto do ProseMirror (com as marcas) ou uma quebra de linha (hardBreak). */
type Run = { text: string; styles: Styles; href: string | null } | null

function canonicalStyles(raw: unknown): Styles {
  const styles: Styles = {}
  if (!isPlainObject(raw)) return styles
  for (const name of Object.keys(STYLE_SPECS) as StyleName[]) {
    if (!Object.hasOwn(raw, name)) continue
    const value = raw[name]
    if (STYLE_SPECS[name] === 'boolean' ? value === true : typeof value === 'string' && value !== '') styles[name] = value as true | string
  }
  return styles
}

function sameStyles(a: Styles, b: Styles): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Como o BlockNote cria os nós: fora do bloco de código, cada \n vira
 * hardBreak; no código, o texto fica inteiro. O conteúdo do link sempre quebra
 * (linkToNodes não passa o tipo do bloco).
 */
function pushText(runs: Run[], text: string, styles: Styles, href: string | null, code: boolean): void {
  if (code && href === null) {
    if (text) runs.push({ text, styles, href })
    return
  }
  for (const piece of text.split(/(\n)/)) {
    if (piece === '\n') runs.push(null)
    else if (piece) runs.push({ text: piece, styles, href })
  }
}

function runsOf(content: unknown, code: boolean): Run[] {
  const runs: Run[] = []
  if (typeof content === 'string') {
    pushText(runs, content, {}, null, code)
    return runs
  }
  if (!Array.isArray(content)) return runs
  for (const item of content) {
    if (typeof item === 'string') pushText(runs, item, {}, null, code)
    else if (isPlainObject(item) && item.type === 'text') pushText(runs, item.text as string, canonicalStyles(item.styles), null, code)
    else if (isPlainObject(item) && item.type === 'link') {
      const href = item.href as string
      if (typeof item.content === 'string') pushText(runs, item.content, {}, href, code)
      else for (const part of item.content as Json[]) pushText(runs, part.text as string, canonicalStyles(part.styles), href, code)
    }
  }
  return runs
}

/** contentNodeToInlineContent: lê os nós de volta como o BlockNote. */
function readBack(runs: Run[]): InlineItem[] {
  const out: InlineItem[] = []
  let current: InlineItem | null = null
  for (const run of runs) {
    if (run === null) {
      // hardBreak: vai para o fim do trecho anterior; sem trecho, vira texto sem estilo.
      if (!current) current = { type: 'text', text: '\n', styles: {} }
      else if (current.type === 'text') current.text += '\n'
      else current.content[current.content.length - 1].text += '\n'
      continue
    }
    const text: StyledText = { type: 'text', text: run.text, styles: run.styles }
    if (!current) {
      current = run.href === null ? text : { type: 'link', href: run.href, content: [text] }
    } else if (current.type === 'text') {
      if (run.href === null && sameStyles(current.styles, run.styles)) current.text += run.text
      else {
        out.push(current)
        current = run.href === null ? text : { type: 'link', href: run.href, content: [text] }
      }
    } else if (run.href !== null && run.href === current.href) {
      const last = current.content[current.content.length - 1]
      if (sameStyles(last.styles, run.styles)) last.text += run.text
      else current.content.push(text)
    } else {
      out.push(current)
      current = run.href === null ? text : { type: 'link', href: run.href, content: [text] }
    }
  }
  if (current) out.push(current)
  return out
}

function normalizeInline(content: unknown, code: boolean, meter: Meter): InlineItem[] {
  const items = readBack(runsOf(content, code))
  meter.inline(items)
  return items
}

// ── Tabela ────────────────────────────────────────────────────────────────────

function normalizeCell(cell: unknown, meter: Meter): TableCell {
  meter.spend(CELL_MIN_BYTES)
  const props = { ...TABLE_CELL_DEFAULTS } as TableCell['props']
  const full = isPlainObject(cell) && cell.type === 'tableCell'
  if (full && isPlainObject(cell.props)) {
    for (const key of Object.keys(TABLE_CELL_DEFAULTS) as (keyof TableCell['props'])[]) {
      if (Object.hasOwn(cell.props, key)) (props as Record<string, unknown>)[key] = cell.props[key]
    }
  }
  // Texto solto, lista em linha ou o content da tableCell; vazio vira [].
  const content = full ? cell.content : cell
  return { type: 'tableCell', content: content ? normalizeInline(content, false, meter) : [], props }
}

/**
 * headerRows/headerCols no ponto fixo do editor. O BlockNote marca como
 * cabeçalho a célula (r, c) com r < headerRows ou c < headerCols (c é o índice
 * da célula na linha) e, ao ler, conta as linhas todas cabeçalho e as colunas
 * todas cabeçalho. Numa tabela irregular a leitura muda os números; repetindo
 * até parar, a saída carrega igual.
 */
function headerFixedPoint(rows: { cells: unknown[] }[], headerRows: number, headerCols: number): { headerRows: number; headerCols: number } {
  const lengths = rows.map(r => r.cells.length)
  const R = rows.length
  const minLen = Math.min(...lengths)
  // A primeira leitura parte dos números da entrada (que podem passar da tabela).
  const hr0 = Math.min(headerRows, R)
  let hr = hr0
  for (let r = hr0; r < R; r++) if (lengths[r] <= headerCols) hr++
  const hc = headerRows >= R ? minLen : Math.min(headerCols, minLen)
  // Daí em diante: hr só cresce (linhas com todas as células nas colunas de
  // cabeçalho) e hc fica em min(hc, menor linha) até todas as linhas serem cabeçalho.
  for (let guard = 0; guard <= R + 1; guard++) {
    if (hr >= R) return { headerRows: R, headerCols: minLen }
    let extra = 0
    for (let r = hr; r < R; r++) if (lengths[r] <= hc) extra++
    if (extra === 0) return { headerRows: hr, headerCols: hc }
    hr += extra
  }
  return { headerRows: hr, headerCols: hc }
}

function normalizeTable(content: Json, meter: Meter): TableContent | 'grid' {
  const rawRows = content.rows as Json[]
  const rows = rawRows.map(row => {
    meter.spend(ROW_MIN_BYTES)
    return { cells: (row.cells as unknown[]).map(cell => normalizeCell(cell, meter)) }
  })
  // A forma completa conta o colspan de toda célula na largura: confere de novo.
  if (tableGridProblem(rows, true)) return 'grid'
  const firstRow = rows[0].cells.reduce((sum, cell) => sum + cell.props.colspan, 0)
  const widths = Array.isArray(content.columnWidths) ? content.columnWidths : []
  const columnWidths = Array.from({ length: firstRow }, (_, i) => {
    const w = widths[i]
    return typeof w === 'number' && w > 0 ? w : null
  })
  const header = headerFixedPoint(rows, typeof content.headerRows === 'number' ? content.headerRows : 0, typeof content.headerCols === 'number' ? content.headerCols : 0)
  return {
    type: 'tableContent',
    columnWidths,
    ...(header.headerRows > 0 ? { headerRows: header.headerRows } : {}),
    ...(header.headerCols > 0 ? { headerCols: header.headerCols } : {}),
    rows,
  }
}

// ── Blocos ────────────────────────────────────────────────────────────────────

class Normalizer {
  readonly seen: Set<string>
  readonly newId: () => string
  readonly rename: boolean
  readonly meter: Meter
  gridAt: string | null = null
  /** O primeiro limite de contrato que só a forma completa estoura. */
  contract: BlockIssue | null = null
  tableCost = 0

  constructor(opts: NormalizeOptions, maxBytes: number) {
    this.seen = new Set(opts.reservedIds ?? [])
    this.newId = opts.newId ?? (() => defaultNewId())
    this.rename = opts.renameDuplicateIds ?? false
    this.meter = new Meter(maxBytes)
  }

  /**
   * Os tetos de células do validador (tabela e nota, na mesma ordem), agora com
   * a largura completa: célula com props e sem content passa a contar o colspan.
   */
  tableCells(rows: readonly { cells: readonly unknown[] }[], path: string): void {
    const cells = rows.length * tableWidth(rows, true)
    const over = cells > TABLE_LIMITS.contractCells
    this.tableCost += cells * cells
    if (this.contract) return
    if (over) this.contract = { path, keyword: 'maxCells', message: `A tabela passa de ${TABLE_LIMITS.contractCells} células na forma completa (o editor fica lento)`, fatal: false }
    else if (this.tableCost > TABLE_LIMITS.noteCellCost) {
      this.contract = { path, keyword: 'maxCells', message: `As tabelas da nota passam do teto de células da nota inteira na forma completa (soma de células² acima de ${TABLE_LIMITS.noteCellCost})`, fatal: false }
    }
  }

  freshId(): string {
    for (let i = 0; i < 100; i++) {
      const id = this.newId()
      if (!this.seen.has(id)) return id
    }
    throw new Error('newId devolveu ids repetidos')
  }

  id(raw: unknown): string {
    const id = typeof raw === 'string' && raw !== '' && !(this.rename && this.seen.has(raw)) ? raw : this.freshId()
    this.seen.add(id)
    return id
  }

  // Recursivo: o validador já limitou a profundidade.
  blocks(list: unknown[], path: string): NoteBlock[] {
    return list.map((raw, i) => this.block(raw as Json, `${path}/${i}`))
  }

  block(raw: Json, path: string): NoteBlock {
    const id = this.id(raw.id)
    const type = (typeof raw.type === 'string' ? raw.type : 'paragraph') as BlockType
    const spec = blockSpecOf(type) ?? BLOCK_SPECS.paragraph
    const given = isPlainObject(raw.props) ? raw.props : {}
    const props: Record<string, PropPrimitive> = {}
    this.meter.spend(BLOCK_MIN_BYTES + id.length + type.length)
    for (const [name, prop] of Object.entries(spec.propSchema) as [string, { default?: PropPrimitive }][]) {
      if (Object.hasOwn(given, name)) props[name] = given[name] as PropPrimitive
      else if (prop.default !== undefined) props[name] = prop.default
      if (Object.hasOwn(props, name)) this.meter.spend(name.length + 3 + primitiveBytes(props[name]))
    }
    let content: NoteBlock['content']
    if (spec.content === 'inline') content = raw.content ? normalizeInline(raw.content, type === 'codeBlock', this.meter) : []
    else if (spec.content === 'table') {
      const table = normalizeTable(raw.content as Json, this.meter)
      if (table === 'grid') this.gridAt ??= `${path}/content`
      else {
        content = table
        this.tableCells(table.rows, `${path}/content`)
      }
    }
    const children = Array.isArray(raw.children) ? this.blocks(raw.children, `${path}/children`) : []
    // A ordem das chaves é a do editor.document: id, type, props, content, children.
    return content === undefined ? { id, type, props, children } : { id, type, props, content, children }
  }
}

/**
 * Valida (forma parcial) e devolve a forma canônica. Com problema, devolve os
 * problemas do validador e nada é normalizado; também recusa (maxBytes, não
 * fatal) quando a forma canônica passa de 2 MiB, e (maxCells) quando só a
 * largura completa estoura os tetos de células.
 */
export function normalizeNoteContent(value: unknown, opts: NormalizeOptions = {}): NoteNormalization {
  const rename = opts.renameDuplicateIds ?? false
  const check = validateNoteContent(value, {
    form: 'partial',
    stored: opts.stored,
    limits: opts.limits,
    duplicateIds: rename ? 'ignore' : 'reject',
    reservedIds: rename ? undefined : opts.reservedIds,
  })
  if (!check.ok) return { ok: false, issues: check.issues }
  const { maxBytes } = { ...LIMITS, ...opts.limits }
  const tooBig: NoteNormalization = {
    ok: false,
    issues: [{ path: '', keyword: 'maxBytes', message: `A nota na forma canônica (a que é gravada) passa de ${maxBytes} bytes`, fatal: false }],
  }
  const normalizer = new Normalizer(opts, maxBytes)
  let blocks: NoteBlock[]
  try {
    blocks = normalizer.blocks(value as unknown[], '')
  } catch (err) {
    if (err instanceof OverBudget) return tooBig
    throw err
  }
  if (normalizer.gridAt) {
    return { ok: false, issues: [{ path: normalizer.gridAt, keyword: 'table', message: 'A tabela não fecha a grade na forma completa', fatal: true }] }
  }
  if (normalizer.contract) return { ok: false, issues: [normalizer.contract] }
  // A estimativa fica por baixo: o tamanho que vale é o do JSON compacto gravado.
  if (new TextEncoder().encode(JSON.stringify(blocks)).length > maxBytes) return tooBig
  return { ok: true, blocks }
}

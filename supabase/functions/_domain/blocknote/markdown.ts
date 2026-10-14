// API-023: Markdown → nota (blocos BlockNote), sem DOM, para a API (API-044)
// escrever notas a partir do que uma IA manda. O parser de blocos é um porte
// enxuto do commonmark.js (pilha de contêineres, uma passada por linha); o em
// linha fica no markdownInline.ts; o caminho de volta, no render.ts.
//
// Subconjunto (docs/api-arquitetura.md §3): títulos ATX e setext; parágrafo
// (quebra suave → espaço, quebra dura → \n); listas `-`/`+`/`*`/`N.`/`N)`
// aninhadas até a profundidade do contrato, com `start` quando o 1º número não
// é 1 ou quando a lista vem logo depois de outra numerada; checklist, inclusive
// numerada; citação (achatada); código cercado ou indentado; tabela GFM;
// divisor; imagem; definições de referência; HTML só como comentário (o
// marcador de bloco) ou descartado.
//
// Validação em duas fases: os blocos novos passam pelo normalizeNoteContent
// (forma canônica, contrato inteiro), com os ids herdados reservados; os
// herdados (bloco intacto da reconciliação, marcador, imagem conhecida) entram
// como estão, e a nota final passa por validateNoteContent({ stored, fatalOnly })
// mais noteLimitIssues. Assim uma nota antiga com desvio de contrato não trava
// a regravação. Os problemas voltam com a linha do Markdown.

import { MAX_ISSUES, type SchemaIssue } from '../../_api/schema.ts'
import {
  BOLD, CODE, ITALIC, MARKDOWN_SYNTAX_LIMITS, STRIKE,
  linkDestination, linkLabelLength, linkTitle, normalizeLabel, parseInline, skipSpaceNewline, unescapeString,
  type InlinePiece, type InlineWarning, type LinkRef,
} from './markdownInline.ts'
import { defaultNewId, normalizeNoteContent, type InlineItem, type NoteBlock } from './normalize.ts'
import { reconcile, type Slot } from './reconcile.ts'
import { MARKER_TYPES, blocksToMarkdown, parseMarkerLine, withUniqueIds, type MarkdownRender, type RenderLoss } from './render.ts'
import { findFatalNoteIssue, noteLimitIssues, validateNoteContent, type BlockIssue } from './schema.ts'
import { stripClosingHashes, trimEndSpaceTab, trimSpaceTab } from './spaceTab.ts'
import { HARD_MAX_DEPTH, LIMITS, TABLE_LIMITS, isAllowedHref, type Limits, type PropPrimitive } from './spec.ts'

/**
 * Limite de entrada (decisão 3 do plano): 512 KiB de Markdown por chamada,
 * em bytes UTF-8. Os tetos da sintaxe mantêm o parser linear; o de citações
 * aninhadas protege o achatamento.
 */
export const MARKDOWN_LIMITS = { maxBytes: 512 * 1024, ...MARKDOWN_SYNTAX_LIMITS, maxQuoteDepth: 32 } as const

export type MarkdownMode = 'replace' | 'append'

export interface MarkdownImageRules {
  /** Dono da pasta: o 1º segmento do caminho (`${userId}/${pageId}/arquivo`). */
  userId: string
  pageId: string
}

export interface MarkdownOptions {
  /** A nota atual (content de note_contents; pode ser null). */
  existing?: unknown
  /** Sem regras, só passa imagem cuja url já está na nota (falha fechada). */
  images?: MarkdownImageRules
  /** 'replace' (padrão): o Markdown é a nota inteira. 'append': blocos a anexar. */
  mode?: MarkdownMode
  /** Ids que os blocos novos não podem usar. */
  reservedIds?: Iterable<string>
  newId?: () => string
  limits?: Partial<Limits>
}

export interface MarkdownIssue {
  /** Linha do Markdown (1 em diante); 0 quando o problema é da nota inteira. */
  line: number
  /** JSON Pointer na nota final, quando há. */
  path: string
  keyword: string
  message: string
  fatal: boolean
}

export type MarkdownWarningCode = InlineWarning | 'quoteFlattened' | 'imageSplit' | 'imageInCell' | 'footnote' | 'softBreak'

export interface MarkdownWarning {
  line: number
  code: MarkdownWarningCode
  message: string
}

export type MarkdownResult =
  | {
    ok: true
    /** replace: a nota inteira; append: só os blocos a anexar. */
    blocks: NoteBlock[]
    warnings: MarkdownWarning[]
    /** Caminhos de imagem que não estavam na nota: o API-044 confere que o objeto existe. */
    newImagePaths: string[]
    /** O que a nota perdeu: as perdas do render dos blocos que não voltaram intactos. */
    losses: RenderLoss[]
  }
  | { ok: false; issues: MarkdownIssue[]; warnings: MarkdownWarning[] }

const WARNING_TEXT: Record<MarkdownWarningCode, string> = {
  htmlDropped: 'HTML descartado: fica só o texto',
  unsafeLink: 'Link sem destino ou com protocolo não permitido: ficou só o texto',
  quoteFlattened: 'Citação com lista, código, título ou tabela virou texto com quebras de linha',
  imageSplit: 'Imagem no meio do texto virou um bloco próprio',
  imageInCell: 'Imagem não cabe em célula de tabela: ficou o texto alternativo',
  footnote: 'Nota de rodapé não é suportada: ficou como texto',
  softBreak: 'Quebra de linha simples vira espaço; para quebrar a linha, termine-a com \\ ou deixe uma linha em branco',
}

// ── Contexto ──────────────────────────────────────────────────────────────────

class Stop extends Error {}

class Context {
  readonly issues: MarkdownIssue[] = []
  readonly warnings: MarkdownWarning[] = []
  readonly warned = new Set<string>()
  readonly limits: Limits
  readonly quiet: boolean

  constructor(limits: Limits, quiet = false) {
    this.limits = limits
    this.quiet = quiet
  }

  issue(line: number, keyword: string, message: string, fatal = false, path = ''): void {
    if (this.issues.length < MAX_ISSUES * 4) this.issues.push({ line, path, keyword, message, fatal })
  }

  /** Problema que para a leitura (limites): nada depois dele faz sentido. */
  stop(line: number, keyword: string, message: string): never {
    this.issue(line, keyword, message)
    throw new Stop()
  }

  warn(line: number, code: MarkdownWarningCode): void {
    if (this.quiet) return
    const key = code === 'softBreak' ? code : `${code}:${line}`
    if (this.warned.has(key) || this.warnings.length >= MAX_ISSUES) return
    this.warned.add(key)
    this.warnings.push({ line, code, message: WARNING_TEXT[code] })
  }
}

// ── Entrada ───────────────────────────────────────────────────────────────────

/** Bytes UTF-8 sem alocar; a linha em que o limite estoura, ou 0. */
function overLimitLine(md: string, max: number): number {
  let bytes = 0
  let line = 1
  for (let i = 0; i < md.length; i++) {
    const c = md.charCodeAt(i)
    if (c === 10) line++
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < md.length && (md.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4
      i++
    } else bytes += 3
    if (bytes > max) return line
  }
  return 0
}

/** CRLF e CR viram LF; o BOM sai; \u0000 e surrogate solto viram U+FFFD (o jsonb recusa o original). */
function prepare(md: string): string {
  const s = md.charCodeAt(0) === 0xfeff ? md.slice(1) : md
  // eslint-disable-next-line no-control-regex
  return s.replace(/\r\n?/g, '\n').replace(/\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�')
}

// ── Blocos (porte do commonmark.js) ───────────────────────────────────────────

type BType = 'document' | 'quote' | 'list' | 'item' | 'paragraph' | 'heading' | 'hr' | 'code' | 'html' | 'table'
type Align = 'left' | 'center' | 'right'

interface ListData {
  ordered: boolean
  bullet: string
  delimiter: string
  start: number
  markerOffset: number
  padding: number
}

interface BNode {
  type: BType
  parent: BNode | null
  children: BNode[]
  open: boolean
  line: number
  lines: string[]
  lineNos: number[]
  level: number
  fenceChar: string
  fenceLength: number
  fenceOffset: number
  list: ListData | null
  items: number
  quotes: number
  aligns: Align[]
  width: number
  rows: { cells: string[]; line: number }[]
  closed: boolean
}

function bnode(type: BType, parent: BNode | null, line: number): BNode {
  return {
    type, parent, children: [], open: true, line, lines: [], lineNos: [], level: 0, fenceChar: '', fenceLength: 0, fenceOffset: 0,
    list: null, items: parent ? parent.items + (type === 'item' ? 1 : 0) : 0, quotes: parent ? parent.quotes + (type === 'quote' ? 1 : 0) : 0,
    aligns: [], width: 0, rows: [], closed: false,
  }
}

const ACCEPTS_LINES = new Set<BType>(['paragraph', 'code', 'html', 'table'])
const MAYBE_SPECIAL = /[#`~*+_=<>0-9\-|:]/
const ATX = /#{1,6}(?:[ \t]+|$)/y
// A cerca de crases não pode ter crase depois dela na linha. O (?!`) prende a
// corrida inteira: sem ele, cada recuo da corrida varria de novo o resto da linha.
const FENCE = /`{3,}(?!`)(?![^\n]*`)|~{3,}/y
const CLOSING_FENCE = /(?:`{3,}|~{3,})(?=[ \t]*$)/y
const SETEXT = /(?:=+|-+)[ \t]*$/y
const HR = /(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/y
const ORDERED = /([0-9]{1,9})([.)])/y
const DELIM_CELL = /^:?-+:?$/

function isSpaceOrTab(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t'
}

/** Divide uma linha de tabela em células: `\|` vira `|` (até dentro do código); bordas `|` opcionais. */
export function splitRow(raw: string): string[] {
  const s = trimSpaceTab(raw)
  const cells: string[] = []
  // A célula sai por trechos (slice), não caractere a caractere: somar um a um
  // numa célula de centenas de milhares de caracteres fica superlinear no V8.
  let cur = ''
  let last = 0
  let endsWithPipe = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    endsWithPipe = false
    if (ch === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '|') {
        cur += s.slice(last, i) + '|'
        last = i + 2
      }
      i++
    } else if (ch === '|') {
      cells.push(cur + s.slice(last, i))
      cur = ''
      last = i + 1
      endsWithPipe = true
    }
  }
  cells.push(cur + s.slice(last))
  if (s.startsWith('|')) cells.shift()
  if (endsWithPipe && cells.length > 0) cells.pop()
  return cells.map(trimSpaceTab)
}

/** Linha de alinhamento da tabela (com pelo menos um `|`), ou null. */
function delimiterRow(raw: string): Align[] | null {
  if (!raw.includes('|')) return null
  const cells = splitRow(raw)
  if (cells.length === 0 || !cells.every(c => DELIM_CELL.test(c))) return null
  return cells.map(c => (c.startsWith(':') && c.endsWith(':') && c.length > 1 ? 'center' : c.endsWith(':') ? 'right' : 'left'))
}

class BlockParser {
  readonly ctx: Context
  readonly doc: BNode = bnode('document', null, 1)
  readonly refs = new Map<string, LinkRef>()
  tip: BNode = this.doc
  oldtip: BNode = this.doc
  lastMatched: BNode = this.doc
  allClosed = true
  line = ''
  lineNo = 0
  offset = 0
  column = 0
  nextNonspace = 0
  nextNonspaceColumn = 0
  indent = 0
  indented = false
  blank = false
  partialTab = false
  blocks = 0
  /** A linha e o offset da última varredura do findNextNonspace (a memória dela). */
  scanLine = -1
  scanFrom = 0

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  run(src: string): BNode {
    const lines = src.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) this.incorporate(line)
    while (this.tip !== this.doc) this.finalize(this.tip)
    this.finalize(this.doc)
    return this.doc
  }

  count(line: number): void {
    if (++this.blocks > this.ctx.limits.maxBlocks) this.ctx.stop(line, 'maxBlocks', `O Markdown passa de ${this.ctx.limits.maxBlocks} blocos`)
  }

  findNextNonspace(): void {
    // Memória da linha: cada contêiner aberto chama esta conta, e o recuo de
    // uma lista funda seria varrido de novo a cada nível (linhas × profundidade
    // × recuo). Do mesmo começo ou de um ponto dentro da corrida já varrida, o
    // próximo não-espaço é o mesmo, e a coluna dele também (as paradas de tab
    // são colunas absolutas): só o recuo muda, contado da coluna atual.
    if (this.scanLine === this.lineNo && this.offset >= this.scanFrom && this.offset <= this.nextNonspace) {
      this.indent = this.nextNonspaceColumn - this.column
      this.indented = this.indent >= 4
      return
    }
    this.scanLine = this.lineNo
    this.scanFrom = this.offset
    const ln = this.line
    let i = this.offset
    let cols = this.column
    for (;;) {
      const ch = ln[i]
      if (ch === ' ') cols++
      else if (ch === '\t') cols += 4 - (cols % 4)
      else break
      i++
    }
    this.blank = i >= ln.length
    this.nextNonspace = i
    this.nextNonspaceColumn = cols
    this.indent = cols - this.column
    this.indented = this.indent >= 4
  }

  advanceNextNonspace(): void {
    this.offset = this.nextNonspace
    this.column = this.nextNonspaceColumn
    this.partialTab = false
  }

  /** Avança `count` caracteres (ou colunas, com `columns`), contando o tab até a próxima parada de 4. */
  advanceOffset(count: number, columns: boolean): void {
    const ln = this.line
    let left = count
    while (left > 0 && this.offset < ln.length) {
      if (ln[this.offset] === '\t') {
        const toTab = 4 - (this.column % 4)
        if (columns) {
          this.partialTab = toTab > left
          const adv = toTab > left ? left : toTab
          this.column += adv
          this.offset += this.partialTab ? 0 : 1
          left -= adv
        } else {
          this.partialTab = false
          this.column += toTab
          this.offset += 1
          left -= 1
        }
      } else {
        this.partialTab = false
        this.offset += 1
        this.column += 1
        left -= 1
      }
    }
  }

  addLine(): void {
    let text = this.line.slice(this.offset)
    if (this.partialTab) {
      text = ' '.repeat(4 - (this.column % 4)) + this.line.slice(this.offset + 1)
    }
    const tip = this.tip
    if (tip.type === 'table') {
      // Linha em branco é só espaço e tab, como no CommonMark (NBSP é conteúdo).
      if (/^[ \t]*$/.test(text)) return
      const cells = splitRow(text)
      tip.rows.push({ cells, line: this.lineNo })
      if (tip.rows.length * tip.width > TABLE_LIMITS.maxCells) this.ctx.stop(this.lineNo, 'maxCells', `A tabela passa de ${TABLE_LIMITS.maxCells} células`)
      return
    }
    tip.lines.push(text)
    tip.lineNos.push(this.lineNo)
  }

  addChild(type: BType): BNode {
    while (!this.canContain(this.tip.type, type)) this.finalize(this.tip)
    const n = bnode(type, this.tip, this.lineNo)
    this.tip.children.push(n)
    this.tip = n
    if (type === 'item' && n.items > this.ctx.limits.maxDepth) {
      this.ctx.stop(this.lineNo, 'maxDepth', `A lista passa de ${this.ctx.limits.maxDepth} níveis de aninhamento`)
    }
    if (type === 'quote' && n.quotes > MARKDOWN_LIMITS.maxQuoteDepth) {
      this.ctx.stop(this.lineNo, 'maxDepth', `A citação passa de ${MARKDOWN_LIMITS.maxQuoteDepth} níveis de aninhamento`)
    }
    // Blocos que viram bloco da nota (dentro de citação, tudo vira o texto da citação).
    if (type !== 'list' && type !== 'paragraph' && type !== 'html' && n.parent?.quotes === 0) this.count(this.lineNo)
    return n
  }

  canContain(parent: BType, child: BType): boolean {
    if (parent === 'document' || parent === 'quote' || parent === 'item') return child !== 'item'
    if (parent === 'list') return child === 'item'
    return false
  }

  finalize(block: BNode): void {
    block.open = false
    const parent = block.parent
    if (block.type === 'paragraph') {
      this.extractRefs(block)
      if (block.lines.length === 0) {
        // O bloco que fecha é sempre o último filho: lastIndexOf é O(1) (indexOf
        // varria a citação inteira a cada definição, e a citação não tem teto de filhos).
        parent?.children.splice(parent.children.lastIndexOf(block), 1)
      } else if (block.quotes === 0 && !(parent?.type === 'item' && parent.children[0] === block)) {
        this.count(block.line)
      }
    } else if (block.type === 'code' && block.fenceLength === 0) {
      while (block.lines.length > 0 && /^[ \t]*$/.test(block.lines[block.lines.length - 1])) {
        block.lines.pop()
        block.lineNos.pop()
      }
    }
    this.tip = parent ?? this.doc
  }

  closeUnmatched(): void {
    if (this.allClosed) return
    while (this.oldtip !== this.lastMatched) {
      const parent = this.oldtip.parent as BNode
      this.finalize(this.oldtip)
      this.oldtip = parent
    }
    this.allClosed = true
  }

  /** Continuação de um contêiner aberto: 0 casou, 1 não casou, 2 fechou a cerca (linha consumida). */
  continues(block: BNode): 0 | 1 | 2 {
    const ln = this.line
    switch (block.type) {
      case 'quote':
        if (!this.indented && ln[this.nextNonspace] === '>') {
          this.advanceNextNonspace()
          this.advanceOffset(1, false)
          if (isSpaceOrTab(ln[this.offset])) this.advanceOffset(1, true)
          return 0
        }
        return 1
      case 'item': {
        const list = block.list as ListData
        if (this.blank) {
          if (block.children.length === 0) return 1
          this.advanceNextNonspace()
          return 0
        }
        if (this.indent >= list.markerOffset + list.padding) {
          this.advanceOffset(list.markerOffset + list.padding, true)
          return 0
        }
        return 1
      }
      case 'list':
      case 'html':
        return 0
      case 'code':
        if (block.fenceLength > 0) {
          CLOSING_FENCE.lastIndex = this.nextNonspace
          const m = this.indent <= 3 && ln[this.nextNonspace] === block.fenceChar ? CLOSING_FENCE.exec(ln) : null
          if (m && m[0].length >= block.fenceLength) {
            this.finalize(block)
            return 2
          }
          let i = block.fenceOffset
          while (i > 0 && isSpaceOrTab(ln[this.offset])) {
            this.advanceOffset(1, true)
            i--
          }
          return 0
        }
        if (this.indent >= 4) {
          this.advanceOffset(4, true)
          return 0
        }
        if (this.blank) {
          this.advanceNextNonspace()
          return 0
        }
        return 1
      case 'paragraph':
      case 'table':
        return this.blank ? 1 : 0
      default:
        return 1
    }
  }

  incorporate(ln: string): void {
    let container = this.doc
    this.oldtip = this.tip
    this.offset = 0
    this.column = 0
    this.blank = false
    this.partialTab = false
    this.lineNo++
    this.line = ln
    for (let last = container.children[container.children.length - 1]; last && last.open; last = container.children[container.children.length - 1]) {
      container = last
      this.findNextNonspace()
      const r = this.continues(container)
      if (r === 2) return
      if (r === 1) {
        container = container.parent as BNode
        break
      }
    }
    this.allClosed = container === this.oldtip
    this.lastMatched = container
    let matchedLeaf = container.type !== 'paragraph' && container.type !== 'table' && ACCEPTS_LINES.has(container.type)
    while (!matchedLeaf) {
      this.findNextNonspace()
      if (!this.indented && !MAYBE_SPECIAL.test(ln[this.nextNonspace] ?? '')) {
        this.advanceNextNonspace()
        break
      }
      const res = this.blockStart(container)
      if (res === 0) {
        this.advanceNextNonspace()
        break
      }
      container = this.tip
      if (res === 2) matchedLeaf = true
    }
    if (!this.allClosed && !this.blank && this.tip.type === 'paragraph') {
      // Continuação preguiçosa do parágrafo.
      this.addLine()
      return
    }
    this.closeUnmatched()
    if (ACCEPTS_LINES.has(container.type)) {
      this.addLine()
      if (container.type === 'html' && this.line.slice(this.offset).includes('-->')) {
        container.closed = true
        this.finalize(container)
      }
    } else if (this.offset < ln.length && !this.blank) {
      this.addChild('paragraph')
      this.advanceNextNonspace()
      this.addLine()
    }
  }

  /** As aberturas de bloco, na ordem do commonmark.js (com a tabela do GFM depois do setext). 0, 1 (contêiner) ou 2 (folha). */
  blockStart(container: BNode): 0 | 1 | 2 {
    const ln = this.line
    const at = this.nextNonspace
    const ch = ln[at]
    if (!this.indented) {
      if (ch === '>') {
        this.advanceNextNonspace()
        this.advanceOffset(1, false)
        if (isSpaceOrTab(ln[this.offset])) this.advanceOffset(1, true)
        this.closeUnmatched()
        this.addChild('quote')
        return 1
      }
      if (ch === '#') {
        ATX.lastIndex = at
        const m = ATX.exec(ln)
        if (m) {
          this.advanceNextNonspace()
          this.advanceOffset(m[0].length, false)
          this.closeUnmatched()
          const h = this.addChild('heading')
          h.level = m[0].trim().length
          h.lines = [stripClosingHashes(ln.slice(this.offset))]
          h.lineNos = [this.lineNo]
          this.advanceOffset(ln.length - this.offset, false)
          return 2
        }
      }
      if (ch === '`' || ch === '~') {
        FENCE.lastIndex = at
        const m = FENCE.exec(ln)
        if (m) {
          this.closeUnmatched()
          const code = this.addChild('code')
          code.fenceLength = m[0].length
          code.fenceChar = m[0][0]
          code.fenceOffset = this.indent
          this.advanceNextNonspace()
          this.advanceOffset(m[0].length, false)
          return 2
        }
      }
      if (ch === '<' && ln.startsWith('<!--', at)) {
        this.closeUnmatched()
        this.addChild('html')
        return 2
      }
      if (container.type === 'paragraph' && (ch === '=' || ch === '-')) {
        SETEXT.lastIndex = at
        if (SETEXT.test(ln)) {
          this.closeUnmatched()
          this.extractRefs(container)
          if (container.lines.length > 0) {
            container.type = 'heading'
            container.level = ch === '=' ? 1 : 2
            this.tip = container
            if (container.quotes === 0) this.count(container.line)
            this.advanceOffset(ln.length - this.offset, false)
            return 2
          }
        }
      }
      if (container.type === 'paragraph' && container.lines.length > 0) {
        const aligns = delimiterRow(ln.slice(at))
        const header = aligns ? splitRow(container.lines[container.lines.length - 1]) : null
        if (aligns && header && header.length === aligns.length) {
          if (aligns.length > TABLE_LIMITS.maxColumns) this.ctx.stop(this.lineNo, 'maxColumns', `A tabela passa de ${TABLE_LIMITS.maxColumns} colunas`)
          this.closeUnmatched()
          const headerLine = container.lineNos[container.lineNos.length - 1]
          let table: BNode
          if (container.lines.length > 1) {
            // As linhas de cima continuam parágrafo; a última vira o cabeçalho.
            container.lines.pop()
            container.lineNos.pop()
            this.finalize(container)
            table = this.addChild('table')
          } else {
            container.type = 'table'
            table = container
            if (container.quotes === 0) this.count(container.line)
          }
          table.line = headerLine
          table.aligns = aligns
          table.width = aligns.length
          table.rows = [{ cells: header, line: headerLine }]
          table.lines = []
          table.lineNos = []
          this.tip = table
          this.advanceOffset(ln.length - this.offset, false)
          return 2
        }
      }
      HR.lastIndex = at
      if ((ch === '*' || ch === '_' || ch === '-') && HR.test(ln)) {
        this.closeUnmatched()
        this.addChild('hr')
        this.advanceOffset(ln.length - this.offset, false)
        return 2
      }
    }
    if (!this.indented || container.type === 'list') {
      const data = this.listMarker(container)
      if (data) {
        this.closeUnmatched()
        const tip = this.tip
        if (tip.type !== 'list' || !sameList(tip.list as ListData, data)) {
          const list = this.addChild('list')
          list.list = data
        }
        const item = this.addChild('item')
        item.list = data
        return 1
      }
    }
    if (this.indented && this.tip.type !== 'paragraph' && this.tip.type !== 'table' && !this.blank) {
      this.advanceOffset(4, true)
      this.closeUnmatched()
      this.addChild('code')
      return 2
    }
    return 0
  }

  listMarker(container: BNode): ListData | null {
    if (this.indent >= 4) return null
    const ln = this.line
    const at = this.nextNonspace
    const ch = ln[at]
    let markerLength: number
    const data: ListData = { ordered: false, bullet: '', delimiter: '', start: 1, markerOffset: this.indent, padding: 0 }
    if (ch === '*' || ch === '+' || ch === '-') {
      data.bullet = ch
      markerLength = 1
    } else {
      ORDERED.lastIndex = at
      const m = ORDERED.exec(ln)
      if (!m || (container.type === 'paragraph' && parseInt(m[1], 10) !== 1)) return null
      data.ordered = true
      data.start = parseInt(m[1], 10)
      data.delimiter = m[2]
      markerLength = m[0].length
    }
    const next = ln[at + markerLength]
    if (next !== undefined && !isSpaceOrTab(next)) return null
    // Interromper parágrafo só com item que tem conteúdo; em branco é só espaço
    // e tab, como no CommonMark (o item só com NBSP, U+3000 ou \f interrompe).
    if (container.type === 'paragraph' && /^[ \t]*$/.test(ln.slice(at + markerLength))) return null
    this.advanceNextNonspace()
    this.advanceOffset(markerLength, true)
    const startCol = this.column
    const startOffset = this.offset
    do {
      this.advanceOffset(1, true)
    } while (this.column - startCol < 5 && isSpaceOrTab(ln[this.offset]))
    const blankItem = this.offset >= ln.length
    const spaces = this.column - startCol
    if (spaces >= 5 || spaces < 1 || blankItem) {
      data.padding = markerLength + 1
      this.column = startCol
      this.offset = startOffset
      this.partialTab = false
      if (isSpaceOrTab(ln[this.offset])) this.advanceOffset(1, true)
    } else {
      data.padding = markerLength + spaces
    }
    return data
  }

  /** Definições de referência no começo do parágrafo saem dele (e valem para o documento). */
  extractRefs(block: BNode): void {
    if (block.lines.length === 0 || !block.lines[0].startsWith('[')) return
    const text = block.lines.join('\n')
    let pos = 0
    while (text.charCodeAt(pos) === 91) {
      const end = this.reference(text, pos, block)
      if (end === 0) break
      pos = end
    }
    if (pos === 0) return
    if (pos >= text.length) {
      block.lines = []
      block.lineNos = []
      return
    }
    // As definições consomem linhas inteiras: sobram as últimas.
    let left = 1
    for (let i = pos; i < text.length; i++) if (text.charCodeAt(i) === 10) left++
    block.lines = block.lines.slice(block.lines.length - left)
    block.lineNos = block.lineNos.slice(block.lineNos.length - left)
  }

  /** Uma definição `[rótulo]: destino "título"` em `pos`: o fim (depois da quebra de linha) ou 0. */
  reference(s: string, pos: number, block: BNode): number {
    const labelLength = linkLabelLength(s, pos)
    if (labelLength === 0 || s[pos + labelLength] !== ':') return 0
    const raw = s.slice(pos + 1, pos + labelLength - 1)
    if (raw.startsWith('^')) {
      // Nota de rodapé do GFM: fica texto.
      let line = block.lineNos[0]
      for (let i = 0; i < pos; i++) if (s.charCodeAt(i) === 10) line++
      this.ctx.warn(line, 'footnote')
      return 0
    }
    let p = skipSpaceNewline(s, pos + labelLength + 1)
    const dest = linkDestination(s, p)
    if (!dest) return 0
    p = dest.end
    const beforeTitle = p
    const atLineEnd = (i: number): number => {
      let k = i
      while (s[k] === ' ' || s[k] === '\t') k++
      if (k >= s.length) return k
      return s[k] === '\n' ? k + 1 : -1
    }
    let title = ''
    let end = -1
    const q = skipSpaceNewline(s, p)
    if (q !== beforeTitle) {
      const t = linkTitle(s, q)
      if (t) {
        end = atLineEnd(t.end)
        if (end >= 0) title = t.title
      }
    }
    if (end < 0) end = atLineEnd(beforeTitle)
    if (end < 0) return 0
    const label = normalizeLabel(raw)
    if (label === '') return 0
    if (!this.refs.has(label)) this.refs.set(label, { href: dest.href, title })
    return end
  }
}

function sameList(a: ListData, b: ListData): boolean {
  return a.ordered === b.ordered && a.delimiter === b.delimiter && a.bullet === b.bullet
}

// ── Representação intermediária ───────────────────────────────────────────────

interface IRTable {
  type: 'tableContent'
  headerRows: 1
  rows: { cells: { type: 'tableCell'; props?: { textAlignment: string }; content: InlineItem[] }[] }[]
}

interface IRBlock {
  type: string
  props?: Record<string, PropPrimitive>
  content?: InlineItem[] | IRTable
  children: IRBlock[]
  line: number
  marker?: { id: string; type: string }
  image?: { src: string; alt: string; title: string }
  rowLines?: number[]
}

function styleObject(bits: number): Record<string, true> {
  const styles: Record<string, true> = {}
  if (bits & BOLD) styles.bold = true
  if (bits & ITALIC) styles.italic = true
  if (bits & STRIKE) styles.strike = true
  if (bits & CODE) styles.code = true
  return styles
}

/** Trechos de texto → conteúdo em linha parcial: vizinhos com o mesmo estilo e o mesmo link se juntam. */
function toInline(pieces: Extract<InlinePiece, { kind: 'text' }>[]): InlineItem[] {
  const out: InlineItem[] = []
  let lastStyles = -1
  let lastHref: string | null = null
  for (const p of pieces) {
    const last = out[out.length - 1]
    if (last && p.styles === lastStyles && p.href === lastHref) {
      const target = last.type === 'link' ? last.content[last.content.length - 1] : last
      target.text += p.text
      continue
    }
    const text = { type: 'text' as const, text: p.text, styles: styleObject(p.styles) }
    if (p.href === null) out.push(text)
    else if (last && last.type === 'link' && last.href === p.href) last.content.push(text)
    else out.push({ type: 'link', href: p.href, content: [text] })
    lastStyles = p.styles
    lastHref = p.href
  }
  return out
}

const isBlankText = (p: InlinePiece) => p.kind === 'text' && /^[ \t\n]*$/.test(p.text)

/** Tira os espaços e quebras das bordas de um trecho que encosta numa imagem. */
function trimPieces(list: Extract<InlinePiece, { kind: 'text' }>[], start: boolean, end: boolean): typeof list {
  // As bordas por índice e um corte só: shift em laço copia o array a cada
  // passo (imagem seguida de milhares de quebras duras ficava quadrática).
  let first = 0
  let last = list.length
  if (start) while (first < last && isBlankText(list[first])) first++
  if (end) while (last > first && isBlankText(list[last - 1])) last--
  const out = list.slice(first, last).map(p => ({ ...p }))
  if (start && out.length > 0 && out[0].styles === 0) out[0].text = out[0].text.replace(/^[ \t]+/, '')
  const tail = out[out.length - 1]
  if (end && tail && tail.styles === 0) tail.text = trimEndSpaceTab(tail.text)
  return out.filter(p => p.text !== '')
}

/** Posição no texto de uma folha → linha do Markdown (as quebras indexadas uma vez, busca binária). */
class LineIndex {
  readonly subject: string
  readonly lineNos: readonly number[]
  breaks: number[] | null = null

  constructor(subject: string, lineNos: readonly number[]) {
    this.subject = subject
    this.lineNos = lineNos
  }

  at(offset: number): number {
    if (!this.breaks) {
      this.breaks = []
      for (let i = this.subject.indexOf('\n'); i >= 0; i = this.subject.indexOf('\n', i + 1)) this.breaks.push(i)
    }
    let lo = 0
    let hi = this.breaks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.breaks[mid] < offset) lo = mid + 1
      else hi = mid
    }
    return this.lineNos[Math.min(lo, this.lineNos.length - 1)] ?? 0
  }
}

type TextPiece = Extract<InlinePiece, { kind: 'text' }>
type ImagePiece = Extract<InlinePiece, { kind: 'image' }>

class Converter {
  readonly ctx: Context
  readonly refs: ReadonlyMap<string, LinkRef>

  constructor(ctx: Context, refs: ReadonlyMap<string, LinkRef>) {
    this.ctx = ctx
    this.refs = refs
  }

  /** Conteúdo em linha de uma folha (linhas unidas por \n); avisos e erros com a linha. */
  inline(subject: string, index: LineIndex): InlinePiece[] {
    return parseInline(trimEndSpaceTab(subject), {
      refs: this.refs,
      allowHref: isAllowedHref,
      warn: (code, offset) => this.ctx.warn(index.at(offset), code),
      fail: (keyword, message, offset) => this.ctx.issue(index.at(offset), keyword, message),
    })
  }

  image(p: ImagePiece, index: LineIndex): IRBlock {
    return { type: 'image', children: [], line: index.at(p.offset), image: { src: p.src, alt: p.alt, title: p.title } }
  }

  /** Parágrafo → parágrafos e imagens: a imagem no meio do texto divide o parágrafo. */
  paragraph(node: BNode): IRBlock[] {
    const subject = node.lines.join('\n')
    const index = new LineIndex(subject, node.lineNos)
    const pieces = this.inline(subject, index)
    if (!pieces.some(p => p.kind === 'image')) {
      return pieces.length > 0 ? [{ type: 'paragraph', content: toInline(pieces as TextPiece[]), children: [], line: node.line }] : []
    }
    const out: IRBlock[] = []
    let texts: TextPiece[] = []
    let line = node.line
    let hasText = false
    const flush = (before: boolean, after: boolean) => {
      const kept = trimPieces(texts, before, after)
      if (kept.length > 0) {
        hasText = true
        out.push({ type: 'paragraph', content: toInline(kept), children: [], line })
      }
      texts = []
    }
    let afterImage = false
    for (const p of pieces) {
      if (p.kind === 'text') {
        texts.push(p)
        continue
      }
      flush(afterImage, true)
      const image = this.image(p, index)
      out.push(image)
      line = image.line
      afterImage = true
    }
    flush(true, false)
    if (hasText) this.ctx.warn(node.line, 'imageSplit')
    return out
  }

  /** Texto e imagens separadas (título, item, citação): as imagens saem do texto. */
  textAndImages(subject: string, lineNos: readonly number[], firstLine: number): { content: InlineItem[]; images: IRBlock[] } {
    const index = new LineIndex(subject, lineNos)
    const pieces = this.inline(subject, index)
    const texts: TextPiece[] = []
    const images: IRBlock[] = []
    for (const p of pieces) {
      if (p.kind === 'text') texts.push(p)
      else images.push(this.image(p, index))
    }
    if (images.length === 0) return { content: toInline(texts), images }
    const kept = trimPieces(texts, true, true)
    if (kept.length > 0) this.ctx.warn(firstLine, 'imageSplit')
    return { content: toInline(kept), images }
  }

  code(node: BNode): IRBlock {
    let text: string
    const props: Record<string, PropPrimitive> = {}
    if (node.fenceLength > 0) {
      const info = unescapeString((node.lines[0] ?? '').trim())
      const language = info.split(/[ \t]+/)[0]
      if (language) props.language = language
      text = node.lines.slice(1).join('\n')
    } else {
      text = node.lines.join('\n')
    }
    return {
      type: 'codeBlock',
      ...(Object.keys(props).length > 0 ? { props } : {}),
      content: text ? [{ type: 'text', text, styles: {} }] : [],
      children: [],
      line: node.line,
    }
  }

  table(node: BNode): IRBlock {
    const rows = node.rows.map(row => ({
      cells: node.aligns.map((align, c) => {
        const raw = row.cells[c] ?? ''
        const pieces = this.inline(raw, new LineIndex(raw, [row.line]))
        const texts: Extract<InlinePiece, { kind: 'text' }>[] = []
        for (const p of pieces) {
          if (p.kind === 'text') texts.push(p)
          else {
            this.ctx.warn(row.line, 'imageInCell')
            if (p.alt) texts.push({ kind: 'text', text: p.alt, styles: 0, href: null })
          }
        }
        return { type: 'tableCell' as const, ...(align !== 'left' ? { props: { textAlignment: align } } : {}), content: toInline(texts) }
      }),
    }))
    return { type: 'table', content: { type: 'tableContent', headerRows: 1, rows }, children: [], line: node.line, rowLines: node.rows.map(r => r.line) }
  }

  marker(node: BNode): IRBlock | null {
    const raw = node.lines.join('\n').trim()
    if (!/^<!--\s*akool:/.test(raw)) {
      if (raw.replace(/^<!--|-->$/g, '').trim() !== '') this.ctx.warn(node.line, 'htmlDropped')
      return null
    }
    const parsed = node.lines.length === 1 && node.closed ? parseMarkerLine(raw) : null
    if (!parsed) {
      this.ctx.issue(node.line, 'marker', 'Marcador de bloco malformado (o formato é <!-- akool:bloco id="…" tipo="…" -->, numa linha só)')
      return null
    }
    return { type: 'marker', children: [], line: node.line, marker: parsed }
  }

  /** Citação achatada: cada folha vira uma linha; imagens saem para depois da citação. */
  quote(node: BNode): IRBlock[] {
    const groups: InlineItem[][] = []
    const images: IRBlock[] = []
    let lossy = false
    const stack: BNode[] = [...node.children].reverse()
    while (stack.length > 0) {
      const n = stack.pop() as BNode
      switch (n.type) {
        case 'paragraph':
        case 'heading': {
          if (n.type === 'heading') lossy = true
          const r = this.textAndImages(n.lines.join('\n'), n.lineNos, n.line)
          images.push(...r.images)
          if (r.content.length > 0) groups.push(r.content)
          break
        }
        case 'code': {
          lossy = true
          const c = this.code(n).content as InlineItem[]
          if (c.length > 0) groups.push(c)
          break
        }
        case 'table':
          lossy = true
          for (const row of (this.table(n).content as IRTable).rows) {
            const line: InlineItem[] = []
            row.cells.forEach((cell, i) => {
              if (i > 0) line.push({ type: 'text', text: ' | ', styles: {} })
              line.push(...cell.content)
            })
            groups.push(line)
          }
          break
        case 'html': {
          if (/^<!--\s*akool:/.test(n.lines.join('\n').trim())) this.ctx.issue(n.line, 'marker', 'Marcador de bloco dentro de citação: a citação não tem blocos dentro')
          else this.marker(n)
          break
        }
        case 'hr':
          lossy = true
          break
        default:
          // Lista, item e citação dentro da citação: o texto das folhas, em ordem.
          lossy = true
          for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
      }
    }
    if (lossy) this.ctx.warn(node.line, 'quoteFlattened')
    const content: InlineItem[] = []
    groups.forEach((g, i) => {
      if (i > 0) content.push({ type: 'text', text: '\n', styles: {} })
      content.push(...g)
    })
    return [{ type: 'quote', content, children: [], line: node.line }, ...images]
  }

  item(node: BNode): IRBlock {
    const first = node.children[0]
    let content: InlineItem[] = []
    let images: IRBlock[] = []
    let checked: boolean | null = null
    let rest = node.children
    if (first && first.type === 'paragraph') {
      let subject = first.lines.join('\n')
      const task = /^\[([ xX])\](?=[ \t]|$)/.exec(subject)
      if (task) {
        checked = task[1] !== ' '
        subject = subject.slice(task[0].length).replace(/^[ \t]+/, '')
      }
      const r = this.textAndImages(subject, first.lineNos, first.line)
      content = r.content
      images = r.images
      rest = node.children.slice(1)
    }
    const list = node.list as ListData
    const type = checked !== null ? 'checkListItem' : list.ordered ? 'numberedListItem' : 'bulletListItem'
    return {
      type,
      ...(checked ? { props: { checked: true } } : {}),
      content,
      children: [...images, ...this.blocks(rest)],
      line: node.line,
    }
  }

  blocks(nodes: readonly BNode[]): IRBlock[] {
    const out: IRBlock[] = []
    // A lista do último item numerado emitido neste nível (para o `start`).
    let numberedList: BNode | null = null
    for (const node of nodes) {
      const before = out.length
      switch (node.type) {
        case 'paragraph':
          out.push(...this.paragraph(node))
          break
        case 'heading': {
          const r = this.textAndImages(node.lines.join('\n'), node.lineNos, node.line)
          out.push({ type: 'heading', props: { level: node.level }, content: r.content, children: [], line: node.line }, ...r.images)
          break
        }
        case 'hr':
          out.push({ type: 'divider', children: [], line: node.line })
          break
        case 'code':
          out.push(this.code(node))
          break
        case 'table':
          out.push(this.table(node))
          break
        case 'quote':
          out.push(...this.quote(node))
          break
        case 'html': {
          const marker = this.marker(node)
          if (marker) out.push(marker)
          break
        }
        case 'list': {
          const list = node.list as ListData
          node.children.forEach((child, idx) => {
            const ir = this.item(child)
            if (ir.type === 'numberedListItem') {
              const number = list.start + idx
              const runStart = numberedList === null
              if ((runStart && number !== 1) || (!runStart && numberedList !== node)) ir.props = { ...ir.props, start: number }
              numberedList = node
            } else numberedList = null
            out.push(ir)
          })
          continue
        }
      }
      if (out.length > before) numberedList = null
    }
    return out
  }
}

/** Markdown → blocos intermediários (sem resolver marcador e imagem). */
function parseMarkdown(src: string, ctx: Context): IRBlock[] {
  const parser = new BlockParser(ctx)
  const doc = parser.run(src)
  const ir = new Converter(ctx, parser.refs).blocks(doc.children)
  let count = 0
  const walk = (list: IRBlock[]) => {
    for (const b of list) {
      if (++count > ctx.limits.maxBlocks) ctx.stop(b.line, 'maxBlocks', `O Markdown passa de ${ctx.limits.maxBlocks} blocos`)
      walk(b.children)
    }
  }
  walk(ir)
  return ir
}

/** Chave da projeção de um bloco (o que a reconciliação compara). */
function keyOf(ir: IRBlock): string {
  return JSON.stringify(ir, (k, v) => (k === 'line' || k === 'rowLines' ? undefined : v))
}

// ── Resolução: marcadores, imagens, ids ───────────────────────────────────────

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const IMAGE_PATH = new RegExp(`^(${UUID})/(${UUID})/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.(?:jpe?g|png|webp|gif|heic|heif)$`)

const PLACEHOLDER = 'akool-md-'

interface Resolved {
  /** Bloco parcial para o normalize; os herdados aninhados vão como marcador de lugar. */
  partial: Json | null
  /** Bloco herdado (na raiz), que entra como está. */
  inherited: Json | null
}

class Resolver {
  readonly ctx: Context
  readonly mode: MarkdownMode
  readonly images: MarkdownImageRules | undefined
  readonly markerIndex = new Map<string, Json>()
  readonly knownImages = new Map<string, Json[]>()
  /** Ids que estão na nota final (herdados) ou reservados. */
  readonly used: Set<string>
  readonly allIds: Set<string>
  readonly usedMarkers = new Set<string>()
  readonly placeholders = new Map<string, Json>()
  readonly newImagePaths: string[] = []
  /** Blocos da nota atual cujas props voltaram (marcador, imagem conhecida): as perdas deles não valem. */
  readonly inheritedFrom = new Set<string>()
  readonly newId: () => string

  constructor(ctx: Context, existing: unknown[], opts: MarkdownOptions, used: Set<string>) {
    this.ctx = ctx
    this.mode = opts.mode ?? 'replace'
    this.images = opts.images
    this.used = used
    this.newId = opts.newId ?? (() => defaultNewId())
    this.allIds = new Set(used)
    const walk = (list: unknown[], depth: number) => {
      if (depth > HARD_MAX_DEPTH) return
      for (const b of list) {
        if (!isObject(b)) continue
        if (typeof b.id === 'string') {
          this.allIds.add(b.id)
          this.markerIndex.set(b.id, b)
        }
        if (b.type === 'image' && isObject(b.props) && typeof b.props.url === 'string') {
          const queue = this.knownImages.get(b.props.url)
          if (queue) queue.push(b)
          else this.knownImages.set(b.props.url, [b])
        }
        if (Array.isArray(b.children)) walk(b.children, depth + 1)
      }
    }
    walk(existing, 1)
  }

  freshId(): string {
    for (let i = 0; i < 100; i++) {
      const id = this.newId()
      if (!this.allIds.has(id)) {
        this.allIds.add(id)
        return id
      }
    }
    throw new Error('newId devolveu ids repetidos')
  }

  placeholder(block: Json): Json {
    let n = this.placeholders.size
    let id = `${PLACEHOLDER}${n}`
    while (this.allIds.has(id)) id = `${PLACEHOLDER}${++n}`
    this.allIds.add(id)
    this.placeholders.set(id, block)
    return { id, type: 'divider' }
  }

  resolve(ir: IRBlock, nested: boolean): Resolved {
    if (ir.marker) {
      const block = this.marker(ir)
      if (!block) return { partial: null, inherited: null }
      return nested ? { partial: this.placeholder(block), inherited: null } : { partial: null, inherited: block }
    }
    if (ir.image) {
      const { src, alt, title } = ir.image
      const queue = this.knownImages.get(src)
      if (queue) {
        // Url que já está na nota: herda id (uma vez por ocorrência) e as props que o Markdown não tem.
        const template = queue.find(b => !this.used.has(b.id as string)) ?? queue[0]
        if (typeof template.id === 'string') this.inheritedFrom.add(template.id)
        const reuse = this.mode === 'replace' && typeof template.id === 'string' && !this.used.has(template.id)
        const id = reuse ? (template.id as string) : this.freshId()
        this.used.add(id)
        const props = isObject(template.props) ? template.props : {}
        const block = { ...template, id, props: { ...props, name: alt, caption: title }, children: [] }
        return nested ? { partial: this.placeholder(block), inherited: null } : { partial: null, inherited: block }
      }
      if (!this.checkImage(src, ir.line)) return { partial: null, inherited: null }
      this.newImagePaths.push(src)
      return { partial: { type: 'image', props: { url: src, name: alt, caption: title } }, inherited: null }
    }
    const partial: Json = { type: ir.type }
    if (ir.props) partial.props = ir.props
    if (ir.content) partial.content = ir.content
    if (ir.children.length > 0) {
      const kids: Json[] = []
      for (const child of ir.children) {
        const r = this.resolve(child, true)
        if (r.partial) kids.push(r.partial)
      }
      partial.children = kids
    }
    return { partial, inherited: null }
  }

  marker(ir: IRBlock): Json | null {
    const { id, type } = ir.marker as { id: string; type: string }
    if (this.mode === 'append') {
      this.ctx.issue(ir.line, 'marker', 'No modo anexar não há marcador: o bloco já está na nota')
      return null
    }
    const block = this.markerIndex.get(id)
    if (!block) {
      this.ctx.issue(ir.line, 'marker', `Marcador de um bloco que não está na nota (id ${id})`)
      return null
    }
    if (!MARKER_TYPES.includes(String(block.type))) {
      this.ctx.issue(ir.line, 'marker', `O bloco ${id} é ${String(block.type)}, que tem Markdown: escreva o conteúdo no lugar do marcador`)
      return null
    }
    if (block.type !== type) {
      this.ctx.issue(ir.line, 'marker', `O marcador diz tipo ${type}, mas o bloco ${id} é ${String(block.type)}`)
      return null
    }
    if (this.usedMarkers.has(id) || this.used.has(id)) {
      this.ctx.issue(ir.line, 'marker', `Marcador repetido (id ${id}): cada bloco aparece uma vez`)
      return null
    }
    this.usedMarkers.add(id)
    this.used.add(id)
    this.inheritedFrom.add(id)
    // O marcador restaura o bloco sem os filhos: eles vêm do Markdown (decisão 2 do plano).
    return { ...block, children: [] }
  }

  checkImage(src: string, line: number): boolean {
    const m = IMAGE_PATH.exec(src)
    if (m && this.images && m[1] === this.images.userId && m[2] === this.images.pageId) return true
    let message: string
    if (/^data:/i.test(src)) message = 'Imagem em data: não é aceita: envie o arquivo e use o caminho'
    else if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) message = 'Imagem externa não é aceita: envie o arquivo e use o caminho da nota'
    else if (!this.images) message = 'Imagem nova sem a pasta da nota: só vale imagem que já está na nota'
    else message = `Caminho de imagem fora da pasta da nota (o formato é ${this.images.userId}/${this.images.pageId}/arquivo.webp)`
    this.ctx.issue(line, 'imagePath', message)
    return false
  }
}

function collectIds(list: unknown[], into: Set<string>, depth = 1): void {
  if (depth > HARD_MAX_DEPTH) return
  for (const b of list) {
    if (!isObject(b)) continue
    if (typeof b.id === 'string') into.add(b.id)
    if (Array.isArray(b.children)) collectIds(b.children, into, depth + 1)
  }
}

/** Troca os marcadores de lugar pelos blocos herdados (o normalize nunca os viu). */
function swapPlaceholders(blocks: NoteBlock[], placeholders: ReadonlyMap<string, Json>): NoteBlock[] {
  if (placeholders.size === 0) return blocks
  return blocks.map(b => {
    const inherited = placeholders.get(b.id)
    if (inherited) return inherited as unknown as NoteBlock
    return b.children.length > 0 ? { ...b, children: swapPlaceholders(b.children, placeholders) } : b
  })
}

/**
 * Linha de um ponteiro dentro de uma lista de blocos intermediários; o
 * ponteiro que termina em `/children` (a profundidade) aponta para o 1º filho.
 */
function lineOfPointer(pointer: string, roots: readonly IRBlock[], rootLines?: readonly number[]): number {
  const segs = pointer.split('/').slice(1)
  if (segs.length === 0) return 0
  const index = Number(segs[0])
  let block: IRBlock | undefined = roots[index]
  let line = rootLines ? rootLines[index] ?? 0 : block?.line ?? 0
  for (let i = 1; block && i < segs.length; i += 2) {
    if (segs[i] === 'children') {
      block = block.children[Number(segs[i + 1] ?? 0)]
      if (block) line = block.line
    } else {
      if (segs[i] === 'content' && segs[i + 1] === 'rows' && block.rowLines && i + 2 < segs.length) line = block.rowLines[Number(segs[i + 2])] ?? line
      break
    }
  }
  return line
}

// ── API ───────────────────────────────────────────────────────────────────────

function sortIssues(issues: MarkdownIssue[]): MarkdownIssue[] {
  const seen = new Set<string>()
  const unique = issues.filter(i => {
    const key = `${i.line}\u0000${i.path}\u0000${i.keyword}\u0000${i.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...unique.filter(i => i.fatal), ...unique.filter(i => !i.fatal)]
    .map((issue, order) => ({ issue, order }))
    .sort((a, b) => (a.issue.fatal === b.issue.fatal ? a.issue.line - b.issue.line || a.order - b.order : a.issue.fatal ? -1 : 1))
    .map(({ issue }) => issue)
    .slice(0, MAX_ISSUES)
}

interface Plan {
  slots: Slot[]
  fate: ('intact' | 'head' | 'gone')[]
}

/**
 * Tetos da reconciliação. O plan relê o render inteiro da nota atual, que vai
 * até RENDER_BUDGET (16 × o Markdown de entrada). Essa leitura custa pouco por
 * unidade, mas de 1 a 1,5 µs por linha e por célula de tabela, e cerca de
 * 60 ns por linha × nível (cada linha passa por todos os contêineres abertos,
 * até HARD_MAX_DEPTH). Acima de um teto a regravação segue sem reconciliar:
 * todo bloco entra como novo, e as perdas do render vão inteiras (o resultado
 * é o mesmo, só os ids e as props dos blocos que não mudaram deixam de voltar).
 * No pior caso abaixo dos tetos, a releitura leva de 0,3 a 0,4 s (Apple M2).
 * Nota válida (até 10 níveis) só passa de 2^22 linhas × níveis depois de
 * passar de 2^18 linhas.
 */
const RECONCILE_LIMITS = { maxUnits: 4 * MARKDOWN_LIMITS.maxBytes, maxLinesAndCells: 2 ** 18, maxLineDepth: 2 ** 22 } as const

function occurrences(text: string, part: string): number {
  let n = 0
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + part.length)) n++
  return n
}

/** Reler o render da nota atual cabe nos tetos da reconciliação? (As linhas e os `|`, e a profundidade pelo mapa.) */
function cheapToReread(rendered: MarkdownRender): boolean {
  const md = rendered.markdown
  if (md.length > RECONCILE_LIMITS.maxUnits) return false
  const lines = occurrences(md, '\n')
  if (lines + occurrences(md, '|') > RECONCILE_LIMITS.maxLinesAndCells) return false
  let depth = 1
  for (const block of rendered.blocks) depth = Math.max(depth, occurrences(block.path, '/children/') + 1)
  return lines * depth <= RECONCILE_LIMITS.maxLineDepth
}

/** Reconciliação com a nota atual: as projeções dos blocos raiz e o diff. */
function plan(existing: unknown[], rendered: MarkdownRender, newIR: readonly IRBlock[], limits: Limits): Plan | null {
  if (!cheapToReread(rendered)) return null
  const ctx = new Context({ ...limits, maxBlocks: Number.MAX_SAFE_INTEGER, maxDepth: HARD_MAX_DEPTH }, true)
  let oldIR: IRBlock[]
  try {
    // O mapa conta as linhas do render: o parser lê o mesmo texto, sem o \r
    // que o prepare faria quebra a mais (o render não o emite; se emitir, o
    // bloco só deixa de bater, e os de depois não se deslocam).
    oldIR = parseMarkdown(prepare(rendered.markdown.replace(/\r/g, '�')), ctx)
  } catch {
    // O render da nota atual estoura um teto da leitura: sem reconciliação. (O
    // render já deixa de fora a tabela acima dos tetos; isto é defesa.)
    return null
  }
  const ranges = rendered.blocks.filter(b => /^\/[0-9]+$/.test(b.path))
  const groups: { keys: string[]; keepIfHidden?: boolean }[] = existing.map(() => ({ keys: [] }))
  let r = 0
  for (const ir of oldIR) {
    while (r < ranges.length && ranges[r].endLine < ir.line) r++
    if (r < ranges.length && ranges[r].startLine <= ir.line) groups[Number(ranges[r].path.slice(1))].keys.push(keyOf(ir))
  }
  // Sem projeção, só volta sozinho o bloco que passa no fatal (o parágrafo
  // vazio). O ilegível (null, tipo desconhecido, tabela sem linhas), que a IA
  // não vê no Markdown, sai com a perda unreadable do render.
  groups.forEach((g, i) => {
    if (g.keys.length === 0) g.keepIfHidden = isObject(existing[i]) && findFatalNoteIssue([existing[i]]) === null
  })
  return reconcile(groups, newIR.map(keyOf))
}

/**
 * Markdown → nota. Nunca lança: entrada fora do limite, sintaxe que estoura
 * os tetos, marcador ou imagem inválidos e blocos fora do contrato voltam como
 * `issues`, com a linha do Markdown, os fatais primeiro e no máximo 20.
 */
export function markdownToNote(markdown: string, opts: MarkdownOptions = {}): MarkdownResult {
  const limits: Limits = { ...LIMITS, ...opts.limits }
  const ctx = new Context(limits)
  const fail = (): MarkdownResult => ({ ok: false, issues: sortIssues(ctx.issues), warnings: ctx.warnings })
  try {
    if (typeof markdown !== 'string') {
      ctx.issue(0, 'type', 'O Markdown deve ser texto')
      return fail()
    }
    const over = markdown.length > MARKDOWN_LIMITS.maxBytes * 4 ? 1 : overLimitLine(markdown, MARKDOWN_LIMITS.maxBytes)
    if (over > 0) {
      ctx.issue(over, 'maxBytes', `O Markdown passa de ${MARKDOWN_LIMITS.maxBytes} bytes (512 KiB): divida em mais chamadas`)
      return fail()
    }
    const mode: MarkdownMode = opts.mode ?? 'replace'
    const existing = withUniqueIds(opts.existing)
    const newIR = parseMarkdown(prepare(markdown), ctx)

    // Reconciliação (só ao substituir): os blocos que não mudaram voltam intactos.
    // O render da nota atual serve à reconciliação e às perdas.
    const rendered = mode === 'replace' && existing.length > 0 ? blocksToMarkdown(existing) : null
    const reconciled = rendered ? plan(existing, rendered, newIR, limits) : null
    const slots: Slot[] = reconciled ? reconciled.slots : newIR.map((_, index) => ({ kind: 'new', index }))
    const used = new Set<string>(opts.reservedIds ?? [])
    if (mode === 'append') collectIds(existing, used)
    for (const slot of slots) {
      if (slot.kind !== 'old') continue
      const block = existing[slot.index]
      if (!isObject(block)) continue
      if (slot.mode === 'intact') collectIds([block], used)
      else if (typeof block.id === 'string') used.add(block.id)
    }
    const resolver = new Resolver(ctx, existing, opts, used)

    // Fase 1: os blocos novos, no normalize, com os ids herdados reservados.
    type Entry = { slot: Slot; inherited: Json | null; partialIndex: number; line: number }
    const entries: Entry[] = []
    const partials: Json[] = []
    const partialIR: IRBlock[] = []
    for (const slot of slots) {
      if (slot.kind === 'old') {
        // Só bloco objeto volta: nunca uma entrada sem bloco (fresh[-1] na nota).
        const block = existing[slot.index]
        if (isObject(block)) entries.push({ slot, inherited: slot.mode === 'intact' ? block : { ...block, children: [] }, partialIndex: -1, line: newIR[slot.first]?.line ?? 0 })
        continue
      }
      const ir = newIR[slot.index]
      const r = resolver.resolve(ir, false)
      if (r.inherited) entries.push({ slot, inherited: r.inherited, partialIndex: -1, line: ir.line })
      else if (r.partial) {
        entries.push({ slot, inherited: null, partialIndex: partials.length, line: ir.line })
        partials.push(r.partial)
        partialIR.push(ir)
      }
    }
    if (ctx.issues.length > 0) return fail()
    const reserved = new Set(used)
    for (const id of resolver.placeholders.keys()) reserved.delete(id)
    // Sem o teto de células da nota inteira: aqui só há os blocos novos (a
    // tabela editada conta como nova), e a fase 2 o confere na nota final
    // contra o custo da nota atual. O teto de cada tabela continua.
    const normalized = normalizeNoteContent(partials, { newId: () => resolver.freshId(), reservedIds: reserved, limits, skipNoteCellCost: true })
    if (!normalized.ok) {
      for (const issue of normalized.issues) ctx.issue(lineOfPointer(issue.path, partialIR), issue.keyword, issue.message, issue.fatal)
      return fail()
    }
    const fresh = swapPlaceholders(normalized.blocks, resolver.placeholders)
    const blocks: NoteBlock[] = entries.map(e => (e.inherited ? (e.inherited as unknown as NoteBlock) : fresh[e.partialIndex]))

    // Fase 2: a nota final (ou a juntada, ao anexar), só o fatal e os limites.
    const whole: unknown[] = mode === 'append' ? [...existing, ...blocks] : blocks
    const offset = mode === 'append' ? existing.length : 0
    const finalIssues: BlockIssue[] = [
      ...validateNoteContent(whole, { stored: true, fatalOnly: true }).issues,
      // O teto de células da nota inteira contra o da nota atual: a antiga acima dele regrava sem somar tabela.
      ...noteLimitIssues(whole, { limits, baseline: existing }),
    ]
    if (finalIssues.length > 0) {
      const rootLines = entries.map(e => e.line)
      const rootIR = entries.map(e => (e.partialIndex >= 0 ? partialIR[e.partialIndex] : { type: '', children: [], line: e.line }))
      for (const issue of finalIssues) {
        const segs = issue.path.split('/')
        const index = segs.length > 1 ? Number(segs[1]) - offset : -1
        const line = index >= 0 ? lineOfPointer(`/${index}${issue.path.slice(segs[1].length + 1)}`, rootIR, rootLines) : 0
        const path = index >= 0 || mode === 'replace' ? issue.path : ''
        ctx.issue(line, issue.keyword, issue.message, issue.fatal, path)
      }
      return fail()
    }

    // Perdas: as do render dos blocos antigos que não voltaram intactos (nem
    // pelo marcador ou pela imagem conhecida, que trazem as props de volta).
    let losses: RenderLoss[] = []
    if (rendered) {
      const fate = reconciled?.fate ?? existing.map(() => 'gone' as const)
      const idAt = new Map(rendered.blocks.map(b => [b.path, b.id]))
      losses = rendered.losses.filter(loss => {
        const root = Number(loss.path.split('/')[1])
        const f = fate[root]
        if (f === 'intact') return false
        if (f === 'head' && !loss.path.startsWith(`/${root}/children/`)) return false
        // O bloco dono da perda: o caminho de bloco mais longo que é prefixo dela.
        let at = loss.path
        while (at && !idAt.has(at)) at = at.slice(0, at.lastIndexOf('/'))
        const id = idAt.get(at)
        return !(id && resolver.inheritedFrom.has(id) && !loss.path.startsWith(`${at}/children/`))
      })
    }
    return { ok: true, blocks, warnings: ctx.warnings, newImagePaths: resolver.newImagePaths, losses }
  } catch (err) {
    // Stop: um limite parou a leitura (o problema já está em ctx). O resto não deveria acontecer.
    if (!(err instanceof Stop)) ctx.issue(0, 'internal', `Não foi possível converter o Markdown (${err instanceof RangeError ? 'grande ou aninhado demais' : 'erro interno'})`, true)
    return fail()
  }
}

/**
 * Para o corpo do validation_failed: path no campo da ação (`/markdown`) e a
 * linha na mensagem (`linha N: …`), os fatais primeiro e no máximo 20.
 */
export function toMarkdownSchemaIssues(issues: readonly MarkdownIssue[], path = '/markdown'): SchemaIssue[] {
  return [...issues.filter(i => i.fatal), ...issues.filter(i => !i.fatal)]
    .slice(0, MAX_ISSUES)
    .map(({ line, keyword, message }) => ({ path, keyword, message: line > 0 ? `linha ${line}: ${message}` : message }))
}

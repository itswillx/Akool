// API-023: blocos BlockNote → Markdown e texto puro, sem DOM. O Markdown sai
// no subconjunto que o markdown.ts lê de volta igual (docs/api-arquitetura.md
// §3): o que não cabe nele entra em `losses`, com o ponteiro do bloco.
//
// O render é tolerante como o extractBlocks do PDF: aceita a nota gravada
// (até com desvio de contrato, content nulo ou blocos ilegíveis), não passa
// de HARD_MAX_DEPTH nem do teto de saída (RENDER_BUDGET), não monta tabela
// acima dos tetos fatais (TABLE_LIMITS) e nunca lança. A saída nunca tem \r.
//
// Escapes: `\` antes da pontuação que o Markdown leria como sintaxe; no
// começo de cada linha (inclusive depois de cada quebra dura), também `#`,
// `-`, `+`, `=`, `:` e `N.`; espaço e tab nas bordas da linha como `&#32;`/`&#9;`;
// `:` de `https://`, `.` de `www.` e `@` de e-mail para o autolink literal não
// pegar texto puro; `&` antes do que pareceria entidade; `\r` como `&#13;` e o
// BOM no começo da linha como `&#65279;`.
//
// Estilos: `**negrito**`, `_itálico_` e `~~tachado~~`, um caractere por estilo:
// assim um abridor nunca fecha o estilo de fora (com `*` nos dois, `***a**b`
// casa errado pela regra do múltiplo de 3). Os espaços nas bordas de um trecho
// com estilo ficam fora dos delimitadores, e quando o flanqueamento falharia
// (ex.: `**a.**b`), o caractere vizinho sai como entidade numérica
// (`**a.**&#98;`), o mesmo truque do BlockNote.

import { tPtBR } from '../i18n.pt-BR.ts'
import { BOLD, CODE, ITALIC, STRIKE, charClass } from './markdownInline.ts'
import { HARD_MAX_DEPTH, TABLE_LIMITS, isAllowedHref } from './spec.ts'

export type LossKind =
  | 'textColor' | 'backgroundColor' | 'underline' | 'alignment'
  | 'columnWidths' | 'mergedCells' | 'headerRows' | 'headerCols'
  | 'toggle' | 'nestedUnderNonList' | 'emptyParagraph'
  | 'codeStyles' | 'codeLanguage' | 'codeWhitespace' | 'codeLineEnding'
  | 'unsafeLink' | 'listStart' | 'imageProps' | 'codeSpan' | 'unreadable' | 'truncated' | 'nonMarkdownBlock'

export interface RenderLoss {
  /** JSON Pointer do bloco (ou do item em linha, da célula, da prop). */
  path: string
  kind: LossKind
}

/** O que cada perda significa (vai para a documentação da API). */
export const MARKDOWN_LOSSES: Readonly<Record<LossKind, string>> = {
  textColor: 'cor do texto (do bloco, do trecho ou da célula)',
  backgroundColor: 'cor de fundo (do bloco, do trecho ou da célula)',
  underline: 'sublinhado',
  alignment: 'alinhamento (do bloco, da imagem ou da célula fora do padrão da coluna)',
  columnWidths: 'larguras das colunas da tabela',
  mergedCells: 'células mescladas (viram células vazias)',
  headerRows: 'linhas de cabeçalho da tabela diferentes de 1 (a 1ª linha vira cabeçalho)',
  headerCols: 'colunas de cabeçalho da tabela',
  toggle: 'recolhível (item recolhível vira item de lista; título recolhível vira título)',
  nestedUnderNonList: 'filho de bloco que não é item de lista (vira bloco seguinte, no mesmo nível)',
  emptyParagraph: 'parágrafo vazio (o do fim da nota não conta: o editor o recria)',
  codeStyles: 'estilo ou link dentro do bloco de código',
  codeLanguage: 'linguagem do código vazia ou com espaço',
  codeWhitespace: 'linha só de espaços no código dentro de item de lista',
  codeLineEnding: 'fim de linha \\r (CR) no bloco de código: vira \\n',
  unsafeLink: 'link sem destino ou com protocolo não permitido (fica o texto)',
  listStart: 'número inicial da lista que o Markdown não representa (1 no começo da lista, negativo, fracionário ou acima de 999999999)',
  imageProps: 'largura, prévia oculta ou quebra de linha no nome, na legenda ou no endereço da imagem',
  codeSpan: 'código em linha sem forma no Markdown (com \\r, com \\ logo antes de | na célula, ou com ] no 1º link do parágrafo, que viraria definição de referência): sai como texto',
  unreadable: 'bloco ilegível (fora do contrato), linha de tabela que não é objeto com cells, célula que não cabe na grade, ou tabela acima dos tetos de colunas ou de células',
  truncated: 'o render passou do teto de saída e este bloco e os seguintes ficaram de fora (a nota pode estar dentro do contrato: listas fundas com muitas linhas curtas inflam o Markdown)',
  nonMarkdownBlock: 'bloco sem Markdown, como texto (só com markers: false)',
}

/** Blocos que o Markdown não representa: viram marcador (decisão 2 do plano). */
export const MARKER_TYPES: readonly string[] = ['diagram', 'projectCard', 'file', 'video', 'audio']

const MARKER_ATTRS = /\s+([a-z]+)="([^"]*)"/y
const MARKER_HEAD = /^<!--\s*akool:bloco((?:\s+[a-z]+="[^"]*")+)\s*-->$/

export interface ParsedMarker {
  id: string
  type: string
}

/** Linha de marcador: `<!-- akool:bloco id="…" tipo="…" -->`, ou null se não for um. */
export function parseMarkerLine(line: string): ParsedMarker | null {
  const m = MARKER_HEAD.exec(line.trim())
  if (!m) return null
  const attrs = new Map<string, string>()
  MARKER_ATTRS.lastIndex = 0
  for (let a = MARKER_ATTRS.exec(m[1]); a; a = MARKER_ATTRS.exec(m[1])) if (!attrs.has(a[1])) attrs.set(a[1], a[2])
  const rawId = attrs.get('id')
  const type = attrs.get('tipo')
  if (rawId === undefined || type === undefined) return null
  try {
    return { id: decodeURIComponent(rawId), type }
  } catch {
    return null
  }
}

/** Valor de atributo do marcador: o comentário HTML não pode conter `--` nem `>`. */
function markerAttr(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/--/g, '-&#45;')
}

export function markerLine(id: string, type: string, extra: readonly [string, string][] = []): string {
  const attrs = extra.filter(([, v]) => v !== '').map(([k, v]) => ` ${k}="${markerAttr(v)}"`).join('')
  return `<!-- akool:bloco id="${encodeURIComponent(id)}" tipo="${type}"${attrs} -->`
}

// ── Leitura tolerante ─────────────────────────────────────────────────────────

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nonDefaultColor(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && value !== 'default'
}

interface Seg {
  text: string
  styles: number
  href: string | null
}

const STYLE_BITS: readonly [string, number][] = [['bold', BOLD], ['italic', ITALIC], ['strike', STRIKE], ['code', CODE]]

/**
 * Ids únicos para o render e para a escrita: id repetido (ou que não é texto)
 * ganha um id determinístico, `<id>-<n>` (o mesmo nas duas pontas, então o
 * marcador lido volta para o bloco certo). Não muda a nota recebida.
 */
export function withUniqueIds(content: unknown): unknown[] {
  if (!Array.isArray(content)) return []
  const taken = new Set<string>()
  const collect = (list: unknown[], depth: number): void => {
    if (depth > HARD_MAX_DEPTH) return
    for (const b of list) {
      if (!isObject(b)) continue
      if (typeof b.id === 'string' && b.id !== '') taken.add(b.id)
      if (Array.isArray(b.children)) collect(b.children, depth + 1)
    }
  }
  collect(content, 1)
  const seen = new Set<string>()
  // O próximo n de cada base: `taken` só cresce, então todo `<base>-j` abaixo
  // dele já está tomado e a busca continua de onde parou (os mesmos ids de
  // começar em 2 a cada vez, em tempo linear).
  const nextN = new Map<string, number>()
  const fresh = (base: string): string => {
    for (let n = nextN.get(base) ?? 2; ; n++) {
      const id = `${base}-${n}`
      if (!taken.has(id)) {
        taken.add(id)
        nextN.set(base, n + 1)
        return id
      }
    }
  }
  const walk = (list: unknown[], depth: number): unknown[] => {
    if (depth > HARD_MAX_DEPTH) return list
    let out: unknown[] | null = null
    list.forEach((b, i) => {
      if (!isObject(b)) return
      let next: Json = b
      const valid = typeof b.id === 'string' && b.id !== '' && !seen.has(b.id)
      if (!valid) next = { ...b, id: fresh(typeof b.id === 'string' && b.id !== '' ? b.id.slice(0, 100) : 'bloco') }
      seen.add(next.id as string)
      if (Array.isArray(b.children)) {
        const kids = walk(b.children, depth + 1)
        if (kids !== b.children) next = { ...next, children: kids }
      }
      if (next !== b) {
        out ??= [...list]
        out[i] = next
      }
    })
    return out ?? list
  }
  return walk(content, 1)
}

class Losses {
  readonly list: RenderLoss[] = []
  readonly seen = new Set<string>()
  add(path: string, kind: LossKind): void {
    const key = `${path}\u0000${kind}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.list.push({ path, kind })
  }

  /** Volta para as `count` primeiras (as de um bloco que saiu inteiro). */
  truncate(count: number): void {
    for (const { path, kind } of this.list.splice(count)) this.seen.delete(`${path}\u0000${kind}`)
  }
}

/** Conteúdo em linha gravado → trechos (texto, estilos, link), com as perdas. */
function readSegments(content: unknown, path: string, losses: Losses, code: boolean): Seg[] {
  const out: Seg[] = []
  const push = (text: string, styles: number, href: string | null) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.styles === styles && last.href === href) last.text += text
    else out.push({ text, styles, href })
  }
  const styled = (item: unknown, at: string, href: string | null) => {
    if (typeof item === 'string') return push(item, 0, href)
    if (!isObject(item) || typeof item.text !== 'string') return losses.add(at, 'unreadable')
    let styles = 0
    const raw = isObject(item.styles) ? item.styles : {}
    for (const [name, bit] of STYLE_BITS) if (raw[name] === true) styles |= bit
    if (raw.underline === true) losses.add(at, 'underline')
    if (nonDefaultColor(raw.textColor)) losses.add(at, 'textColor')
    if (nonDefaultColor(raw.backgroundColor)) losses.add(at, 'backgroundColor')
    if (code && (styles !== 0 || href !== null)) losses.add(at, 'codeStyles')
    push(item.text, code ? 0 : styles, code ? null : href)
  }
  if (typeof content === 'string') {
    push(content, 0, null)
    return out
  }
  if (!Array.isArray(content)) return out
  content.forEach((item, k) => {
    const at = `${path}/${k}`
    if (isObject(item) && item.type === 'link') {
      const href = typeof item.href === 'string' ? item.href : ''
      const ok = href !== '' && !/[\r\n]/.test(href) && isAllowedHref(href)
      if (!ok) losses.add(at, code ? 'codeStyles' : 'unsafeLink')
      if (typeof item.content === 'string') styled(item.content, at, ok ? href : null)
      else if (Array.isArray(item.content)) item.content.forEach((part, j) => styled(part, `${at}/content/${j}`, ok ? href : null))
      return
    }
    if (isObject(item) && item.type !== undefined && item.type !== 'text') return losses.add(at, 'unreadable')
    styled(item, at, null)
  })
  return out
}

function plain(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(item => {
    if (typeof item === 'string') return item
    if (!isObject(item)) return ''
    if (item.type === 'link') return plain(item.content)
    return str(item.text)
  }).join('')
}

// ── Escapes ───────────────────────────────────────────────────────────────────

function entity(text: string, i: number): { out: string; len: number } {
  const cp = text.codePointAt(i) as number
  return { out: `&#${cp};`, len: cp > 0xffff ? 2 : 1 }
}

interface EscapeCtx {
  /** O trecho começa a linha (as regras de início de linha valem). */
  lineStart: boolean
  /** O trecho é o primeiro/último da linha: espaço e tab na borda viram entidade. */
  first: boolean
  last: boolean
  /** O vizinho de um delimitador precisa virar entidade para o flanqueamento. */
  encFirst: boolean
  encLast: boolean
  /** O próximo é um `[` de link: `!` no fim viraria imagem. */
  beforeLink: boolean
  /** Último trecho de um título: `#` no fim seria a sequência de fechamento. */
  heading: boolean
}

const ESCAPE_ALWAYS = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '~', '|'])
const ENTITY_LIKE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y
const EMAIL_LOCAL = /[A-Za-z0-9._+-]/
const EMAIL_DOMAIN = /[A-Za-z0-9_-]/

function escapeText(text: string, ctx: EscapeCtx): string {
  let out = ''
  const n = text.length
  // A sequência de fechamento de um título: `#`s no fim, depois de espaço ou no começo.
  let closingHash = -1
  if (ctx.heading && ctx.last && !ctx.encLast && text.endsWith('#')) {
    let k = n
    while (k > 0 && text[k - 1] === '#') k--
    if (k === 0 ? ctx.first : text[k - 1] === ' ' || text[k - 1] === '\t') closingHash = k
  }
  // `N.` ou `N)` no começo da linha, seguido de espaço ou do fim: lista numerada.
  let listDelim = -1
  if (ctx.lineStart) {
    const m = /^[0-9]{1,9}[.)]/.exec(text)
    if (m && (m[0].length === n ? ctx.last : text[m[0].length] === ' ' || text[m[0].length] === '\t')) listDelim = m[0].length - 1
  }
  for (let i = 0; i < n; i++) {
    const ch = text[i]
    const atFirst = i === 0
    const atLast = i === n - 1 || (i === n - 2 && (text.codePointAt(i) as number) > 0xffff)
    if ((atFirst && (ctx.encFirst || (ctx.first && (ch === ' ' || ch === '\t')))) || (atLast && (ctx.encLast || (ctx.last && (ch === ' ' || ch === '\t'))))) {
      const e = entity(text, i)
      out += e.out
      i += e.len - 1
      continue
    }
    // \r cru seria fim de linha na leitura, e o BOM no começo do documento
    // sai nela (prepare): os dois como entidade (o BOM, em todo começo de linha).
    if (ch === '\r' || (ch === '\ufeff' && atFirst && ctx.lineStart)) {
      out += ch === '\r' ? '&#13;' : '&#65279;'
      continue
    }
    if (ESCAPE_ALWAYS.has(ch) || i === closingHash || i === listDelim) {
      out += `\\${ch}`
      continue
    }
    // `:` também: `:--` depois de uma linha com `|` é a linha de alinhamento de uma tabela do GFM.
    if (atFirst && ctx.lineStart && (ch === '#' || ch === '-' || ch === '+' || ch === '=' || ch === ':')) {
      out += `\\${ch}`
      continue
    }
    switch (ch) {
      case '&':
        ENTITY_LIKE.lastIndex = i
        out += ENTITY_LIKE.test(text) ? '\\&' : '&'
        continue
      case '!':
        out += atLast && ctx.beforeLink ? '\\!' : '!'
        continue
      case ':':
        // `http://` e `https://` no texto puro virariam link (autolink literal do GFM).
        out += text.startsWith('//', i + 1) && /https?$/i.test(text.slice(Math.max(0, i - 5), i)) ? '\\:' : ':'
        continue
      case '.':
        out += i >= 3 && text.slice(i - 3, i).toLowerCase() === 'www' ? '\\.' : '.'
        continue
      case '@':
        // Na borda do trecho o vizinho pode ser o `_` do itálico, que conta como letra do e-mail.
        out += (i === 0 || EMAIL_LOCAL.test(text[i - 1])) && (i === n - 1 || EMAIL_DOMAIN.test(text[i + 1])) ? '\\@' : '@'
        continue
      default:
        out += ch
    }
  }
  return out
}

/** Code span: crases a mais que a maior corrida dentro, e espaço de folga quando precisa. */
function codeSpan(text: string, inTable: boolean): string {
  let longest = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') continue
    let j = i
    while (text[j] === '`') j++
    longest = Math.max(longest, j - i)
    i = j - 1
  }
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) ? ' ' : ''
  // Na tabela, o `|` sai escapado até dentro do código (o GFM tira a barra antes).
  const body = inTable ? text.replace(/\|/g, '\\|') : text
  return `${fence}${pad}${body}${pad}${fence}`
}

/** Destino de link ou imagem: cru quando dá, `<…>` quando tem espaço, parênteses ou `<>\`; na tabela, `|` escapado. */
export function linkDest(href: string, inTable = false): string {
  const amp = href.replace(/&(?=#[0-9]+;|#[xX][0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)/g, '\\&')
  let out: string
  if (href !== '' && !/[\s<>()\\]/.test(href) && !/[\x00-\x1f\x7f]/.test(href)) out = amp // eslint-disable-line no-control-regex
  else out = `<${amp.replace(/[\\<>]/g, c => (c === '\\' ? '\\\\' : `\\${c}`))}>`
  return inTable ? out.replace(/\|/g, '\\|') : out
}

function titleAttr(title: string): string {
  return `"${title.replace(/[\\"]/g, c => `\\${c}`).replace(/&(?=#[0-9]+;|#[xX][0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)/g, '\\&')}"`
}

// ── Uma linha de conteúdo em linha ────────────────────────────────────────────

type Token =
  | { k: 'text'; text: string; encFirst: boolean; encLast: boolean }
  | { k: 'delim'; ch: '*' | '_' | '~'; s: string; open: boolean }
  | { k: 'raw'; s: string; link?: boolean }

const DELIM: Record<number, { ch: '*' | '_' | '~'; s: string }> = {
  [BOLD]: { ch: '*', s: '**' },
  [ITALIC]: { ch: '_', s: '_' },
  [STRIKE]: { ch: '~', s: '~~' },
}

/** Separa os espaços das bordas dos trechos com estilo (o código guarda os seus). */
function edgeSpacesOut(atoms: Seg[]): Seg[] {
  const out: Seg[] = []
  const push = (text: string, styles: number, href: string | null) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.styles === styles && last.href === href) last.text += text
    else out.push({ text, styles, href })
  }
  for (const a of atoms) {
    if (a.styles === 0 || (a.styles & CODE) !== 0) {
      push(a.text, a.styles, a.href)
      continue
    }
    let s = 0
    let e = a.text.length
    while (s < e && charClass(a.text.charCodeAt(s)) === 1) s++
    while (e > s && charClass(a.text.charCodeAt(e - 1)) === 1) e--
    push(a.text.slice(0, s), 0, a.href)
    push(a.text.slice(s, e), a.styles, a.href)
    push(a.text.slice(e), 0, a.href)
  }
  return out
}

/** Quantos trechos seguidos, a partir de cada um, mantêm cada estilo (para abrir por fora o que dura mais). */
function styleRuns(atoms: Seg[]): Map<number, number>[] {
  const runs: Map<number, number>[] = atoms.map(() => new Map())
  for (let i = atoms.length - 1; i >= 0; i--) {
    for (const bit of [BOLD, ITALIC, STRIKE]) {
      if ((atoms[i].styles & bit) === 0) continue
      const next = i + 1 < atoms.length && atoms[i + 1].href === atoms[i].href ? runs[i + 1].get(bit) ?? 0 : 0
      runs[i].set(bit, next + 1)
    }
  }
  return runs
}

function tokensOfLine(input: Seg[], inTable: boolean): Token[] {
  const atoms = edgeSpacesOut(input)
  const runs = styleRuns(atoms)
  const tokens: Token[] = []
  const transition = (stack: number[], target: number, at: number) => {
    let keep = 0
    while (keep < stack.length && (target & stack[keep]) !== 0) keep++
    for (let i = stack.length - 1; i >= keep; i--) tokens.push({ k: 'delim', ...DELIM[stack[i]], open: false })
    stack.length = keep
    const open = [BOLD, ITALIC, STRIKE].filter(bit => (target & bit) !== 0 && !stack.includes(bit))
    open.sort((a, b) => (runs[at]?.get(b) ?? 0) - (runs[at]?.get(a) ?? 0))
    for (const bit of open) {
      tokens.push({ k: 'delim', ...DELIM[bit], open: true })
      stack.push(bit)
    }
  }
  const emit = (a: Seg) => {
    if (a.styles & CODE) tokens.push({ k: 'raw', s: codeSpan(a.text, inTable) })
    else tokens.push({ k: 'text', text: a.text, encFirst: false, encLast: false })
  }
  const outer: number[] = []
  let i = 0
  while (i < atoms.length) {
    const href = atoms[i].href
    if (href === null) {
      transition(outer, atoms[i].styles & ~CODE, i)
      emit(atoms[i])
      i++
      continue
    }
    let j = i
    let common = BOLD | ITALIC | STRIKE
    while (j < atoms.length && atoms[j].href === href) common &= atoms[j++].styles
    transition(outer, common, i)
    tokens.push({ k: 'raw', s: '[', link: true })
    const inner: number[] = []
    for (let k = i; k < j; k++) {
      transition(inner, atoms[k].styles & ~CODE & ~common, k)
      emit(atoms[k])
    }
    transition(inner, 0, j)
    tokens.push({ k: 'raw', s: `](${linkDest(href, inTable)})` })
    i = j
  }
  transition(outer, 0, atoms.length)
  return tokens
}

/** Classe do primeiro/último caractere de saída de um token (o escape conta como pontuação). */
function edgeClass(t: Token, side: 'first' | 'last', escaped: string): 0 | 1 | 2 {
  if (t.k !== 'text') return 2
  if (escaped === '') return 1
  const code = side === 'first' ? escaped.charCodeAt(0) : escaped.charCodeAt(escaped.length - 1)
  return charClass(code)
}

/**
 * Monta a linha. O flanqueamento de cada delimitador é conferido na saída;
 * quando falharia, o caractere de texto vizinho vira entidade (e a conferência
 * roda de novo, até parar: cada correção só troca letra por pontuação). As
 * regras: `**` e `~~` abrem com flanqueamento à esquerda e fecham à direita;
 * `_` também não pode ficar no meio da palavra (letra dos dois lados).
 */
function lineMarkdown(input: Seg[], opts: { lineStart: boolean; inTable: boolean; heading: boolean }): string {
  const tokens = tokensOfLine(input, opts.inTable)
  if (tokens.length === 0) return ''
  const escaped: string[] = new Array(tokens.length).fill('')
  const escapeAt = (i: number) => {
    const t = tokens[i]
    if (t.k !== 'text') {
      escaped[i] = t.s
      return
    }
    const next = tokens[i + 1]
    escaped[i] = escapeText(t.text, {
      lineStart: opts.lineStart && i === 0,
      first: i === 0,
      last: i === tokens.length - 1,
      encFirst: t.encFirst,
      encLast: t.encLast,
      beforeLink: next !== undefined && next.k === 'raw' && next.link === true,
      heading: opts.heading,
    })
  }
  for (let i = 0; i < tokens.length; i++) escapeAt(i)
  for (let guard = 0; guard <= tokens.length; guard++) {
    let changed = false
    tokens.forEach((t, i) => {
      if (t.k !== 'delim') return
      const before = i > 0 ? edgeClass(tokens[i - 1], 'last', escaped[i - 1]) : 1
      const after = i + 1 < tokens.length ? edgeClass(tokens[i + 1], 'first', escaped[i + 1]) : 1
      const loose = t.ch === '_'
      if (t.open && before === 0 && (loose || after === 2)) {
        const prev = tokens[i - 1]
        if (prev.k === 'text' && !prev.encLast) {
          prev.encLast = true
          escapeAt(i - 1)
          changed = true
        }
      } else if (!t.open && after === 0 && (loose || before === 2)) {
        const next = tokens[i + 1]
        if (next.k === 'text' && !next.encFirst) {
          next.encFirst = true
          escapeAt(i + 1)
          changed = true
        }
      }
    })
    if (!changed) break
  }
  return escaped.join('')
}

/**
 * Conteúdo em linha → linhas de Markdown. Em bloco, a quebra vira `\` no fim
 * da linha; a do fim do bloco (e as que só têm linhas vazias depois) vira
 * `<br>`, porque o Markdown ignora a quebra dura no fim do parágrafo. Em título
 * e célula, toda quebra vira `<br>`.
 */
function inlineLines(segs: Seg[], mode: 'block' | 'single', inTable = false, heading = false, onLoss?: (kind: LossKind) => void): string[] {
  const lines: Seg[][] = [[]]
  for (const seg of segs) {
    // Código em linha com \r não tem forma (no código não há entidade, e CR é
    // fim de linha): sai como texto, com o \r em entidade.
    if (seg.styles & CODE && seg.text.includes('\r')) {
      seg.styles &= ~CODE
      onLoss?.('codeSpan')
    }
    const parts = seg.text.split('\n')
    parts.forEach((part, j) => {
      if (j > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ ...seg, text: part })
    })
  }
  if (mode === 'single') {
    return [lines.map((l, i) => lineMarkdown(l, { lineStart: false, inTable, heading: heading && i === lines.length - 1 })).join('<br>')]
  }
  let lastFull = lines.length - 1
  while (lastFull >= 0 && lines[lastFull].length === 0) lastFull--
  const out: string[] = []
  for (let i = 0; i <= Math.max(lastFull, 0); i++) {
    let text = lineMarkdown(lines[i], { lineStart: true, inTable: false, heading: false })
    // A 1ª linha do parágrafo que parece `[rótulo]:` viraria definição de
    // referência: só acontece com `]` dentro de um código no 1º link, que sai como texto.
    while (i === 0 && REF_DEF_START.test(text)) {
      const atom = lines[0].find(a => a.href !== null && (a.styles & CODE) !== 0 && a.text.includes(']'))
      if (!atom) break
      atom.styles &= ~CODE
      onLoss?.('codeSpan')
      text = lineMarkdown(lines[0], { lineStart: true, inTable: false, heading: false })
    }
    out.push(i < lastFull ? `${text}\\` : text)
  }
  const trailing = lines.length - 1 - Math.max(lastFull, 0)
  if (trailing > 0) out[out.length - 1] += '<br>'.repeat(trailing)
  return out
}

const REF_DEF_START = /^\[(?:[^\\[\]]|\\[\s\S]){0,999}\]:/

// ── Blocos ────────────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** true (padrão): bloco sem Markdown vira marcador; false: vira o rótulo do texto puro (só leitura). */
  markers?: boolean
  /** 'opaque' (padrão): nada do snapshot do card; 'label': o título do card no marcador e no texto. */
  cards?: 'opaque' | 'label'
}

export interface RenderedBlock {
  id: string | null
  path: string
  startLine: number
  endLine: number
}

export interface MarkdownRender {
  markdown: string
  losses: RenderLoss[]
  /** Cada bloco com as linhas que ele ocupa (o trecho inteiro, com os filhos). */
  blocks: RenderedBlock[]
}

type Family = 'bullet' | 'numbered' | 'other' | 'none'

interface Frame {
  list: unknown[]
  index: number
  path: string
  depth: number
}

function cardTitle(props: Json): string {
  if (typeof props.snapshot !== 'string') return ''
  try {
    const snap = JSON.parse(props.snapshot) as unknown
    return isObject(snap) && typeof snap.title === 'string' ? snap.title : ''
  } catch {
    return ''
  }
}

function mediaLabel(type: string, props: Json, cards: 'opaque' | 'label'): string {
  const name = str(props.name)
  switch (type) {
    case 'image': {
      const label = str(props.caption) || name
      return label ? tPtBR('note_text_image', { name: label }) : tPtBR('note_text_image_unnamed')
    }
    case 'diagram': return tPtBR('note_text_diagram')
    case 'projectCard': {
      const title = cards === 'label' ? cardTitle(props) : ''
      return title ? tPtBR('note_text_card', { title }) : tPtBR('note_text_card_unnamed')
    }
    case 'file': return name ? tPtBR('note_text_file', { name }) : tPtBR('note_text_file_unnamed')
    case 'video': return name ? tPtBR('note_text_video', { name }) : tPtBR('note_text_video_unnamed')
    default: return name ? tPtBR('note_text_audio', { name }) : tPtBR('note_text_audio_unnamed')
  }
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem'])
const MAX_START = 999_999_999

/**
 * Teto da saída do render, em unidades UTF-16 (com as quebras de linha): 16 ×
 * o limite de entrada do Markdown (MARKDOWN_LIMITS.maxBytes, 512 KiB). Protege
 * a memória da leitura: o recuo das listas conta, e cada linha de um item fundo
 * leva até ~100 colunas de recuo no contrato (10 níveis de `999999999. `), ou
 * ~700 na profundidade gravada (HARD_MAX_DEPTH). Por isso o teto também pode
 * cortar nota válida, com listas fundas e muitas linhas curtas (uma quebra de
 * 2 bytes no JSON vira uma linha inteira). Vale dentro do bloco: a linha que o
 * passaria tira o bloco inteiro, e ele e os seguintes saem com a perda
 * `truncated`. A saída nunca passa do teto.
 */
export const RENDER_BUDGET = 16 * 512 * 1024

/** O render chegou ao teto de saída: o bloco em curso sai inteiro (Renderer.siblings). */
class BudgetExceeded extends Error {}

class Renderer {
  readonly lines: string[] = []
  readonly losses = new Losses()
  readonly map: RenderedBlock[] = []
  readonly markers: boolean
  readonly cards: 'opaque' | 'label'
  /** Unidades UTF-16 já escritas (com as quebras de linha). */
  size = 0
  /** O teto de saída foi atingido: os blocos seguintes ficam de fora. */
  full = false

  constructor(opts: RenderOptions) {
    this.markers = opts.markers ?? true
    this.cards = opts.cards ?? 'opaque'
  }

  push(prefix: string, text: string): void {
    // Linha só de espaços é linha em branco (o recuo não importa).
    this.line(/^[ \t]*$/.test(prefix + text) ? '' : prefix + text)
  }

  line(text: string): void {
    if (this.size + text.length + 1 > RENDER_BUDGET) {
      this.full = true
      throw new BudgetExceeded()
    }
    this.size += text.length + 1
    this.lines.push(text)
  }

  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.line('')
  }

  /** Irmãos num nível; os filhos de bloco que não é lista entram logo depois, no mesmo nível. */
  siblings(list: unknown[], path: string, prefix: string, depth: number, root: boolean): void {
    const stack: Frame[] = [{ list, index: 0, path, depth }]
    let family: Family = 'none'
    let number = 0
    let started = false
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame.index >= frame.list.length) {
        stack.pop()
        continue
      }
      const i = frame.index++
      const raw = frame.list[i]
      const at = `${frame.path}/${i}`
      // Depois do teto de saída, ou bloco ilegível: fica de fora, com a perda.
      if (this.full || !isObject(raw)) {
        this.losses.add(at, this.full ? 'truncated' : 'unreadable')
        continue
      }
      // O ponto de volta, se o teto de saída chegar no meio deste bloco.
      const mark = { lines: this.lines.length, size: this.size, losses: this.losses.list.length, map: this.map.length }
      const type = typeof raw.type === 'string' ? raw.type : 'paragraph'
      const children = Array.isArray(raw.children) ? raw.children : []
      const props = isObject(raw.props) ? raw.props : {}
      if (type === 'paragraph' && plain(raw.content) === '' && children.length === 0) {
        // O parágrafo vazio do fim é do TrailingNode do editor: não é perda.
        const trailing = root && frame === stack[0] && stack.length === 1 && i === frame.list.length - 1
        if (!trailing) this.losses.add(at, 'emptyParagraph')
        family = 'other'
        continue
      }
      const isList = LIST_TYPES.has(type)
      const fam: Family = !isList ? 'other' : type === 'numberedListItem' ? 'numbered' : 'bullet'
      // Número da lista numerada: continua a anterior ou começa outra.
      let explicit: number | null = null
      if (type === 'numberedListItem' && props.start !== undefined) {
        if (typeof props.start === 'number' && Number.isInteger(props.start) && props.start >= 0 && props.start <= MAX_START) explicit = props.start
        else this.losses.add(`${at}/props/start`, 'listStart')
      }
      const continues = fam === family && fam !== 'other'
      const restart = type === 'numberedListItem' && family === 'numbered' && explicit !== null
      if (type === 'numberedListItem') {
        if (family === 'numbered' && explicit === null) number++
        else number = explicit ?? 1
        if (family !== 'numbered' && explicit === 1) this.losses.add(`${at}/props/start`, 'listStart')
      }
      try {
        if (started) {
          if (restart) {
            this.blank()
            this.push(prefix, '<!-- -->')
            this.blank()
          } else if (!continues) this.blank()
        }
        const start = this.lines.length + 1
        this.map.push({ id: typeof raw.id === 'string' ? raw.id : null, path: at, startLine: start, endLine: start })
        this.block(raw, type, props, at, prefix, frame.depth, number)
        // Bloco que não deu linha nenhuma (ilegível) sai do mapa.
        if (this.lines.length < start) this.map.splice(mark.map)
        else this.map[mark.map].endLine = this.lines.length
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err
        // O teto de saída no meio do bloco: ele sai inteiro (o separador, as
        // linhas, o mapa dos descendentes e as perdas dele), e os seguintes também.
        this.lines.length = mark.lines
        this.size = mark.size
        this.losses.truncate(mark.losses)
        this.map.length = mark.map
        this.losses.add(at, 'truncated')
        continue
      }
      started = true
      family = fam
      if (!isList && children.length > 0) {
        children.forEach((_, j) => this.losses.add(`${at}/children/${j}`, 'nestedUnderNonList'))
        if (frame.depth < HARD_MAX_DEPTH) stack.push({ list: children, index: 0, path: `${at}/children`, depth: frame.depth + 1 })
      }
    }
  }

  /** Conteúdo em linha de um bloco → linhas de Markdown, com as perdas no ponteiro do bloco. */
  inline(content: unknown, at: string): string[] {
    return inlineLines(readSegments(content, `${at}/content`, this.losses, false), 'block', false, false, kind => this.losses.add(`${at}/content`, kind))
  }

  blockLosses(props: Json, at: string, alignable: boolean): void {
    if (nonDefaultColor(props.textColor)) this.losses.add(`${at}/props/textColor`, 'textColor')
    if (nonDefaultColor(props.backgroundColor)) this.losses.add(`${at}/props/backgroundColor`, 'backgroundColor')
    if (alignable && typeof props.textAlignment === 'string' && props.textAlignment !== 'left') this.losses.add(`${at}/props/textAlignment`, 'alignment')
  }

  /** Linhas de um conteúdo em linha, com o marcador na 1ª e o recuo nas outras. */
  lead(prefix: string, marker: string, cont: string, lines: string[]): void {
    lines.forEach((text, k) => {
      if (k === 0) this.push(prefix, text === '' ? marker.trimEnd() : marker + text)
      else this.push(prefix + cont, text)
    })
  }

  block(raw: Json, type: string, props: Json, at: string, prefix: string, depth: number, number: number): void {
    const content = raw.content
    switch (type) {
      case 'paragraph':
        this.blockLosses(props, at, true)
        return this.lead(prefix, '', '', this.inline(content, at))
      case 'heading': {
        this.blockLosses(props, at, true)
        if (props.isToggleable === true) this.losses.add(`${at}/props/isToggleable`, 'toggle')
        const level = typeof props.level === 'number' && Number.isInteger(props.level) && props.level >= 1 && props.level <= 6 ? props.level : 1
        const [text] = inlineLines(readSegments(content, `${at}/content`, this.losses, false), 'single', false, true, kind => this.losses.add(`${at}/content`, kind))
        return this.push(prefix, text === '' ? '#'.repeat(level) : `${'#'.repeat(level)} ${text}`)
      }
      case 'quote': {
        this.blockLosses(props, at, false)
        return this.inline(content, at).forEach(text => this.push(prefix, text === '' ? '>' : `> ${text}`))
      }
      case 'bulletListItem':
      case 'toggleListItem':
      case 'checkListItem':
      case 'numberedListItem':
        return this.listItem(raw, type, props, at, prefix, depth, number)
      case 'codeBlock':
        return this.code(content, props, at, prefix)
      case 'table':
        this.blockLosses(props, at, false)
        return this.table(content, at, prefix)
      case 'divider':
        return this.push(prefix, '---')
      case 'image': {
        this.blockLosses(props, at, true)
        if (props.previewWidth !== undefined || props.showPreview === false) this.losses.add(`${at}/props`, 'imageProps')
        const name = str(props.name)
        const caption = str(props.caption)
        const url = str(props.url)
        if (/[\r\n]/.test(name + caption + url)) this.losses.add(`${at}/props`, 'imageProps')
        const alt = lineMarkdown(name ? [{ text: name.replace(/[\r\n]+/g, ' '), styles: 0, href: null }] : [], { lineStart: false, inTable: false, heading: false })
        const title = caption ? ` ${titleAttr(caption.replace(/[\r\n]+/g, ' '))}` : ''
        // O destino não tem quebra de linha nem com `<…>`; o navegador ignora CR e LF na url (WHATWG), então eles saem.
        return this.push(prefix, `![${alt}](${linkDest(url.replace(/[\r\n]+/g, ''))}${title})`)
      }
      default:
        if (MARKER_TYPES.includes(type)) return this.marker(raw, type, props, at, prefix)
        // Tipo desconhecido: o texto que houver, como parágrafo.
        this.losses.add(at, 'unreadable')
        if (plain(content) !== '') this.lead(prefix, '', '', this.inline(content, at))
    }
  }

  marker(raw: Json, type: string, props: Json, at: string, prefix: string): void {
    if (!this.markers) {
      this.losses.add(at, 'nonMarkdownBlock')
      const label = mediaLabel(type, props, this.cards)
      return this.push(prefix, lineMarkdown([{ text: label, styles: 0, href: null }], { lineStart: true, inTable: false, heading: false }))
    }
    const extra: [string, string][] = []
    if (type === 'projectCard' && this.cards === 'label') extra.push(['titulo', cardTitle(props)])
    if (type === 'file' || type === 'video' || type === 'audio') extra.push(['nome', str(props.name)])
    this.push(prefix, markerLine(str(raw.id), type, extra))
  }

  listItem(raw: Json, type: string, props: Json, at: string, prefix: string, depth: number, number: number): void {
    this.blockLosses(props, at, true)
    if (type === 'toggleListItem') this.losses.add(at, 'toggle')
    let marker = '- '
    if (type === 'checkListItem') marker = props.checked === true ? '- [x] ' : '- [ ] '
    else if (type === 'numberedListItem') marker = `${number}. `
    const width = type === 'numberedListItem' ? marker.length : 2
    const indent = ' '.repeat(width)
    const children = Array.isArray(raw.children) ? raw.children : []
    const lines = this.inline(raw.content, at)
    const firstChild = children[0]
    const firstIsList = isObject(firstChild) && LIST_TYPES.has(String(firstChild.type))
    // Item vazio com filho que não é lista: o comentário vazio guarda o lugar do
    // conteúdo (sem ele, o parágrafo do filho viraria o conteúdo do item).
    if (lines.length === 1 && lines[0] === '' && type !== 'checkListItem' && children.length > 0 && !firstIsList) lines[0] = '<!-- -->'
    this.lead(prefix, marker, indent, lines)
    if (children.length === 0) return
    if (depth >= HARD_MAX_DEPTH) return
    // Lista filha só interrompe o parágrafo do item se começa em 1 e não é vazia
    // (CommonMark); senão viraria texto do item: linha em branco antes.
    // O `[ ]` do checklist conta como texto do parágrafo.
    const hasText = type === 'checkListItem' || !(lines.length === 1 && lines[0] === '')
    if (!firstIsList || (hasText && !interrupts(firstChild as Json))) this.blank()
    this.siblings(children, `${at}/children`, prefix + indent, depth + 1, false)
  }

  code(content: unknown, props: Json, at: string, prefix: string): void {
    const segs = readSegments(content, `${at}/content`, this.losses, true)
    let text = segs.map(s => s.text).join('')
    // No código cercado não há entidade, e o \r cru seria fim de linha na leitura (e deslocaria o mapa de linhas).
    if (text.includes('\r')) {
      this.losses.add(`${at}/content`, 'codeLineEnding')
      text = text.replace(/\r\n?/g, '\n')
    }
    const language = typeof props.language === 'string' ? props.language : 'text'
    if (language === '' || /[\s]/.test(language)) this.losses.add(`${at}/props/language`, 'codeLanguage')
    const char = language.includes('`') ? '~' : '`'
    let longest = 0
    for (const m of text.matchAll(char === '`' ? /`+/g : /~+/g)) longest = Math.max(longest, m[0].length)
    const fence = char.repeat(Math.max(3, longest + 1))
    const info = language === 'text' ? '' : language.replace(/[\\]/g, '\\\\').replace(/&(?=#[0-9]+;|#[xX][0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)/g, '\\&').replace(/[\r\n]+/g, ' ')
    this.push(prefix, fence + info)
    if (text !== '') {
      for (const line of text.split('\n')) {
        if (prefix !== '' && line !== '' && /^[ \t]+$/.test(line)) this.losses.add(`${at}/content`, 'codeWhitespace')
        this.line(line === '' && /^[ \t]*$/.test(prefix) ? '' : prefix + line)
      }
    }
    this.push(prefix, fence)
  }

  table(content: unknown, at: string, prefix: string): void {
    if (!isObject(content) || !Array.isArray(content.rows) || content.rows.length === 0) {
      this.losses.add(at, 'unreadable')
      return
    }
    const where = `${at}/content`
    // Linha que não é objeto com cells fica de fora (não vira linha vazia da largura toda).
    const rows: unknown[][] = []
    const rowIndex: number[] = []
    const dropped: number[] = []
    content.rows.forEach((row, r) => {
      if (isObject(row) && Array.isArray(row.cells)) {
        rows.push(row.cells)
        rowIndex.push(r)
      } else dropped.push(r)
    })
    // Os tetos fatais do validador (TABLE_LIMITS, os do tableGridProblem), antes
    // de alocar a grade: a largura sem corte e as linhas × largura.
    let width = 0
    for (const cells of rows) width = Math.max(width, cells.reduce<number>((sum, c) => sum + span(c, 'colspan'), 0))
    if (rows.length === 0 || width > TABLE_LIMITS.maxColumns || rows.length * width > TABLE_LIMITS.maxCells) {
      this.losses.add(at, 'unreadable')
      return
    }
    for (const r of dropped) this.losses.add(`${where}/rows/${r}`, 'unreadable')
    if (Array.isArray(content.columnWidths) && content.columnWidths.some(w => typeof w === 'number')) this.losses.add(`${where}/columnWidths`, 'columnWidths')
    if (content.headerRows !== 1) this.losses.add(`${where}/headerRows`, 'headerRows')
    // A grade de ocupação: a célula vai para a 1ª posição livre; a mesclada deixa as outras vazias.
    width = Math.max(1, width)
    const grid: (string | null)[][] = rows.map(() => new Array(width).fill(null))
    const aligns: { at: string; align: string }[][] = Array.from({ length: width }, () => [])
    const taken = new Uint8Array(rows.length * width)
    rows.forEach((cells, r) => {
      let col = 0
      cells.forEach((cell, c) => {
        while (col < width && taken[r * width + col]) col++
        const cellAt = `${where}/rows/${rowIndex[r]}/cells/${c}`
        // A célula que não cabe na grade (as de cima a ocupam) fica de fora, com a perda.
        if (col >= width) return this.losses.add(cellAt, 'unreadable')
        const colspan = span(cell, 'colspan')
        const rowspan = span(cell, 'rowspan')
        if (colspan > 1 || rowspan > 1) this.losses.add(cellAt, 'mergedCells')
        for (let i = r; i < Math.min(rows.length, r + rowspan); i++) for (let j = col; j < Math.min(width, col + colspan); j++) taken[i * width + j] = 1
        const full = isObject(cell) && cell.type === 'tableCell'
        const cprops = full && isObject(cell.props) ? cell.props : {}
        if (nonDefaultColor(cprops.textColor)) this.losses.add(`${cellAt}/props/textColor`, 'textColor')
        if (nonDefaultColor(cprops.backgroundColor)) this.losses.add(`${cellAt}/props/backgroundColor`, 'backgroundColor')
        aligns[col].push({ at: `${cellAt}/props/textAlignment`, align: typeof cprops.textAlignment === 'string' ? cprops.textAlignment : 'left' })
        const segs = readSegments(full ? cell.content : cell, `${cellAt}/content`, this.losses, false)
        // Código com `\` logo antes de `|` não tem forma na célula do GFM: sai como texto.
        for (const seg of segs) {
          if (seg.styles & CODE && /\\\|/.test(seg.text)) {
            seg.styles &= ~CODE
            this.losses.add(`${cellAt}/content`, 'codeSpan')
          }
        }
        grid[r][col] = inlineLines(segs, 'single', true, false, kind => this.losses.add(`${cellAt}/content`, kind))[0]
        col += colspan
      })
    })
    // Alinhamento da coluna: o das células, quando é um só (e não justify).
    const delims = aligns.map(list => {
      const first = list[0]?.align ?? 'left'
      if (list.every(a => a.align === first) && first !== 'justify') return first === 'center' ? ':---:' : first === 'right' ? '---:' : '---'
      for (const a of list) if (a.align !== 'left') this.losses.add(a.at, 'alignment')
      return '---'
    })
    // O Markdown lido de volta tem headerRows 1, e o normalize põe headerCols no
    // ponto fixo do editor: a largura quando só há a linha de cabeçalho, senão 0.
    const headerCols = typeof content.headerCols === 'number' ? content.headerCols : 0
    if (headerCols !== (rows.length === 1 ? width : 0)) this.losses.add(`${where}/headerCols`, 'headerCols')
    const row = (r: number) => `| ${grid[r].map(cell => cell ?? '').join(' | ')} |`
    this.push(prefix, row(0))
    this.push(prefix, `| ${delims.join(' | ')} |`)
    for (let r = 1; r < rows.length; r++) this.push(prefix, row(r))
  }
}

/** O item de lista pode interromper um parágrafo (o 1º filho logo depois do conteúdo do item)? */
function interrupts(child: Json): boolean {
  const props = isObject(child.props) ? child.props : {}
  if (child.type === 'checkListItem') return true
  // Só espaço por qualquer regra (NBSP, U+3000, \f…), não só a do CommonMark
  // (espaço e tab): a linha em branco antes não depende da leitura.
  if (plain(child.content).trim() === '') return false
  if (child.type !== 'numberedListItem') return true
  return props.start === undefined || props.start === 1 || typeof props.start !== 'number' || !Number.isInteger(props.start) || props.start < 0 || props.start > MAX_START
}

function span(cell: unknown, key: 'colspan' | 'rowspan'): number {
  if (!isObject(cell) || !isObject(cell.props)) return 1
  const v = cell.props[key]
  return typeof v === 'number' && Number.isInteger(v) && v > 1 ? Math.min(v, 50) : 1
}

/**
 * Nota → Markdown. Ids repetidos (ou que não são texto) ganham id novo antes
 * (withUniqueIds), para os marcadores apontarem para um bloco só.
 */
export function blocksToMarkdown(blocks: unknown, opts: RenderOptions = {}): MarkdownRender {
  const renderer = new Renderer(opts)
  const list = withUniqueIds(blocks)
  try {
    renderer.siblings(list, '', '', 1, true)
  } catch {
    // Nada aqui deveria lançar; se lançar, sai o que deu para montar.
    renderer.losses.add('', 'unreadable')
  }
  const lines = renderer.lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  // O trecho de cada bloco inclui os descendentes (os filhos achatados também).
  const byPath = new Map(renderer.map.map(entry => [entry.path, entry]))
  for (const entry of renderer.map) {
    let path = entry.path
    for (;;) {
      const cut = path.lastIndexOf('/children/')
      if (cut < 0) break
      path = path.slice(0, cut)
      const parent = byPath.get(path)
      if (parent && parent.endLine < entry.endLine) parent.endLine = entry.endLine
    }
  }
  for (const entry of renderer.map) entry.endLine = Math.min(entry.endLine, Math.max(lines.length, entry.startLine))
  return { markdown: lines.length > 0 ? `${lines.join('\n')}\n` : '', losses: renderer.losses.list, blocks: renderer.map }
}

// ── Texto puro ────────────────────────────────────────────────────────────────

/**
 * Texto da nota sem marcação: um bloco por linha, filhos recuados, itens com
 * `- `, `N. `, `[ ] `/`[x] `, citação com `> `, tabela em `a | b` e rótulos
 * pt-BR nos blocos sem texto (_domain/i18n.pt-BR.ts). Os dados do card só com
 * cards: 'label'. Tolerante como o render.
 */
export function blocksToText(blocks: unknown, opts: { cards?: 'opaque' | 'label' } = {}): string {
  const cards = opts.cards ?? 'opaque'
  const out: string[] = []
  const walk = (list: unknown[], indent: string, depth: number): void => {
    let number = 0
    let prevNumbered = false
    for (const raw of list) {
      if (!isObject(raw)) continue
      const type = typeof raw.type === 'string' ? raw.type : 'paragraph'
      const props = isObject(raw.props) ? raw.props : {}
      const push = (text: string, lead = '') => text.split('\n').forEach((line, k) => out.push(`${indent}${k === 0 ? lead : ' '.repeat(lead.length)}${line}`))
      if (type === 'numberedListItem') {
        const start = typeof props.start === 'number' && Number.isInteger(props.start) ? props.start : null
        number = prevNumbered && start === null ? number + 1 : start ?? 1
      }
      prevNumbered = type === 'numberedListItem'
      switch (type) {
        case 'bulletListItem': case 'toggleListItem': push(plain(raw.content), '- '); break
        case 'numberedListItem': push(plain(raw.content), `${number}. `); break
        case 'checkListItem': push(plain(raw.content), props.checked === true ? '[x] ' : '[ ] '); break
        case 'quote': push(plain(raw.content), '> '); break
        case 'divider': push('---'); break
        case 'table': {
          const content = raw.content
          if (isObject(content) && Array.isArray(content.rows)) {
            for (const row of content.rows) {
              if (!isObject(row) || !Array.isArray(row.cells)) continue
              push(row.cells.map(cell => plain(isObject(cell) && cell.type === 'tableCell' ? cell.content : cell).replace(/\n/g, ' ')).join(' | '))
            }
          }
          break
        }
        default:
          if (type === 'image' || MARKER_TYPES.includes(type)) push(mediaLabel(type, props, cards))
          else push(plain(raw.content))
      }
      if (Array.isArray(raw.children) && raw.children.length > 0 && depth < HARD_MAX_DEPTH) walk(raw.children, `${indent}  `, depth + 1)
    }
  }
  try {
    if (Array.isArray(blocks)) walk(blocks, '', 1)
  } catch {
    // Nada aqui deveria lançar; se lançar, sai o texto que deu para montar.
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out.join('\n')
}

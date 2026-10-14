// API-023: parser em linha do Markdown (CommonMark 0.31 + GFM), sem DOM e
// linear no tamanho da entrada. É um porte enxuto do algoritmo do
// commonmark.js (pilha de delimitadores com openers_bottom, árvore de ênfase e
// pilha de colchetes), com as travas que as bibliotecas prontas não têm:
// - ênfase: cada par vira um nó que embrulha o trecho entre o abridor e o
//   fechador (o estilo é aplicado numa passada só no fim), e não nó a nó;
// - colchetes: a desativação dos abridores de link abaixo de um link é um
//   piso (`linkFloor`), sem percorrer a pilha;
// - destino de link com no máximo 32 parênteses, rótulo com até 999
//   caracteres e índice das corridas de crases calculado uma vez;
// - comentário HTML com o fim memorizado e tag com atributos limitados;
// - autolink literal com o fim da corrida e o domínio memorizados (gatilho
//   recusado custa O(1)) e parênteses finais contados uma vez;
// - cortes de espaço e tab por laço (spaceTab.ts), nunca regex ancorada no fim.
// O marked e o micromark ficam de fora porque são quadráticos com entrada
// adversária (docs/api-arquitetura.md, Apêndice B).
//
// Diferenças de propósito em relação ao CommonMark/GFM: `<br>` vira quebra de
// linha; HTML em linha some e o texto fica; o escape bloqueia o autolink
// literal (`https\://`, `www\.`, `a\@b.com` ficam texto); nota de rodapé fica
// texto. A classificação de pontuação e espaço no flanqueamento é por unidade
// UTF-16, como no micromark (um emoji conta como letra).

import { trimEndSpaceTab } from './spaceTab.ts'

/** Tetos da sintaxe que mantêm o parser linear (docs/api-arquitetura.md, Apêndice B). */
export const MARKDOWN_SYNTAX_LIMITS = { maxLinkParens: 32, maxLabel: 999 } as const

export const BOLD = 1
export const ITALIC = 2
export const STRIKE = 4
export const CODE = 8

export interface LinkRef {
  href: string
  title: string
}

/** Um trecho do resultado: texto com estilos (bits acima) e link, ou uma imagem. */
export type InlinePiece =
  | { kind: 'text'; text: string; styles: number; href: string | null }
  | { kind: 'image'; src: string; alt: string; title: string; offset: number }

export type InlineWarning = 'htmlDropped' | 'unsafeLink' | 'softBreak'

export interface InlineOptions {
  refs?: ReadonlyMap<string, LinkRef>
  /** Aviso com a posição no texto (o chamador converte em linha). */
  warn?: (code: InlineWarning, offset: number) => void
  /** Erro com a posição (marcador de bloco no meio do texto). */
  fail?: (keyword: string, message: string, offset: number) => void
  /** Confere o destino do link (isAllowedHref): o recusado vira só texto. */
  allowHref?: (href: string) => boolean
}

// ── Classes de caractere (por unidade UTF-16, como o micromark) ──────────────

const ASCII_PUNCT = /[!-/:-@[-`{-~]/
const UNICODE_PUNCT = /[\p{P}\p{S}]/u
const UNICODE_SPACE = /\s/

/** 1 = espaço (ou fim), 2 = pontuação, 0 = o resto. Recebe o código da unidade UTF-16, ou -1 nas bordas. */
export function charClass(code: number): 0 | 1 | 2 {
  if (code < 0) return 1
  if (code < 128) {
    if (code === 32 || (code >= 9 && code <= 13)) return 1
    return ASCII_PUNCT.test(String.fromCharCode(code)) ? 2 : 0
  }
  const ch = String.fromCharCode(code)
  if (UNICODE_SPACE.test(ch)) return 1
  return UNICODE_PUNCT.test(ch) ? 2 : 0
}

export function isAsciiPunct(ch: string): boolean {
  return ch.length === 1 && ASCII_PUNCT.test(ch)
}

// ── Entidades ─────────────────────────────────────────────────────────────────

// Subconjunto das entidades nomeadas do HTML5: as comuns em texto e as letras
// acentuadas do português. As outras ficam literais (divergência documentada).
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  bull: '•', middot: '·', deg: '°', plusmn: '±', times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', larr: '←', rarr: '→',
  uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔', ne: '≠', le: '≤', ge: '≥', infin: '∞', minus: '−',
  micro: 'µ', prime: '′', Prime: '″', dagger: '†', Dagger: '‡', permil: '‰', iexcl: '¡', iquest: '¿', ordf: 'ª',
  ordm: 'º', shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', check: '✓',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã', auml: 'ä', Auml: 'Ä',
  ccedil: 'ç', Ccedil: 'Ç', eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê', iacute: 'í', Iacute: 'Í',
  oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', ouml: 'ö', Ouml: 'Ö', uacute: 'ú', Uacute: 'Ú',
  uuml: 'ü', Uuml: 'Ü', ntilde: 'ñ', Ntilde: 'Ñ', szlig: 'ß',
}

const ENTITY = /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/y

/** Entidade em `pos` (que aponta para '&'): o texto e o fim, ou null (fica literal). */
export function entityAt(s: string, pos: number): { text: string; end: number } | null {
  ENTITY.lastIndex = pos
  const m = ENTITY.exec(s)
  if (!m) return null
  if (m[3] !== undefined) {
    return Object.hasOwn(NAMED, m[3]) ? { text: NAMED[m[3]], end: pos + m[0].length } : null
  }
  const code = m[1] !== undefined ? Number(m[1]) : parseInt(m[2], 16)
  // Código 0, além de U+10FFFF ou metade de surrogate: U+FFFD (o jsonb recusaria o original).
  const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
  return { text: valid ? String.fromCodePoint(code) : '\ufffd', end: pos + m[0].length }
}

/** Escapes de pontuação ASCII e entidades (destino, título, info do código, definição). */
export function unescapeString(s: string): string {
  if (!s.includes('\\') && !s.includes('&')) return s
  let out = ''
  let last = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length && isAsciiPunct(s[i + 1])) {
      out += s.slice(last, i) + s[i + 1]
      i++
      last = i + 1
    } else if (c === '&') {
      const ent = entityAt(s, i)
      if (ent) {
        out += s.slice(last, i) + ent.text
        i = ent.end - 1
        last = ent.end
      }
    }
  }
  return out + s.slice(last)
}

// ── Rótulos, destinos e títulos (compartilhados com as definições de referência) ─

/** Rótulo como o micromark normaliza (normalizeIdentifier). */
export function normalizeLabel(raw: string): string {
  return raw.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '').toLowerCase().toUpperCase()
}

const LABEL = /\[(?:[^\\[\]]|\\[\s\S]){0,999}\]/y

/** `[rótulo]` em `pos`: o tamanho (com os colchetes) ou 0. */
export function linkLabelLength(s: string, pos: number): number {
  LABEL.lastIndex = pos
  const m = LABEL.exec(s)
  return m ? m[0].length : 0
}

const ANGLE_DEST = /<((?:[^<>\n\\]|\\[\s\S])*)>/y

/** Destino em `pos`: `<…>` ou cru com parênteses equilibrados (no máximo 32). */
export function linkDestination(s: string, pos: number): { href: string; end: number } | null {
  if (s.charCodeAt(pos) === 60) {
    ANGLE_DEST.lastIndex = pos
    const m = ANGLE_DEST.exec(s)
    return m ? { href: unescapeString(m[1]), end: pos + m[0].length } : null
  }
  let depth = 0
  let i = pos
  for (; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code === 92 && i + 1 < s.length && isAsciiPunct(s[i + 1])) {
      i++
    } else if (code === 40) {
      if (++depth > MARKDOWN_SYNTAX_LIMITS.maxLinkParens) return null
    } else if (code === 41) {
      if (depth === 0) break
      depth--
    } else if (code <= 32 || code === 127) {
      break
    }
  }
  if (i === pos || depth !== 0) return null
  return { href: unescapeString(s.slice(pos, i)), end: i }
}

const TITLE = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|\(((?:\\[\s\S]|[^()\\])*)\)/y

export function linkTitle(s: string, pos: number): { title: string; end: number } | null {
  TITLE.lastIndex = pos
  const m = TITLE.exec(s)
  if (!m) return null
  return { title: unescapeString(m[1] ?? m[2] ?? m[3]), end: pos + m[0].length }
}

/** Espaços, no máximo uma quebra de linha, espaços. */
export function skipSpaceNewline(s: string, pos: number): number {
  let i = pos
  while (s[i] === ' ' || s[i] === '\t') i++
  if (s[i] === '\n') {
    i++
    while (s[i] === ' ' || s[i] === '\t') i++
  }
  return i
}

// ── Autolinks ─────────────────────────────────────────────────────────────────

const URI_AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*)>/y // eslint-disable-line no-control-regex
const EMAIL_AUTOLINK = /<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y
// Gatilhos do autolink literal do GFM, num passe só (o escape fica de fora:
// `https\://`, `www\.` e `a\@b` não casam no texto cru).
const LITERAL_TRIGGER = /(?<![A-Za-z])https?:\/\/|(?<![^\s*_~([\]])www\.|(?<![A-Za-z0-9._+\-\\])[A-Za-z0-9._+-]+@/gi

// Pontuação final que não entra no autolink literal.
const TRAILING_PUNCT = '?!.,:*_~\'"'

function isAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** Começo da entidade `&nome;` que termina em `end` (`s[end - 1]` é `;`), sem voltar antes de `lo`; ou -1. */
function entityStart(s: string, end: number, lo: number): number {
  let k = end - 1
  while (k > lo && isAlnum(s.charCodeAt(k - 1))) k--
  return k < end - 1 && k > lo && s.charCodeAt(k - 1) === 38 ? k - 1 : -1
}

/**
 * Fim do autolink literal (GFM) a partir do fim da corrida (`runEnd`: até
 * espaço ou `<`, e antes de `](` ou `][`, como o micromark, para o literal
 * dentro do texto de um link): sem a pontuação final (`?!.,:*_~'"`), sem o `)`
 * a mais e sem a entidade do fim. Os parênteses são contados uma vez e
 * descontados ao recuar (o gatilho não tem parênteses, então contar a partir
 * de `from` dá o mesmo que a partir do começo do link).
 */
function literalEnd(s: string, from: number, runEnd: number): number {
  let open = 0
  let close = 0
  for (let i = from; i < runEnd; i++) {
    const code = s.charCodeAt(i)
    if (code === 40) open++
    else if (code === 41) close++
  }
  let end = runEnd
  while (end > from) {
    const ch = s[end - 1]
    if (TRAILING_PUNCT.includes(ch)) end--
    else if (ch === ')' && close > open) {
      close--
      end--
    } else {
      // A entidade não tem parênteses: a contagem não muda.
      const amp = ch === ';' ? entityStart(s, end, from) : -1
      if (amp < 0) break
      end = amp
    }
  }
  return end
}

/** Os dois últimos segmentos de um domínio [lo, x): o que a validade precisa para qualquer começo ≥ lo. */
interface DomainTail {
  /** Último caractere que não é `.` (o domínio vazio ou só de pontos não vale). */
  nonDot: number
  /** Último `.`, e o último `_` depois dele e entre ele e o penúltimo `.` (-1 quando não há). */
  dot: number
  underscore: number
  prevUnderscore: number
}

function domainTail(s: string, lo: number, x: number): DomainTail {
  let nonDot = x - 1
  while (nonDot >= lo && s.charCodeAt(nonDot) === 46) nonDot--
  let dot = -1
  let underscore = -1
  let prevUnderscore = -1
  for (let i = x - 1; i >= lo; i--) {
    const code = s.charCodeAt(i)
    if (code === 46) {
      if (dot >= 0) break
      dot = i
    } else if (code === 95) {
      if (dot < 0) {
        if (underscore < 0) underscore = i
      } else if (prevUnderscore < 0) prevUnderscore = i
    }
  }
  return { nonDot, dot, underscore, prevUnderscore }
}

/** O domínio [from, x) vale? Algo além de pontos e sem `_` nos dois últimos segmentos (cortados em `from`). */
function domainOk(t: DomainTail, from: number): boolean {
  return t.nonDot >= from && t.underscore < from && (t.dot < from || t.prevUnderscore < from)
}

/** A corrida de domínio varrida por último: o fim e os dois últimos segmentos, inteira e sem os `.` e `_` do fim. */
interface DomainScan {
  from: number
  end: number
  full: DomainTail
  trimmed: DomainTail
}

/**
 * Autolink literal de `http://`, `https://` e `www.` com as varreduras
 * memorizadas: os gatilhos de uma mesma corrida (`(http://`, `_www.` ou
 * `www._` repetidos) reaproveitam o fim do domínio, os dois últimos segmentos
 * dele, o fim da corrida sem espaço e o começo da pontuação final, e o gatilho
 * recusado custa O(1) amortizado. O resultado é o da conta direta: o fim
 * cortado (literalEnd) e o domínio só até ele, que corta do domínio os `.` e
 * `_` do fim quando tudo depois dele sai como pontuação final.
 */
class LiteralScanner {
  readonly s: string
  dom: DomainScan | null = null
  runFrom = -1
  runEnd = -1
  /** Começo da pontuação final da corrida (-1 = não calculado). */
  runTail = -1

  constructor(s: string) {
    this.s = s
  }

  domain(from: number): DomainScan {
    const d = this.dom
    if (d && from >= d.from && from < d.end) return d
    const s = this.s
    let end = from
    for (; end < s.length; end++) {
      const code = s.charCodeAt(end)
      if (code !== 46 && code !== 95 && code !== 45 && charClass(code) !== 0) break
    }
    let cut = end
    while (cut > from && (s.charCodeAt(cut - 1) === 46 || s.charCodeAt(cut - 1) === 95)) cut--
    const full = domainTail(s, from, end)
    this.dom = { from, end, full, trimmed: cut === end ? full : domainTail(s, from, cut) }
    return this.dom
  }

  /** Fim da corrida sem espaço que contém `from`. */
  run(from: number): number {
    if (from < this.runFrom || from >= this.runEnd) {
      const s = this.s
      let end = from
      while (end < s.length) {
        const code = s.charCodeAt(end)
        if (code === 60 || charClass(code) === 1) break
        if (code === 93 && (s[end + 1] === '(' || s[end + 1] === '[')) break
        end++
      }
      this.runFrom = from
      this.runEnd = end
      this.runTail = -1
    }
    return this.runEnd
  }

  /**
   * Começo do trecho final da corrida que só tem pontuação final, `)` e
   * entidades. Depois do domínio não há `(`, então ali todo `)` sai: o corte
   * do literalEnd chega ao domínio exatamente quando este começo não passa dele.
   */
  tail(): number {
    if (this.runTail < 0) {
      const s = this.s
      let end = this.runEnd
      while (end > this.runFrom) {
        const ch = s[end - 1]
        if (ch === ')' || TRAILING_PUNCT.includes(ch)) {
          end--
          continue
        }
        const amp = ch === ';' ? entityStart(s, end, this.runFrom) : -1
        if (amp < 0) break
        end = amp
      }
      this.runTail = end
    }
    return this.runTail
  }

  at(pos: number, trigger: string): { href: string; text: string; end: number } | null {
    const from = pos + trigger.length
    const d = this.domain(from)
    const whole = domainOk(d.full, from)
    const cut = d.trimmed === d.full ? whole : domainOk(d.trimmed, from)
    if (whole !== cut) {
      // O veredito depende de o corte do fim chegar ao domínio.
      this.run(from)
      if (!(this.tail() <= d.end ? cut : whole)) return null
    } else if (!whole) return null
    const end = literalEnd(this.s, from, this.run(from))
    const text = this.s.slice(pos, end)
    return { href: trigger.toLowerCase().startsWith('www') ? `http://${text}` : text, text, end }
  }
}

/** Autolink literal de e-mail que começa em `pos` (um gatilho `…@` do LITERAL_TRIGGER): o link ou null. */
function emailAutolink(s: string, pos: number, trigger: string): { href: string; text: string; end: number } | null {
  let end = pos + trigger.length
  let dots = 0
  let segStart = end
  for (; end < s.length; end++) {
    const ch = s[end]
    if (ch === '.') {
      if (end === segStart) break
      dots++
      segStart = end + 1
    } else if (!/[A-Za-z0-9_-]/.test(ch)) break
  }
  // Ponto final, hífen ou sublinhado no fim não entram; o último segmento não pode ficar vazio.
  while (end > pos + trigger.length && '.-_'.includes(s[end - 1])) {
    if (s[end - 1] === '.') dots--
    end--
  }
  if (dots < 1) return null
  const text = s.slice(pos, end)
  return { href: `mailto:${text}`, text, end }
}

// ── HTML em linha ─────────────────────────────────────────────────────────────

// Tag com atributos limitados: um `<` adversário nunca faz o regex varrer a entrada.
const OPEN_TAG = /<[A-Za-z][A-Za-z0-9-]{0,63}(?:\s{1,64}[A-Za-z_:][A-Za-z0-9_.:-]{0,63}(?:\s{0,64}=\s{0,64}(?:[^\s"'=<>`]{1,1024}|'[^']{0,1024}'|"[^"]{0,1024}"))?){0,64}\s{0,64}\/?>/y
const CLOSE_TAG = /<\/[A-Za-z][A-Za-z0-9-]{0,63}\s{0,64}>/y
const BR_TAG = /^<br\s*\/?>$/i
const MARKER_START = /^<!--\s*akool:/

// ── Nós ───────────────────────────────────────────────────────────────────────

type NodeKind = 'root' | 'text' | 'br' | 'code' | 'link' | 'image' | 'em' | 'strong' | 'strike'

interface INode {
  t: NodeKind
  v: string
  prev: INode | null
  next: INode | null
  parent: INode | null
  first: INode | null
  last: INode | null
  href: string
  title: string
  at: number
}

function node(t: NodeKind, v = '', at = 0): INode {
  return { t, v, prev: null, next: null, parent: null, first: null, last: null, href: '', title: '', at }
}

function append(parent: INode, child: INode): void {
  child.parent = parent
  child.prev = parent.last
  child.next = null
  if (parent.last) parent.last.next = child
  else parent.first = child
  parent.last = child
}

function unlink(n: INode): void {
  const parent = n.parent as INode
  if (n.prev) n.prev.next = n.next
  else parent.first = n.next
  if (n.next) n.next.prev = n.prev
  else parent.last = n.prev
  n.prev = n.next = n.parent = null
}

/** Põe `wrap` entre o abridor e o fechador da ênfase (o fechador sempre vem logo depois). */
function insertBetween(opener: INode, wrap: INode): void {
  const closer = opener.next as INode
  wrap.parent = opener.parent
  wrap.prev = opener
  wrap.next = closer
  closer.prev = wrap
  opener.next = wrap
}

interface Delim {
  node: INode
  cc: number
  count: number
  orig: number
  canOpen: boolean
  canClose: boolean
  prev: Delim | null
  next: Delim | null
}

interface Bracket {
  node: INode
  image: boolean
  at: number
  prevDelim: Delim | null
  bracketAfter: boolean
}

const SPECIAL = /[\n\\`*_~[\]!<&]/g

// ── Parser ────────────────────────────────────────────────────────────────────

class InlineParser {
  readonly s: string
  readonly opts: InlineOptions
  readonly root = node('root')
  pos = 0
  delims: Delim | null = null
  readonly brackets: Bracket[] = []
  /** Abridores de link (não de imagem) abaixo deste índice da pilha estão desativados. */
  linkFloor = 0
  buf = ''
  /** Corridas máximas de crases por tamanho, e o ponteiro de cada tamanho. */
  ticks: Map<number, number[]> | null = null
  readonly tickPtr = new Map<number, number>()
  /** Fim do próximo comentário HTML (memorizado): -2 = não procurado, -1 = não há. */
  commentEnd = -2
  commentFrom = 0
  readonly triggers: { at: number; text: string }[] = []
  trig = 0
  readonly literal: LiteralScanner

  constructor(s: string, opts: InlineOptions) {
    this.s = s
    this.opts = opts
    this.literal = new LiteralScanner(s)
    LITERAL_TRIGGER.lastIndex = 0
    for (let m = LITERAL_TRIGGER.exec(s); m; m = LITERAL_TRIGGER.exec(s)) this.triggers.push({ at: m.index, text: m[0] })
  }

  flush(): void {
    if (this.buf) {
      append(this.root, node('text', this.buf))
      this.buf = ''
    }
  }

  text(v: string): INode {
    this.flush()
    const n = node('text', v)
    append(this.root, n)
    return n
  }

  parse(): INode {
    const s = this.s
    // Posição do próximo caractere especial, guardada: procurar de novo a cada
    // gatilho de autolink tornaria `a@a@a@…` quadrático.
    let special = -1
    while (this.pos < s.length) {
      while (this.trig < this.triggers.length && this.triggers[this.trig].at < this.pos) this.trig++
      const nextTrigger = this.trig < this.triggers.length ? this.triggers[this.trig].at : s.length
      if (special < this.pos) {
        SPECIAL.lastIndex = this.pos
        const sp = SPECIAL.exec(s)
        special = sp ? sp.index : s.length
      }
      // O texto até o próximo especial ou gatilho é literal.
      const next = Math.min(special, nextTrigger)
      if (next > this.pos) {
        this.buf += s.slice(this.pos, next)
        this.pos = next
        continue
      }
      if (this.pos === nextTrigger && this.autolinkLiteral()) continue
      if (special !== this.pos) {
        this.buf += s[this.pos++]
        continue
      }
      this.special(s.charCodeAt(this.pos))
    }
    this.flush()
    this.processEmphasis(null)
    return this.root
  }

  special(code: number): void {
    switch (code) {
      case 10: return this.newline()
      case 92: return this.backslash()
      case 96: return this.backticks()
      case 42: case 95: case 126: return this.delimRun(code)
      case 91: return this.openBracket(false)
      case 33:
        if (this.s.charCodeAt(this.pos + 1) === 91) return this.openBracket(true)
        this.buf += '!'
        this.pos++
        return
      case 93: return this.closeBracket()
      case 60: return this.lessThan()
      default: return this.ampersand()
    }
  }

  newline(): void {
    // Quebra dura com 2+ espaços antes; os espaços e tabs do fim da linha saem.
    const trimmed = trimEndSpaceTab(this.buf)
    const hard = this.buf.length - trimmed.length >= 2 && this.buf.endsWith('  ')
    this.buf = trimmed
    this.flush()
    // A quebra suave vira espaço (decisão 3 do plano; o BlockNote faz o mesmo).
    append(this.root, hard ? node('br') : node('text', ' '))
    if (!hard) this.opts.warn?.('softBreak', this.pos)
    this.pos++
    while (this.s[this.pos] === ' ' || this.s[this.pos] === '\t') this.pos++
  }

  backslash(): void {
    const next = this.s[this.pos + 1]
    if (next === '\n') {
      this.flush()
      append(this.root, node('br'))
      this.pos += 2
      while (this.s[this.pos] === ' ' || this.s[this.pos] === '\t') this.pos++
    } else if (next !== undefined && isAsciiPunct(next)) {
      this.buf += next
      this.pos += 2
    } else {
      this.buf += '\\'
      this.pos++
    }
  }

  backticks(): void {
    const s = this.s
    const start = this.pos
    let end = start
    while (s.charCodeAt(end) === 96) end++
    const len = end - start
    if (!this.ticks) {
      // Índice das corridas máximas, uma vez: cada busca de fechador é amortizada.
      this.ticks = new Map()
      for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) !== 96) continue
        let j = i
        while (s.charCodeAt(j) === 96) j++
        const list = this.ticks.get(j - i)
        if (list) list.push(i)
        else this.ticks.set(j - i, [i])
        i = j - 1
      }
    }
    const list = this.ticks.get(len) ?? []
    let p = this.tickPtr.get(len) ?? 0
    while (p < list.length && list[p] < end) p++
    this.tickPtr.set(len, p)
    if (p >= list.length) {
      this.buf += s.slice(start, end)
      this.pos = end
      return
    }
    const close = list[p]
    this.tickPtr.set(len, p + 1)
    let code = s.slice(end, close).replace(/\n/g, ' ')
    if (code.length >= 2 && code[0] === ' ' && code[code.length - 1] === ' ' && /[^ ]/.test(code)) code = code.slice(1, -1)
    this.flush()
    append(this.root, node('code', code))
    this.pos = close + len
  }

  delimRun(cc: number): void {
    const s = this.s
    const start = this.pos
    let end = start
    while (s.charCodeAt(end) === cc) end++
    const count = end - start
    this.pos = end
    const before = charClass(start > 0 ? s.charCodeAt(start - 1) : -1)
    const after = charClass(end < s.length ? s.charCodeAt(end) : -1)
    const left = after !== 1 && (after !== 2 || before !== 0)
    const right = before !== 1 && (before !== 2 || after !== 0)
    let canOpen = left
    let canClose = right
    if (cc === 95) {
      canOpen = left && (!right || before === 2)
      canClose = right && (!left || after === 2)
    }
    // Tachado do GFM: corrida de um ou dois `~`; de três em diante é texto.
    if (cc === 126 && count > 2) canOpen = canClose = false
    const n = this.text(s.slice(start, end))
    if (!canOpen && !canClose) return
    const d: Delim = { node: n, cc, count, orig: count, canOpen, canClose, prev: this.delims, next: null }
    if (this.delims) this.delims.next = d
    this.delims = d
  }

  removeDelim(d: Delim): void {
    if (d.prev) d.prev.next = d.next
    if (d.next) d.next.prev = d.prev
    else this.delims = d.prev
  }

  /** process emphasis do CommonMark (com `~` do GFM), com openers_bottom por classe de fechador. */
  processEmphasis(bottom: Delim | null): void {
    const openersBottom = new Map<string, Delim | null>()
    let closer = this.delims
    while (closer && closer.prev !== bottom) closer = closer.prev
    while (closer) {
      if (!closer.canClose) {
        closer = closer.next
        continue
      }
      const key = closer.cc === 126 ? `~${closer.count}` : `${closer.cc}:${closer.canOpen ? 1 : 0}:${closer.orig % 3}`
      const floor = openersBottom.has(key) ? openersBottom.get(key) : bottom
      let opener = closer.prev
      let found = false
      while (opener && opener !== bottom && opener !== floor) {
        if (opener.cc === closer.cc && opener.canOpen) {
          if (closer.cc === 126) {
            if (opener.count === closer.count) {
              found = true
              break
            }
          } else {
            const oddMatch = (closer.canOpen || opener.canClose) && closer.orig % 3 !== 0 && (opener.orig + closer.orig) % 3 === 0
            if (!oddMatch) {
              found = true
              break
            }
          }
        }
        opener = opener.prev
      }
      const oldCloser = closer
      if (found && opener) {
        const use = closer.cc === 126 ? closer.count : closer.count >= 2 && opener.count >= 2 ? 2 : 1
        const openerNode = opener.node
        const closerNode = closer.node
        opener.count -= use
        closer.count -= use
        openerNode.v = openerNode.v.slice(0, openerNode.v.length - use)
        closerNode.v = closerNode.v.slice(0, closerNode.v.length - use)
        // A árvore de ênfase: o trecho entre os dois vira filho do nó novo.
        const wrap = node(closer.cc === 126 ? 'strike' : use === 2 ? 'strong' : 'em')
        let tmp = openerNode.next
        while (tmp && tmp !== closerNode) {
          const nx = tmp.next
          unlink(tmp)
          append(wrap, tmp)
          tmp = nx
        }
        insertBetween(openerNode, wrap)
        // Os delimitadores entre os dois deixam de valer.
        opener.next = closer
        closer.prev = opener
        if (opener.count === 0) {
          unlink(openerNode)
          this.removeDelim(opener)
        }
        if (closer.count === 0) {
          unlink(closerNode)
          const nx = closer.next
          this.removeDelim(closer)
          closer = nx
        }
      } else {
        closer = closer.next
        openersBottom.set(key, oldCloser.prev)
        if (!oldCloser.canOpen) this.removeDelim(oldCloser)
      }
    }
    while (this.delims && this.delims !== bottom) this.removeDelim(this.delims)
  }

  openBracket(image: boolean): void {
    const n = this.text(image ? '![' : '[')
    const top = this.brackets[this.brackets.length - 1]
    if (top) top.bracketAfter = true
    this.brackets.push({ node: n, image, at: this.pos, prevDelim: this.delims, bracketAfter: false })
    this.pos += image ? 2 : 1
  }

  popBracket(): void {
    this.brackets.pop()
    if (this.linkFloor > this.brackets.length) this.linkFloor = this.brackets.length
  }

  closeBracket(): void {
    const s = this.s
    this.pos++
    const startpos = this.pos
    const depth = this.brackets.length - 1
    const opener = this.brackets[depth]
    if (!opener) {
      this.buf += ']'
      return
    }
    if (!opener.image && depth < this.linkFloor) {
      this.popBracket()
      this.buf += ']'
      return
    }
    let dest: string | null = null
    let title = ''
    let matched = false
    if (s.charCodeAt(this.pos) === 40) {
      let p = skipSpaceNewline(s, this.pos + 1)
      const d = linkDestination(s, p) ?? (s.charCodeAt(p) === 41 ? { href: '', end: p } : null)
      if (d) {
        p = d.end
        const beforeTitle = p
        p = skipSpaceNewline(s, p)
        let t: { title: string; end: number } | null = null
        if (p !== beforeTitle) t = linkTitle(s, p)
        if (t) p = skipSpaceNewline(s, t.end)
        else p = skipSpaceNewline(s, beforeTitle)
        if (s.charCodeAt(p) === 41) {
          dest = d.href
          title = t?.title ?? ''
          this.pos = p + 1
          matched = true
        }
      }
    }
    if (!matched && this.opts.refs && this.opts.refs.size > 0) {
      const labelLen = linkLabelLength(s, this.pos)
      let raw: string | null = null
      if (labelLen > 2) raw = s.slice(this.pos + 1, this.pos + labelLen - 1)
      else if (!opener.bracketAfter && startpos - 1 - (opener.at + (opener.image ? 2 : 1)) <= 999) {
        raw = s.slice(opener.at + (opener.image ? 2 : 1), startpos - 1)
      }
      // Nota de rodapé ([^1]) não é referência (GFM): fica texto.
      const ref = raw !== null && !raw.startsWith('^') ? this.opts.refs.get(normalizeLabel(raw)) : undefined
      if (ref) {
        dest = ref.href
        title = ref.title
        matched = true
        if (labelLen > 0) this.pos += labelLen
      }
    }
    if (!matched || dest === null) {
      this.popBracket()
      this.pos = startpos
      this.buf += ']'
      return
    }
    this.flush()
    const link = node(opener.image ? 'image' : 'link', '', opener.at)
    link.href = dest
    link.title = title
    let tmp = opener.node.next
    while (tmp) {
      const nx = tmp.next
      unlink(tmp)
      append(link, tmp)
      tmp = nx
    }
    append(this.root, link)
    this.processEmphasis(opener.prevDelim)
    unlink(opener.node)
    this.popBracket()
    // Não há link dentro de link: os abridores de link abaixo deste se desativam.
    if (!opener.image) this.linkFloor = this.brackets.length
  }

  lessThan(): void {
    const s = this.s
    const pos = this.pos
    URI_AUTOLINK.lastIndex = pos
    let m = URI_AUTOLINK.exec(s)
    if (m) return this.autolink(m[1], m[1], pos + m[0].length)
    EMAIL_AUTOLINK.lastIndex = pos
    m = EMAIL_AUTOLINK.exec(s)
    if (m) return this.autolink(`mailto:${m[1]}`, m[1], pos + m[0].length)
    if (s.startsWith('<!--', pos)) {
      const end = this.commentAt(pos)
      if (end > 0) {
        const raw = s.slice(pos, end)
        if (MARKER_START.test(raw)) this.opts.fail?.('marker', 'O marcador de bloco precisa ficar sozinho na linha', pos)
        else if (raw.replace(/^<!--|-->$/g, '').trim() !== '') this.opts.warn?.('htmlDropped', pos)
        this.pos = end
        return
      }
    }
    OPEN_TAG.lastIndex = pos
    m = OPEN_TAG.exec(s)
    if (!m) {
      CLOSE_TAG.lastIndex = pos
      m = CLOSE_TAG.exec(s)
    }
    if (m) {
      if (BR_TAG.test(m[0])) {
        this.flush()
        append(this.root, node('br'))
      } else {
        this.opts.warn?.('htmlDropped', pos)
      }
      this.pos = pos + m[0].length
      return
    }
    this.buf += '<'
    this.pos++
  }

  /** Fim do comentário que começa em `pos`, ou -1. O fim do próximo `-->` fica memorizado. */
  commentAt(pos: number): number {
    const s = this.s
    if (s.startsWith('>', pos + 4)) return pos + 5
    if (s.startsWith('->', pos + 4)) return pos + 6
    if (this.commentEnd === -1) return -1
    if (this.commentEnd === -2 || this.commentFrom > pos + 4 || this.commentEnd < pos + 4) {
      const at = s.indexOf('-->', pos + 4)
      this.commentFrom = pos + 4
      this.commentEnd = at
      if (at === -1) return -1
    }
    return this.commentEnd + 3
  }

  autolink(href: string, text: string, end: number): void {
    this.flush()
    const link = node('link')
    link.href = href
    append(link, node('text', text))
    append(this.root, link)
    this.pos = end
  }

  autolinkLiteral(): boolean {
    const t = this.triggers[this.trig]
    const found = t.text.endsWith('@') ? emailAutolink(this.s, t.at, t.text) : this.literal.at(t.at, t.text)
    this.trig++
    if (!found) return false
    this.autolink(found.href, found.text, found.end)
    return true
  }

  ampersand(): void {
    const ent = entityAt(this.s, this.pos)
    if (ent) {
      this.buf += ent.text
      this.pos = ent.end
    } else {
      this.buf += '&'
      this.pos++
    }
  }
}

/** Texto simples de um nó (o alt da imagem). */
function plainText(n: INode): string {
  let out = ''
  const stack: INode[] = []
  for (let c = n.last; c; c = c.prev) stack.push(c)
  while (stack.length > 0) {
    const c = stack.pop() as INode
    if (c.t === 'text' || c.t === 'code') out += c.v
    else if (c.t === 'br') out += ' '
    else for (let k = c.last; k; k = k.prev) stack.push(k)
  }
  return out
}

/**
 * Converte a árvore em trechos. Percurso com pilha explícita: a ênfase
 * aninhada de uma entrada adversária pode ter dezenas de milhares de níveis.
 */
function flatten(root: INode, opts: InlineOptions): InlinePiece[] {
  const out: InlinePiece[] = []
  const allow = opts.allowHref ?? (() => true)
  const stack: { n: INode; styles: number; href: string | null }[] = []
  for (let c = root.last; c; c = c.prev) stack.push({ n: c, styles: 0, href: null })
  while (stack.length > 0) {
    const { n, styles, href } = stack.pop() as (typeof stack)[number]
    switch (n.t) {
      case 'text':
        if (n.v) out.push({ kind: 'text', text: n.v, styles, href })
        break
      case 'code':
        if (n.v) out.push({ kind: 'text', text: n.v, styles: styles | CODE, href })
        break
      case 'br':
        out.push({ kind: 'text', text: '\n', styles: 0, href: null })
        break
      case 'image':
        out.push({ kind: 'image', src: n.href, alt: plainText(n), title: n.title, offset: n.at })
        break
      default: {
        let childHref = href
        let childStyles = styles
        if (n.t === 'link') {
          // Link dentro de link (autolink no texto de um link) fica só texto.
          if (href === null) {
            if (n.href === '') childHref = null
            else if (allow(n.href)) childHref = n.href
            else {
              childHref = null
              opts.warn?.('unsafeLink', n.at)
            }
          }
        } else {
          childStyles |= n.t === 'strong' ? BOLD : n.t === 'em' ? ITALIC : STRIKE
        }
        for (let c = n.last; c; c = c.prev) stack.push({ n: c, styles: childStyles, href: childHref })
      }
    }
  }
  return out
}

/** Conteúdo em linha de um bloco folha (linhas unidas por \n, sem os espaços das bordas). */
export function parseInline(subject: string, opts: InlineOptions = {}): InlinePiece[] {
  const parser = new InlineParser(subject, opts)
  return flatten(parser.parse(), opts)
}

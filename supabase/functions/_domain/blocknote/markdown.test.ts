import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_LIMITS, markdownToNote, splitRow, toMarkdownSchemaIssues, type MarkdownOptions, type MarkdownResult } from './markdown.ts'
import { BOLD, CODE, ITALIC, STRIKE, charClass, entityAt, linkDestination, parseInline, unescapeString } from './markdownInline.ts'
import { normalizeNoteContent, type NoteBlock } from './normalize.ts'
import { diffKeys, reconcile } from './reconcile.ts'
import { MARKDOWN_LOSSES, MARKER_TYPES, RENDER_BUDGET, blocksToMarkdown, blocksToText, linkDest, markerLine, parseMarkerLine, withUniqueIds, type LossKind, type RenderOptions } from './render.ts'
import { noteLimitIssues, noteTableCost, validateNoteContent } from './schema.ts'
import { BLOCK_SPECS, HARD_MAX_DEPTH, MAX_INLINE_NODES, TABLE_LIMITS } from './spec.ts'
import { GEN_PAGE, GEN_USER, markdownGenerator, mulberry32, noteGenerator } from './fixtures/markdown/generator.ts'
import { stripClosingHashes, trimEndSpaceTab, trimSpaceTab } from './spaceTab.ts'

// API-023: Markdown ↔ blocos sem DOM. A prova com o BlockNote de verdade (o
// editor abre o que sai daqui, e a colagem do app lê igual) fica em
// src/components/noteMarkdown.test.ts; aqui, o subconjunto bloco a bloco,
// imagens, marcadores, limites com a linha, reconciliação, render, as
// propriedades com semente fixa e a bateria patológica no limite de entrada.

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

type Block = Record<string, unknown>

function fixtures<T>(dir: string): [string, T][] {
  const path = join(FIXTURES, dir)
  return readdirSync(path).filter(f => f.endsWith('.json')).sort().map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(path, f), 'utf8')) as T])
}

const VALID = fixtures<Block[]>('valid')
const PARTIAL = fixtures<Block[]>('partial')
const FATAL = fixtures<{ content: unknown }>('fatal')
const MD = (name: string) => readFileSync(join(FIXTURES, 'markdown', `${name}.md`), 'utf8')
const CORPUS = readdirSync(join(FIXTURES, 'markdown', 'corpus')).filter(f => f.endsWith('.md')).sort()
  .map(f => [f.replace(/\.md$/, ''), readFileSync(join(FIXTURES, 'markdown', 'corpus', f), 'utf8')] as [string, string])
const EXEMPLO = JSON.parse(readFileSync(join(FIXTURES, 'markdown', 'exemplo.json'), 'utf8')) as Block[]
const NOTE_MARKDOWN = JSON.parse(readFileSync(join(FIXTURES, 'valid', 'note-markdown.json'), 'utf8')) as Block[]

const IMAGES = { userId: GEN_USER, pageId: GEN_PAGE }
const IMG = `${GEN_USER}/${GEN_PAGE}/1760000000000.webp`

const counter = (prefix = 'n') => {
  let n = 0
  return () => `${prefix}-${++n}`
}
const parse = (md: string, opts: MarkdownOptions = {}): MarkdownResult => markdownToNote(md, { newId: counter(), images: IMAGES, ...opts })
function ok(md: string, opts: MarkdownOptions = {}) {
  const r = parse(md, opts)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}
function issues(md: string, opts: MarkdownOptions = {}) {
  const r = parse(md, opts)
  if (r.ok) throw new Error(`esperava recusa: ${JSON.stringify(r.blocks)}`)
  return r.issues.map(({ line, keyword }) => ({ line, keyword }))
}
const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (k, v) => (k === 'id' ? undefined : v)))

/** Forma curta: tipo, props fora do padrão, conteúdo e filhos. */
function compact(blocks: unknown): unknown {
  const inline = (content: unknown): unknown => {
    if (!Array.isArray(content)) return content
    const items = (content as Block[]).map(i => {
      if (i.type === 'link') return { href: i.href, c: inline(i.content) }
      const styles = Object.keys(i.styles as object).sort().join('+')
      return styles ? { t: i.text, s: styles } : i.text
    })
    return items.length === 1 && typeof items[0] === 'string' ? items[0] : items
  }
  return (blocks as Block[]).map(b => {
    const spec = (BLOCK_SPECS as Record<string, { propSchema: Record<string, { default?: unknown }> }>)[String(b.type)]
    const props = Object.fromEntries(Object.entries((b.props ?? {}) as Block).filter(([k, v]) => spec?.propSchema[k]?.default !== v))
    const out: Block = { t: b.type }
    if (Object.keys(props).length > 0) out.p = props
    if (b.content !== undefined && b.type !== 'table') out.c = inline(b.content)
    if (b.type === 'table') {
      const table = b.content as { rows: { cells: { content: unknown; props: { textAlignment: string } }[] }[] }
      out.c = table.rows.map(r => r.cells.map(c => (c.props.textAlignment === 'left' ? inline(c.content) : [c.props.textAlignment, inline(c.content)])))
    }
    if (Array.isArray(b.children) && b.children.length > 0) out.ch = compact(b.children)
    return out
  })
}
const read = (md: string, opts?: MarkdownOptions) => compact(ok(md, opts).blocks)
const warnings = (md: string, opts?: MarkdownOptions) => parse(md, opts).warnings.map(({ line, code }) => ({ line, code }))
const render = (blocks: unknown[]) => {
  const norm = normalizeNoteContent(blocks, { newId: counter('r') })
  if (!norm.ok) throw new Error(JSON.stringify(norm.issues))
  return blocksToMarkdown(norm.blocks)
}
const T = (text: string, styles: Record<string, boolean | string> = {}) => ({ type: 'text', text, styles })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })

describe('exemplos: o Markdown e os blocos, nos dois sentidos', () => {
  it('note-markdown.md é o render de valid/note-markdown.json, byte a byte e sem perdas', () => {
    const r = blocksToMarkdown(NOTE_MARKDOWN)
    expect(r.markdown).toBe(MD('note-markdown'))
    expect(r.losses).toEqual([])
  })

  it('note-markdown.md volta aos mesmos blocos (forma completa); com a nota atual, aos mesmos ids', () => {
    const r = ok(MD('note-markdown'))
    expect(strip(r.blocks)).toEqual(strip(NOTE_MARKDOWN))
    expect(validateNoteContent(r.blocks, { form: 'full' }).issues).toEqual([])
    expect(r.warnings).toEqual([])
    expect(ok(MD('note-markdown'), { existing: NOTE_MARKDOWN }).blocks).toEqual(NOTE_MARKDOWN)
  })

  it('exemplo.md (títulos 1 a 6, estilos, listas, tabela, código, imagem e marcadores) é o render de exemplo.json', () => {
    const r = blocksToMarkdown(EXEMPLO)
    expect(r.markdown).toBe(MD('exemplo'))
    expect(r.losses).toEqual([])
    expect(MD('exemplo')).toContain('<!-- akool:bloco id="ex-24" tipo="diagram" -->')
  })

  it('exemplo.md volta a exemplo.json: com a nota inteira, igual com os ids; só com os marcadores, igual fora os ids', () => {
    const images = { userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', pageId: '9b2f1c3a-5d4e-4f60-8a7b-1c2d3e4f5a6b' }
    const whole = ok(MD('exemplo'), { existing: EXEMPLO, images })
    expect(whole.blocks).toEqual(EXEMPLO)
    expect(whole.newImagePaths).toEqual([])
    const markersOnly = EXEMPLO.filter(b => MARKER_TYPES.includes(String(b.type)))
    const r = ok(MD('exemplo'), { existing: markersOnly, images })
    expect(strip(r.blocks)).toEqual(strip(EXEMPLO))
    for (const id of ['ex-24', 'ex-25', 'ex-26']) expect(r.blocks.some(b => b.id === id)).toBe(true)
    expect(r.newImagePaths).toEqual([`${images.userId}/${images.pageId}/1760000000000.webp`])
    expect(validateNoteContent(r.blocks, { form: 'full' }).issues).toEqual([])
  })

  it('o mapa de linhas: cada bloco com o trecho que ocupa (os filhos dentro do pai)', () => {
    const { blocks } = blocksToMarkdown(EXEMPLO)
    const at = (path: string) => blocks.find(b => b.path === path)
    expect(at('/0')).toEqual({ id: 'ex-01', path: '/0', startLine: 1, endLine: 1 })
    expect(at('/4')).toMatchObject({ startLine: 10, endLine: 13 })
    expect(at('/4/children/0/children/1')).toMatchObject({ startLine: 13, endLine: 13 })
    const lines = MD('exemplo').split('\n')
    for (const b of blocks) expect(lines[b.startLine - 1], b.path).not.toBe('')
  })
})

describe('subconjunto: blocos', () => {
  it('títulos ATX de 1 a 6, com a sequência de fechamento; 7 # é parágrafo; vazio vale', () => {
    expect(read('# a\n## b ##\n### c #   \n#### d \\#\n##### e#\n###### f\n####### g\n#')).toEqual([
      { t: 'heading', c: 'a' }, { t: 'heading', p: { level: 2 }, c: 'b' }, { t: 'heading', p: { level: 3 }, c: 'c' },
      { t: 'heading', p: { level: 4 }, c: 'd #' }, { t: 'heading', p: { level: 5 }, c: 'e#' }, { t: 'heading', p: { level: 6 }, c: 'f' },
      { t: 'paragraph', c: '####### g' }, { t: 'heading', c: [] },
    ])
  })

  it('títulos setext; só definições de referência antes da linha não fazem título', () => {
    expect(read('Um\n==\n\nDois\nlinhas\n---')).toEqual([{ t: 'heading', c: 'Um' }, { t: 'heading', p: { level: 2 }, c: 'Dois linhas' }])
    expect(read('[r]: /u\n---')).toEqual([{ t: 'divider' }])
  })

  it('parágrafo: quebra suave vira espaço (com um aviso só); quebra dura com 2 espaços, barra ou <br>', () => {
    expect(read('a\nb\nc')).toEqual([{ t: 'paragraph', c: 'a b c' }])
    expect(warnings('a\nb\nc')).toEqual([{ line: 1, code: 'softBreak' }])
    expect(read('a  \nb\\\nc<br>d<br/>e<BR />f   ')).toEqual([{ t: 'paragraph', c: 'a\nb\nc\nd\ne\nf' }])
    expect(read('fim\\')).toEqual([{ t: 'paragraph', c: 'fim\\' }])
    expect(read('   recuo')).toEqual([{ t: 'paragraph', c: 'recuo' }])
  })

  it('listas: marcadores, aninhamento, item vazio, frouxa igual à justa', () => {
    expect(read('- a\n+ b\n* c')).toEqual([{ t: 'bulletListItem', c: 'a' }, { t: 'bulletListItem', c: 'b' }, { t: 'bulletListItem', c: 'c' }])
    expect(read('- a\n  - b\n    1. c\n-\n- d')).toEqual([
      { t: 'bulletListItem', c: 'a', ch: [{ t: 'bulletListItem', c: 'b', ch: [{ t: 'numberedListItem', c: 'c' }] }] },
      { t: 'bulletListItem', c: [] }, { t: 'bulletListItem', c: 'd' },
    ])
    expect(read('- a\n\n- b')).toEqual(read('- a\n- b'))
    expect(read('- a\n\n  segundo parágrafo\n\n  ```\n  x\n  ```')).toEqual([
      { t: 'bulletListItem', c: 'a', ch: [{ t: 'paragraph', c: 'segundo parágrafo' }, { t: 'codeBlock', c: 'x' }] },
    ])
    expect(read('-\n  foo')).toEqual([{ t: 'bulletListItem', c: 'foo' }])
    expect(read('- <!-- -->\n\n  p')).toEqual([{ t: 'bulletListItem', c: [], ch: [{ t: 'paragraph', c: 'p' }] }])
    expect(read('- # título')).toEqual([{ t: 'bulletListItem', c: [], ch: [{ t: 'heading', c: 'título' }] }])
    expect(read('-\ttab')).toEqual([{ t: 'bulletListItem', c: 'tab' }])
  })

  it('numeradas: start quando o 1º número não é 1 ou quando a lista vem logo depois de outra numerada', () => {
    expect(read('3. a\n4. b')).toEqual([{ t: 'numberedListItem', p: { start: 3 }, c: 'a' }, { t: 'numberedListItem', c: 'b' }])
    expect(read('0. a')).toEqual([{ t: 'numberedListItem', p: { start: 0 }, c: 'a' }])
    expect(read('1. a\n\n<!-- -->\n\n1. b')).toEqual([{ t: 'numberedListItem', c: 'a' }, { t: 'numberedListItem', p: { start: 1 }, c: 'b' }])
    expect(read('1. a\n1) b')).toEqual([{ t: 'numberedListItem', c: 'a' }, { t: 'numberedListItem', p: { start: 1 }, c: 'b' }])
    expect(read('1. a\n\nparágrafo\n\n1. b')).toEqual([{ t: 'numberedListItem', c: 'a' }, { t: 'paragraph', c: 'parágrafo' }, { t: 'numberedListItem', c: 'b' }])
    // Checklist no meio da numerada: o item seguinte recomeça a contagem no editor, então leva o número.
    expect(read('1. a\n2. [ ] b\n3. c')).toEqual([{ t: 'numberedListItem', c: 'a' }, { t: 'checkListItem', c: 'b' }, { t: 'numberedListItem', p: { start: 3 }, c: 'c' }])
    // Lista que começa em 2 não interrompe parágrafo (CommonMark): fica texto.
    expect(read('texto\n2. não é item')).toEqual([{ t: 'paragraph', c: 'texto 2. não é item' }])
  })

  it('checklist: [ ], [x] e [X], inclusive numerada e vazia', () => {
    expect(read('- [ ] a\n- [x] b\n- [X] c\n1. [ ] d\n- [ ]\n- [ ]x')).toEqual([
      { t: 'checkListItem', c: 'a' }, { t: 'checkListItem', p: { checked: true }, c: 'b' }, { t: 'checkListItem', p: { checked: true }, c: 'c' },
      { t: 'checkListItem', c: 'd' }, { t: 'checkListItem', c: [] }, { t: 'bulletListItem', c: '[ ]x' },
    ])
  })

  it('citação: continuação preguiçosa, vários parágrafos com quebra, achatada com aviso', () => {
    expect(read('> a\ncontinua\n>\n> b')).toEqual([{ t: 'quote', c: 'a continua\nb' }])
    expect(warnings('> a\n>\n> b').filter(w => w.code === 'quoteFlattened')).toEqual([])
    expect(read('> - x\n> - y\n>\n> ```\n> código\n> ```\n> # t\n> > aninhada\n> ---\n> | a |\n> |---|\n> | 1 |')).toEqual([
      { t: 'quote', c: 'x\ny\ncódigo\nt\naninhada\na\n1' },
    ])
    expect(warnings('> - x')).toEqual([{ line: 1, code: 'quoteFlattened' }])
    expect(read('>')).toEqual([{ t: 'quote', c: [] }])
    expect(warnings('> <!-- nota -->\n> a')).toEqual([{ line: 1, code: 'htmlDropped' }])
  })

  it('código cercado (``` e ~~~), com a 1ª palavra da info; indentado; sem fechar vai até o fim', () => {
    expect(read('```ts extra\nconst a = 1\n```')).toEqual([{ t: 'codeBlock', p: { language: 'ts' }, c: 'const a = 1' }])
    expect(read('~~~~ py\n~~~\n```\n~~~~~')).toEqual([{ t: 'codeBlock', p: { language: 'py' }, c: '~~~\n```' }])
    expect(read('```c\\+\\+\n```')).toEqual([{ t: 'codeBlock', p: { language: 'c++' }, c: [] }])
    expect(read('```\n\ta\tb\n  c\n\n```')).toEqual([{ t: 'codeBlock', c: '\ta\tb\n  c\n' }])
    expect(read('    um\n\n    dois\n\n\n')).toEqual([{ t: 'codeBlock', c: 'um\n\ndois' }])
    expect(read('```\nnunca fecha\n\n# não é título')).toEqual([{ t: 'codeBlock', c: 'nunca fecha\n\n# não é título' }])
    // Info com crase não abre cerca de crases: a linha é parágrafo, e a de baixo abre uma cerca vazia.
    expect(read('``` a`b\n```')).toEqual([{ t: 'paragraph', c: '``` a`b' }, { t: 'codeBlock', c: [] }])
    expect(read(' ```\n x\n  y\n ```')).toEqual([{ t: 'codeBlock', c: 'x\n y' }])
  })

  it('tabela GFM: cabeçalho, alinhamento, \\| (inclusive no código), <br>, células a mais e a menos', () => {
    expect(read('| a | b | c |\n|:-|:-:|-:|\n| `x \\| y` | 1<br>2 |\n| 1 | 2 | 3 | 4 |')).toEqual([{
      t: 'table',
      c: [
        ['a', ['center', 'b'], ['right', 'c']],
        [[{ t: 'x | y', s: 'code' }], ['center', '1\n2'], ['right', []]],
        ['1', ['center', '2'], ['right', '3']],
      ],
    }])
    expect(read('a | b\n--|--\n1 | 2')).toEqual([{ t: 'table', c: [['a', 'b'], ['1', '2']] }])
    expect(read('texto\n| a |\n|---|\n| 1 |\n\ndepois')).toEqual([{ t: 'paragraph', c: 'texto' }, { t: 'table', c: [['a'], ['1']] }, { t: 'paragraph', c: 'depois' }])
    expect(read('| a |\n|---|\n| 1 |\n# fim')).toEqual([{ t: 'table', c: [['a'], ['1']] }, { t: 'heading', c: 'fim' }])
    expect(read('| a | b |\n|---|')).toEqual([{ t: 'paragraph', c: '| a | b | |---|' }])
    expect(read('a\n:-:')).toEqual([{ t: 'paragraph', c: 'a :-:' }])
    expect(splitRow('| a \\| b | c\\\\| d |')).toEqual(['a | b', 'c\\\\', 'd'])
    expect(splitRow('a | b \\|')).toEqual(['a', 'b |'])
  })

  it('tabela: imagem na célula vira o texto alternativo, com aviso', () => {
    expect(read(`| a |\n|---|\n| ![alt](${IMG}) |\n| ![](${IMG}) |`)).toEqual([{ t: 'table', c: [['a'], ['alt'], [[]]] }])
    expect(warnings(`| a |\n|---|\n| ![alt](${IMG}) |`)).toEqual([{ line: 3, code: 'imageInCell' }])
  })

  it('divisor: ***, ---, ___ e com espaços', () => {
    expect(read('***\n\n---\n\n___\n\n - - -')).toEqual([{ t: 'divider' }, { t: 'divider' }, { t: 'divider' }, { t: 'divider' }])
  })

  it('comentário HTML some (com aviso, se não for vazio); HTML em linha some e o texto fica', () => {
    expect(read('<!-- nota -->\n\ntexto')).toEqual([{ t: 'paragraph', c: 'texto' }])
    expect(warnings('<!-- nota -->\n\ntexto')).toEqual([{ line: 1, code: 'htmlDropped' }])
    expect(read('<!--\nvárias\nlinhas -->\ntexto')).toEqual([{ t: 'paragraph', c: 'texto' }])
    expect(read('texto\n<!-- -->')).toEqual([{ t: 'paragraph', c: 'texto' }])
    expect(read('a <span style="x">b</span> </p> c')).toEqual([{ t: 'paragraph', c: 'a b  c' }])
    expect(warnings('a <span>b</span>')).toEqual([{ line: 1, code: 'htmlDropped' }])
    expect(read('a <!-- x --> b <!--> c <!---> d')).toEqual([{ t: 'paragraph', c: 'a  b  c  d' }])
    expect(read('a < b <3 <a <!-- sem fim')).toEqual([{ t: 'paragraph', c: 'a < b <3 <a <!-- sem fim' }])
  })

  it('entrada: CRLF e CR, BOM, \\u0000 e surrogate solto viram U+FFFD', () => {
    expect(read('\ufeffa\r\nb\r\rc')).toEqual([{ t: 'paragraph', c: 'a b' }, { t: 'paragraph', c: 'c' }])
    expect(read('a\u0000b\ud800c\udc00')).toEqual([{ t: 'paragraph', c: 'a\ufffdb\ufffdc\ufffd' }])
    expect(read('😀')).toEqual([{ t: 'paragraph', c: '😀' }])
  })
})

describe('subconjunto: em linha', () => {
  it('negrito, itálico, tachado e código; aninhados; flanqueamento do CommonMark', () => {
    expect(read('**n** __n2__ *i* _i2_ ~~t~~ ~t~ `c` ***bi*** ~~~x~~~')).toEqual([{
      t: 'paragraph',
      c: [{ t: 'n', s: 'bold' }, ' ', { t: 'n2', s: 'bold' }, ' ', { t: 'i', s: 'italic' }, ' ', { t: 'i2', s: 'italic' }, ' ', { t: 't', s: 'strike' }, ' ', { t: 't', s: 'strike' }, ' ', { t: 'c', s: 'code' }, ' ', { t: 'bi', s: 'bold+italic' }, ' ~~~x~~~'],
    }])
    expect(read('**a _b_ c**')).toEqual([{ t: 'paragraph', c: [{ t: 'a ', s: 'bold' }, { t: 'b', s: 'bold+italic' }, { t: ' c', s: 'bold' }] }])
    expect(read('snake_case_name a*b*c __x__y')).toEqual([{ t: 'paragraph', c: ['snake_case_name a', { t: 'b', s: 'italic' }, 'c __x__y'] }])
    expect(read('**a.**b e **a.**&#98;')).toEqual([{ t: 'paragraph', c: ['**a.**b e ', { t: 'a.', s: 'bold' }, 'b'] }])
    expect(read('x * a * e ** b **')).toEqual([{ t: 'paragraph', c: 'x * a * e ** b **' }])
    expect(read('*a **b** c*')).toEqual([{ t: 'paragraph', c: [{ t: 'a ', s: 'italic' }, { t: 'b', s: 'bold+italic' }, { t: ' c', s: 'italic' }] }])
    // O emoji conta como letra (unidade UTF-16, como no micromark): `**` entre ele e `"` não abre.
    expect(read('😀**"a"**')).toEqual([{ t: 'paragraph', c: '😀**"a"**' }])
  })

  it('código em linha: qualquer número de crases, um espaço de cada lado sai, quebra vira espaço', () => {
    expect(read('`` a ` b `` ` c ` `  d  ` ` ` `a\nb` ```x')).toEqual([{
      t: 'paragraph',
      c: [{ t: 'a ` b', s: 'code' }, ' ', { t: 'c', s: 'code' }, ' ', { t: ' d ', s: 'code' }, ' ', { t: ' ', s: 'code' }, ' ', { t: 'a b', s: 'code' }, ' ```x'],
    }])
    expect(read('\\``a`')).toEqual([{ t: 'paragraph', c: ['`', { t: 'a', s: 'code' }] }])
    expect(read('`a`` b')).toEqual([{ t: 'paragraph', c: '`a`` b' }])
  })

  it('links: inline, <destino>, título, parênteses equilibrados, referências e o teto de 32 parênteses', () => {
    expect(read('[a](https://e.com "t") [b](<https://e.com/x y>) [c](/a_(b)) [d](\\(x\\))')).toEqual([{
      t: 'paragraph',
      c: [{ href: 'https://e.com', c: 'a' }, ' ', { href: 'https://e.com/x y', c: 'b' }, ' ', { href: '/a_(b)', c: 'c' }, ' ', { href: '(x)', c: 'd' }],
    }])
    const deep = `[x](${'('.repeat(33)}${')'.repeat(33)})`
    expect(read(deep)).toEqual([{ t: 'paragraph', c: deep }])
    expect(read(`[x](${'('.repeat(32)}${')'.repeat(32)})`)).toEqual([{ t: 'paragraph', c: [{ href: `${'('.repeat(32)}${')'.repeat(32)}`, c: 'x' }] }])
    expect(read('[x][R] [y][] [z] [w][nada]\n\n[r]: https://e.com "t"\n[Y]: /y\n[z]:\n  /z\n  \'tz\'\n[r]: /segunda')).toEqual([{
      t: 'paragraph',
      c: [{ href: 'https://e.com', c: 'x' }, ' ', { href: '/y', c: 'y' }, ' ', { href: '/z', c: 'z' }, ' [w][nada]'],
    }])
    expect(read(`[a]\n\n[${'b'.repeat(1000)}]: /u`)).toEqual([{ t: 'paragraph', c: '[a]' }, { t: 'paragraph', c: `[${'b'.repeat(1000)}]: /u` }])
    // Definição com lixo depois do título não vale (e as linhas seguintes do parágrafo também não são definição).
    expect(read('[a]: /u "título" lixo\n[b]: /b\n\n[c]: <> \n\n[a] [b] [c]')).toEqual([{ t: 'paragraph', c: '[a]: /u "título" lixo [b]: /b' }, { t: 'paragraph', c: '[a] [b] c' }])
  })

  it('nota de rodapé fica texto, com aviso', () => {
    expect(read('a[^1]\n\n[^1]: nota')).toEqual([{ t: 'paragraph', c: 'a[^1]' }, { t: 'paragraph', c: '[^1]: nota' }])
    expect(warnings('a[^1]\n\n[^1]: nota')).toEqual([{ line: 3, code: 'footnote' }])
  })

  it('link inseguro ou sem destino fica só texto (o inseguro com aviso); link dentro de link é texto', () => {
    expect(read('[x](javascript:alert(1)) [y]() <javascript:z> [z](mailto:a@b.com)')).toEqual([{
      t: 'paragraph', c: ['x y javascript:z ', { href: 'mailto:a@b.com', c: 'z' }],
    }])
    expect(warnings('[x](javascript:alert(1))')).toEqual([{ line: 1, code: 'unsafeLink' }])
    expect(read('[a [b](/b) c](/a) [https://x.com](/u)')).toEqual([{ t: 'paragraph', c: ['[a ', { href: '/b', c: 'b' }, ' c](/a) ', { href: '/u', c: 'https://x.com' }] }])
  })

  it('autolinks: <uri>, <e-mail> e os literais do GFM (com a pontuação final fora); o escape bloqueia o literal', () => {
    expect(read('<https://a.b/c> <a@b.com> https://x.com/a). (www.y.com) e-mail: a.b@c-d.org. http://h')).toEqual([{
      t: 'paragraph',
      c: [
        { href: 'https://a.b/c', c: 'https://a.b/c' }, ' ', { href: 'mailto:a@b.com', c: 'a@b.com' }, ' ', { href: 'https://x.com/a', c: 'https://x.com/a' }, '). (',
        { href: 'http://www.y.com', c: 'www.y.com' }, ') e-mail: ', { href: 'mailto:a.b@c-d.org', c: 'a.b@c-d.org' }, '. ', { href: 'http://h', c: 'http://h' },
      ],
    }])
    expect(read('https://e.com/a_(b) https://x.com/?q=1&amp; www.a_b.com xhttp://x.com _www.y.com_ a@b a_@b.com_')).toEqual([{
      t: 'paragraph',
      c: [
        { href: 'https://e.com/a_(b)', c: 'https://e.com/a_(b)' }, ' ', { href: 'https://x.com/?q=1', c: 'https://x.com/?q=1' }, '& www.a_b.com xhttp://x.com ',
        { href: 'http://www.y.com', c: [{ t: 'www.y.com', s: 'italic' }] }, ' a@b ', { href: 'mailto:a_@b.com', c: 'a_@b.com' }, '_',
      ],
    }])
    expect(read('https\\://x.com www\\.y.com a\\@b.com')).toEqual([{ t: 'paragraph', c: 'https://x.com www.y.com a@b.com' }])
  })

  it('entidades: nomeadas comuns e acentuadas, numéricas; inválida vira U+FFFD; desconhecida fica literal', () => {
    expect(read('&amp; &lt; &copy; &ccedil; &#35; &#x41; &#0; &#x110000; &#xD800; &spades; &nbsp;fim &amp')).toEqual([{
      t: 'paragraph', c: '& < © ç # A \ufffd \ufffd \ufffd &spades; \u00a0fim &amp',
    }])
    expect(entityAt('&#65;', 0)).toEqual({ text: 'A', end: 5 })
    expect(entityAt('&zz;', 0)).toBeNull()
    expect(unescapeString('a\\*b&amp;c\\d')).toBe('a*b&c\\d')
    expect(unescapeString('sem nada')).toBe('sem nada')
  })

  it('trechos vizinhos com o mesmo estilo se juntam antes da validação: 60 KB de `[a` cabem nos 2 MiB', () => {
    const md = '[a'.repeat(30_000)
    expect(read(md)).toEqual([{ t: 'paragraph', c: md }])
  })

  it('escapes de pontuação ASCII; barra antes de letra fica', () => {
    expect(read('\\*a\\* \\_b\\_ \\# \\[c\\] \\<d\\> \\\\ \\| \\~e\\~ \\a \\!')).toEqual([{ t: 'paragraph', c: '*a* _b_ # [c] <d> \\ | ~e~ \\a !' }])
  })

  it('o destino do link: <…> sem quebra, cru até espaço; os parênteses contam até 32', () => {
    expect(linkDestination('<a b>', 0)).toEqual({ href: 'a b', end: 5 })
    expect(linkDestination('<a\nb>', 0)).toBeNull()
    expect(linkDestination('a\\)b c', 0)).toEqual({ href: 'a)b', end: 4 })
    expect(linkDestination('(a', 0)).toBeNull()
    expect(linkDestination(')', 0)).toBeNull()
  })

  it('a classe do caractere é por unidade UTF-16, como no micromark', () => {
    expect([charClass(-1), charClass(32), charClass(9), charClass(97), charClass(46), charClass(0xa0), charClass(0x2014), charClass('😀'.charCodeAt(0)), charClass('é'.charCodeAt(0))]).toEqual([1, 1, 1, 0, 2, 1, 2, 0, 0])
  })

  it('parseInline devolve os bits de estilo e a imagem com a posição', () => {
    expect(parseInline('**a** ![i](u "t")')).toEqual([
      { kind: 'text', text: 'a', styles: BOLD, href: null }, { kind: 'text', text: ' ', styles: 0, href: null },
      { kind: 'image', src: 'u', alt: 'i', title: 't', offset: 6 },
    ])
    expect(parseInline('_~~`x`~~_')).toEqual([{ kind: 'text', text: 'x', styles: ITALIC | STRIKE | CODE, href: null }])
  })
})

describe('imagens', () => {
  it('caminho da pasta da nota (uid/página/arquivo.ext) vira bloco image e entra em newImagePaths', () => {
    const r = ok(`![Diagrama](${IMG} "Legenda")\n\n![](${GEN_USER}/${GEN_PAGE}/a-b_c.1.jpeg)`)
    expect(compact(r.blocks)).toEqual([
      { t: 'image', p: { name: 'Diagrama', url: IMG, caption: 'Legenda' } },
      { t: 'image', p: { url: `${GEN_USER}/${GEN_PAGE}/a-b_c.1.jpeg` } },
    ])
    expect(r.newImagePaths).toEqual([IMG, `${GEN_USER}/${GEN_PAGE}/a-b_c.1.jpeg`])
  })

  it('outra pasta, outra extensão, externa, data: ou sem regras: recusa com a linha', () => {
    const other = '33333333-3333-4333-8333-333333333333'
    expect(issues(`a\n\n![x](${other}/${GEN_PAGE}/1.png)\n\n![y](${GEN_USER}/${other}/1.png)\n\n![z](${GEN_USER}/${GEN_PAGE}/1.svg)`)).toEqual([
      { line: 3, keyword: 'imagePath' }, { line: 5, keyword: 'imagePath' }, { line: 7, keyword: 'imagePath' },
    ])
    const messages = (md: string, opts?: MarkdownOptions) => (parse(md, opts) as { issues: { message: string }[] }).issues[0].message
    expect(messages('![x](https://e.com/a.png)')).toMatch(/externa/)
    expect(messages('![x](//e.com/a.png)')).toMatch(/externa/)
    expect(messages('![x](data:image/png;base64,AAAA)')).toMatch(/data:/)
    expect(messages(`![x](${IMG})`, { images: undefined })).toMatch(/sem a pasta/)
    expect(messages('![x](a/b.png)')).toMatch(new RegExp(`${GEN_USER}/${GEN_PAGE}/arquivo`))
  })

  it('url que já está na nota: herda id e props (largura, prévia, alinhamento); nome e legenda vêm do Markdown', () => {
    const existing = [{ id: 'img-1', type: 'image', props: { textAlignment: 'center', backgroundColor: 'default', name: 'velho', url: 'https://e.com/externa.png', caption: '', showPreview: false, previewWidth: 320 }, children: [] }]
    const r = ok('texto\n\n![novo](https://e.com/externa.png "leg")', { existing, images: undefined })
    expect(r.blocks[1]).toEqual({ ...existing[0], props: { ...existing[0].props, name: 'novo', caption: 'leg' } })
    expect(r.newImagePaths).toEqual([])
    expect(r.losses).toEqual([])
  })

  it('imagem repetida: a 1ª ocorrência herda o id, a 2ª ganha id novo; ao anexar, sempre id novo', () => {
    const existing = [{ id: 'img-1', type: 'image', props: { url: IMG, name: 'a' }, children: [] }]
    const r = ok(`![a](${IMG})\n\n![b](${IMG})`, { existing })
    expect(r.blocks.map(b => b.id)).toEqual(['img-1', 'n-1'])
    const appended = ok(`![c](${IMG})`, { existing, mode: 'append' })
    expect(appended.blocks.map(b => b.id)).toEqual(['n-1'])
    expect(appended.blocks[0].props).toMatchObject({ url: IMG, name: 'c' })
  })

  it('imagem no meio do texto divide o parágrafo (com aviso); no item vira filho; no título vem depois; no link, ganha a imagem', () => {
    expect(read(`antes ![a](${IMG}) depois`)).toEqual([{ t: 'paragraph', c: 'antes' }, { t: 'image', p: { name: 'a', url: IMG } }, { t: 'paragraph', c: 'depois' }])
    expect(warnings(`antes ![a](${IMG}) depois`)).toEqual([{ line: 1, code: 'imageSplit' }])
    expect(warnings(`![a](${IMG})\n![b](${IMG})`)).toEqual([{ line: 1, code: 'softBreak' }])
    expect(read(`- texto ![a](${IMG})`)).toEqual([{ t: 'bulletListItem', c: 'texto', ch: [{ t: 'image', p: { name: 'a', url: IMG } }] }])
    expect(read(`# Título ![a](${IMG})`)).toEqual([{ t: 'heading', c: 'Título' }, { t: 'image', p: { name: 'a', url: IMG } }])
    expect(read(`> citação ![a](${IMG})`)).toEqual([{ t: 'quote', c: 'citação' }, { t: 'image', p: { name: 'a', url: IMG } }])
    expect(read(`[![alt *x*](${IMG})](https://e.com)`)).toEqual([{ t: 'image', p: { name: 'alt x', url: IMG } }])
  })
})

describe('marcadores (blocos sem Markdown)', () => {
  const SNAP = JSON.stringify({ title: 'Card', description: '', priority: 'medium', startDate: null, dueDate: null, labels: [], checklist: [], completed: false, columnName: null, boardName: 'Q', boardIcon: '📋', boardColor: '#6366f1' })
  const existing = [
    { id: 'dg', type: 'diagram', props: { elements: '[]', appState: '{}', collapsed: 'false' }, children: [{ id: 'filho', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: [T('filho do diagrama')], children: [] }] },
    { id: 'cd', type: 'projectCard', props: { cardId: '', boardId: '', snapshot: SNAP }, children: [] },
    { id: 'fl', type: 'file', props: { backgroundColor: 'default', name: 'a.pdf', url: 'x/a.pdf', caption: '' }, children: [] },
    { id: 'vd', type: 'video', props: { textAlignment: 'left', backgroundColor: 'default', name: 'v', url: 'x/v.mp4', caption: '', showPreview: true }, children: [] },
    { id: 'au', type: 'audio', props: { backgroundColor: 'default', name: '', url: 'x/a.mp3', caption: '', showPreview: true }, children: [] },
    { id: 'pg', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: [T('texto')], children: [] },
  ]

  it('o render escreve um marcador por bloco; a leitura restaura o bloco com children: [] (os filhos vêm do Markdown)', () => {
    const r = blocksToMarkdown(existing)
    expect(r.markdown).toBe([
      '<!-- akool:bloco id="dg" tipo="diagram" -->', '', 'filho do diagrama', '', '<!-- akool:bloco id="cd" tipo="projectCard" -->', '',
      '<!-- akool:bloco id="fl" tipo="file" nome="a.pdf" -->', '', '<!-- akool:bloco id="vd" tipo="video" nome="v" -->', '',
      '<!-- akool:bloco id="au" tipo="audio" -->', '', 'texto', '',
    ].join('\n'))
    expect(r.losses).toEqual([{ path: '/0/children/0', kind: 'nestedUnderNonList' }])
    // Igual: tudo volta intacto (o diagrama com o filho).
    expect(ok(r.markdown, { existing }).blocks).toEqual(existing)
    // O marcador do diagrama levado para o fim não casa na reconciliação: quem o restaura é o marcador, sem os filhos.
    const moved = r.markdown.replace('<!-- akool:bloco id="dg" tipo="diagram" -->\n\n', '') + '\n<!-- akool:bloco id="dg" tipo="diagram" -->\n'
    const back = ok(moved, { existing })
    expect(back.blocks[back.blocks.length - 1]).toEqual({ ...existing[0], children: [] })
    expect(compact(back.blocks)).toEqual([
      { t: 'paragraph', c: 'filho do diagrama' }, { t: 'projectCard', p: { snapshot: SNAP } }, { t: 'file', p: { name: 'a.pdf', url: 'x/a.pdf' } },
      { t: 'video', p: { name: 'v', url: 'x/v.mp4' } }, { t: 'audio', p: { url: 'x/a.mp3' } }, { t: 'paragraph', c: 'texto' }, { t: 'diagram' },
    ])
    // O filho aparece uma vez só (como bloco seguinte), com id novo.
    expect(back.blocks.filter(b => b.id === 'filho')).toEqual([])
    expect(back.losses).toEqual([{ path: '/0/children/0', kind: 'nestedUnderNonList' }])
  })

  it('marcador dentro de item de lista resolve (no lugar do filho)', () => {
    const r = ok('- item\n\n  <!-- akool:bloco id="cd" tipo="projectCard" -->\n- outro', { existing })
    expect(r.blocks[0].children).toEqual([existing[1]])
  })

  it('id desconhecido, repetido, de bloco com Markdown ou com o tipo errado: erro com a linha', () => {
    expect(issues('<!-- akool:bloco id="zz" tipo="diagram" -->\n\n<!-- akool:bloco id="dg" tipo="diagram" -->\n\n<!-- akool:bloco id="dg" tipo="diagram" -->\n\n<!-- akool:bloco id="pg" tipo="paragraph" -->\n\n<!-- akool:bloco id="fl" tipo="video" -->', { existing })).toEqual([
      { line: 1, keyword: 'marker' }, { line: 5, keyword: 'marker' }, { line: 7, keyword: 'marker' }, { line: 9, keyword: 'marker' },
    ])
  })

  it('marcador malformado, em várias linhas, dentro de citação ou no meio do texto: erro com a linha', () => {
    expect(issues('<!-- akool:bloco id="dg" -->\n\n<!-- akool:bloco id="%E0" tipo="diagram" -->\n\n<!-- akool:bloco\nid="dg" tipo="diagram" -->\n\n> <!-- akool:bloco id="dg" tipo="diagram" -->\n\ntexto <!-- akool:bloco id="dg" tipo="diagram" -->', { existing })).toEqual([
      { line: 1, keyword: 'marker' }, { line: 3, keyword: 'marker' }, { line: 5, keyword: 'marker' }, { line: 8, keyword: 'marker' }, { line: 10, keyword: 'marker' },
    ])
  })

  it('ao anexar, marcador é erro (o bloco já está na nota)', () => {
    expect(issues('<!-- akool:bloco id="dg" tipo="diagram" -->', { existing, mode: 'append' })).toEqual([{ line: 1, keyword: 'marker' }])
  })

  it('texto do usuário não forja marcador: o render escapa `<`; no código cercado é literal', () => {
    const fake = '<!-- akool:bloco id="dg" tipo="diagram" -->'
    const md = render([p(T(fake)), { type: 'codeBlock', content: [T(fake)] }]).markdown
    expect(md).toContain('\\<!-- akool:bloco')
    expect(compact(ok(md, { existing }).blocks)).toEqual([{ t: 'paragraph', c: fake }, { t: 'codeBlock', c: fake }])
  })

  it('nota antiga com desvio de contrato não trava a regravação (diagrama fora da lista branca, card com chave a mais, cor longa)', () => {
    const legacy = [
      { id: 'd1', type: 'diagram', props: { elements: '[{"id":"x","type":"image"}]', appState: '{"foo":1}', collapsed: 'false' }, children: [] },
      { id: 'c1', type: 'projectCard', props: { cardId: '', boardId: '', snapshot: '{"title":"T","extra":1}' }, children: [] },
      { id: 'p1', type: 'paragraph', props: { textColor: 'x'.repeat(80), backgroundColor: 'default', textAlignment: 'left' }, content: [T('colorido')], children: [] },
    ]
    expect(validateNoteContent(legacy).ok).toBe(false)
    const md = blocksToMarkdown(legacy).markdown
    expect(ok(md, { existing: legacy }).blocks).toEqual(legacy)
    const edited = ok(md.replace('colorido', 'editado'), { existing: legacy })
    expect(edited.blocks.map(b => b.id)).toEqual(['d1', 'c1', 'n-1'])
    expect(edited.losses).toEqual([{ path: '/2/props/textColor', kind: 'textColor' }])
    // Os blocos novos continuam no contrato inteiro.
    expect(issues('[x](javascript:a)\n\n![a](x)', { existing: legacy })).toEqual([{ line: 3, keyword: 'imagePath' }])
  })

  it('parseMarkerLine e markerLine: id codificado, atributos extras, valor sem `--` nem aspas', () => {
    expect(parseMarkerLine('  <!-- akool:bloco id="a%20b" tipo="file" nome="x" -->  ')).toEqual({ id: 'a b', type: 'file' })
    expect(parseMarkerLine('<!-- akool:bloco tipo="file" id="1" -->')).toEqual({ id: '1', type: 'file' })
    expect(parseMarkerLine('<!-- akool:bloco nome="x" -->')).toBeNull()
    expect(parseMarkerLine('<!-- akool:outro id="1" tipo="file" -->')).toBeNull()
    expect(markerLine('a"b', 'file', [['nome', 'x--y -> "z" & <w>\nv'], ['vazio', '']])).toBe('<!-- akool:bloco id="a%22b" tipo="file" nome="x-&#45;y -&gt; &quot;z&quot; &amp; &lt;w&gt; v" -->')
  })
})

describe('limites, com a linha', () => {
  it('mais de 512 KiB de Markdown: a linha em que o limite estoura', () => {
    expect(issues('a\n'.repeat(MARKDOWN_LIMITS.maxBytes / 2) + 'b')).toEqual([{ line: MARKDOWN_LIMITS.maxBytes / 2 + 1, keyword: 'maxBytes' }])
    expect(issues(`${'é'.repeat(MARKDOWN_LIMITS.maxBytes / 2)}\nx`)).toEqual([{ line: 2, keyword: 'maxBytes' }])
    expect(issues('😀'.repeat(MARKDOWN_LIMITS.maxBytes / 4 + 1))).toEqual([{ line: 1, keyword: 'maxBytes' }])
    expect(issues('x'.repeat(MARKDOWN_LIMITS.maxBytes * 4 + 1))).toEqual([{ line: 1, keyword: 'maxBytes' }])
    expect(parse('a'.repeat(MARKDOWN_LIMITS.maxBytes)).ok).toBe(true)
  })

  it('lista além da profundidade 10 e citação além de 32 níveis: para cedo, com a linha', () => {
    expect(issues(Array.from({ length: 11 }, (_, i) => `${'  '.repeat(i)}- n${i}`).join('\n'))).toEqual([{ line: 11, keyword: 'maxDepth' }])
    expect(parse(Array.from({ length: 10 }, (_, i) => `${'  '.repeat(i)}- n${i}`).join('\n')).ok).toBe(true)
    expect(issues('- '.repeat(11) + 'x')).toEqual([{ line: 1, keyword: 'maxDepth' }])
    expect(issues('a\n\n' + '>'.repeat(33) + ' x')).toEqual([{ line: 3, keyword: 'maxDepth' }])
    // Parágrafo filho no 10º nível passa da profundidade: o contrato do normalize, com a linha do bloco.
    expect(issues(Array.from({ length: 10 }, (_, i) => `${'  '.repeat(i)}- n${i}`).join('\n') + '\n\n' + '  '.repeat(10) + 'filho')).toEqual([{ line: 12, keyword: 'maxDepth' }])
  })

  it('mais blocos que o limite: para cedo, com a linha', () => {
    expect(issues('a\n\nb\n\nc\n\nd', { limits: { maxBlocks: 3 } })).toEqual([{ line: 7, keyword: 'maxBlocks' }])
    expect(issues('- a\n- b\n- c\n- d', { limits: { maxBlocks: 3 } })).toEqual([{ line: 4, keyword: 'maxBlocks' }])
    expect(issues(`![a](${IMG}) x ![b](${IMG}) y`, { limits: { maxBlocks: 3 } })).toEqual([{ line: 1, keyword: 'maxBlocks' }])
    expect(issues('a\n=\n\nb\n-\n\n| c |\n|---|\n\nd', { limits: { maxBlocks: 3 } })).toEqual([{ line: 10, keyword: 'maxBlocks' }])
    expect(parse('> a\n> b\n> c\n> d', { limits: { maxBlocks: 1 } }).ok).toBe(true)
  })

  it('tabela com mais de 100 colunas ou 10 mil células: para cedo, com a linha', () => {
    expect(issues(`a\n\n|${'a|'.repeat(101)}\n|${'-|'.repeat(101)}`)).toEqual([{ line: 4, keyword: 'maxColumns' }])
    expect(issues(`|${'a|'.repeat(100)}\n|${'-|'.repeat(100)}\n${'|b|\n'.repeat(200)}`)).toEqual([{ line: 102, keyword: 'maxCells' }])
    expect(TABLE_LIMITS.maxCells).toBe(10_000)
  })

  it('o que o normalize recusa (nós em linha, 2 MiB na forma canônica) volta com a linha do bloco, ou 0 na nota inteira', () => {
    expect(issues(`a\n\n${'x\\\n'.repeat(MAX_INLINE_NODES / 2 + 1)}y`)).toEqual([{ line: 3, keyword: 'maxInlineNodes' }])
    // Caractere de controle vira \\u0001 no JSON (6 bytes por 1): 400 mil passam dos 2 MiB.
    expect(issues(`texto\n\n\`\`\`\n${'\u0001'.repeat(400_000)}\n\`\`\``)).toEqual([{ line: 0, keyword: 'maxBytes' }])
  })

  it('toMarkdownSchemaIssues: path do campo, `linha N:` na mensagem, os fatais primeiro e no máximo 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ line: i + 1, path: '', keyword: 'imagePath', message: 'm', fatal: false }))
    const result = toMarkdownSchemaIssues([...many, { line: 0, path: '/0', keyword: 'internal', message: 'x', fatal: true }], '/conteudo')
    expect(result).toHaveLength(20)
    expect(result[0]).toEqual({ path: '/conteudo', keyword: 'internal', message: 'x' })
    expect(result[1]).toEqual({ path: '/conteudo', keyword: 'imagePath', message: 'linha 1: m' })
    expect(toMarkdownSchemaIssues([{ line: 3, path: '', keyword: 'k', message: 'm', fatal: false }])).toEqual([{ path: '/markdown', keyword: 'k', message: 'linha 3: m' }])
  })

  it('nunca lança: entrada que não é texto, nota atual estranha, newId que repete', () => {
    expect(markdownToNote(5 as unknown as string)).toMatchObject({ ok: false, issues: [{ keyword: 'type' }] })
    // Nota gravada com tabela de 120 colunas: o render a deixa de fora (ilegível), e a regravação segue.
    const wide = [{ id: 'w', type: 'table', props: { textColor: 'default' }, content: { type: 'tableContent', rows: [{ cells: Array.from({ length: 120 }, () => 'c') }] }, children: [] }]
    expect(ok('texto', { existing: wide }).blocks.map(b => b.type)).toEqual(['paragraph'])
    const trap = [{ id: 'x', get type(): string { throw new Error('getter') } }]
    expect(markdownToNote('texto', { existing: trap })).toMatchObject({ ok: false, issues: [{ keyword: 'internal', fatal: true }] })
    expect(blocksToMarkdown(trap)).toEqual({ markdown: '', losses: [{ path: '', kind: 'unreadable' }], blocks: [] })
    expect(blocksToText([p(T('antes')), ...trap])).toBe('antes')
    for (const existing of [null, undefined, {}, 'x', [null, 1, 'a', { type: 'image' }, { id: 5 }]]) {
      expect(markdownToNote('texto', { existing }).ok, JSON.stringify(existing)).toBe(true)
    }
    expect(markdownToNote('a\n\nb', { newId: () => 'sempre' })).toMatchObject({ ok: false, issues: [{ keyword: 'internal', fatal: true }] })
  })
})

describe('reconciliação: o que não mudou volta intacto', () => {
  const props = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
  const note: Block[] = [
    { id: 'h', type: 'heading', props: { ...props, textColor: 'red', level: 2, isToggleable: true }, content: [T('Título')], children: [{ id: 'hc', type: 'paragraph', props, content: [T('dentro do título')], children: [] }] },
    { id: 'p1', type: 'paragraph', props: { ...props, backgroundColor: 'yellow' }, content: [T('um')], children: [] },
    { id: 'e1', type: 'paragraph', props, content: [], children: [] },
    { id: 'p2', type: 'paragraph', props: { ...props, textAlignment: 'center' }, content: [T('dois', { underline: true })], children: [] },
    { id: 't', type: 'toggleListItem', props, content: [T('recolhível')], children: [{ id: 'tc', type: 'paragraph', props, content: [T('escondido')], children: [] }] },
    { id: 'e2', type: 'paragraph', props, content: [], children: [] },
  ]
  const md = blocksToMarkdown(note).markdown

  it('o mesmo Markdown devolve a nota igual, byte a byte (cores, alinhamento, recolhível, filhos, vazios), sem perdas', () => {
    expect(blocksToMarkdown(note).losses.map(l => l.kind)).toEqual(['textColor', 'toggle', 'nestedUnderNonList', 'backgroundColor', 'emptyParagraph', 'alignment', 'underline', 'toggle'])
    const r = ok(md, { existing: note })
    expect(r.blocks).toEqual(note)
    expect(r.losses).toEqual([])
  })

  it('bloco editado perde o que o Markdown não tem (e só ele aparece em losses); os vizinhos ficam', () => {
    const r = ok(md.replace('dois', 'DOIS'), { existing: note })
    // O parágrafo vazio só fica entre dois blocos que voltaram intactos.
    expect(r.blocks.map(b => b.id)).toEqual(['h', 'p1', 'n-1', 't', 'e2'])
    expect(r.losses).toEqual([{ path: '/2', kind: 'emptyParagraph' }, { path: '/3/props/textAlignment', kind: 'alignment' }, { path: '/3/content/0', kind: 'underline' }])
  })

  it('bloco removido sai; o parágrafo vazio ao lado dele sai junto; o do fim fica', () => {
    const r = ok(md.replace('um\n\n', ''), { existing: note })
    expect(r.blocks.map(b => b.id)).toEqual(['h', 'p2', 't', 'e2'])
  })

  it('só o filho achatado mudou: o pai volta com cor e id, sem os filhos (que vêm do Markdown)', () => {
    const r = ok(md.replace('dentro do título', 'filho novo'), { existing: note })
    expect(r.blocks[0]).toEqual({ ...note[0], children: [] })
    expect(compact([r.blocks[1]])).toEqual([{ t: 'paragraph', c: 'filho novo' }])
    expect(r.losses).toEqual([{ path: '/0/children/0', kind: 'nestedUnderNonList' }])
  })

  it('bloco novo no meio e no fim: os antigos ficam; o vazio do fim sai (o editor o recria)', () => {
    const r = ok(`${md.replace('um', 'um\n\nnovo no meio')}\nnovo no fim\n`, { existing: note })
    expect(r.blocks.map(b => b.id)).toEqual(['h', 'hc', 'p1', 'n-1', 'p2', 't', 'n-2'].filter(id => id !== 'hc'))
  })

  it('ordem trocada: um dos dois volta intacto, o outro como novo', () => {
    const swapped = ok('dois\n\num', { existing: [{ id: 'a', type: 'paragraph', props, content: [T('um')], children: [] }, { id: 'b', type: 'paragraph', props, content: [T('dois')], children: [] }] })
    expect(swapped.blocks.map(b => b.id).filter(id => id === 'a' || id === 'b')).toHaveLength(1)
  })

  it('formas equivalentes de Markdown contam como iguais (a chave é o bloco lido, não o texto)', () => {
    const existing = [{ id: 'x', type: 'paragraph', props: { ...props, textColor: 'blue' }, content: [T('a', { italic: true })], children: [] }]
    expect(ok('*a*', { existing }).blocks).toEqual(existing)
  })

  it('nota com ids repetidos: o render dá um id determinístico ao repetido, e a regravação mantém os dois', () => {
    const dup = [
      { id: 'x', type: 'diagram', props: { elements: '[]', appState: '{}', collapsed: 'false' }, children: [] },
      { id: 'x', type: 'diagram', props: { elements: '[]', appState: '{}', collapsed: 'true' }, children: [] },
    ]
    const rendered = blocksToMarkdown(dup).markdown
    expect(rendered).toContain('id="x"')
    expect(rendered).toContain('id="x-2"')
    const r = ok(rendered, { existing: dup })
    expect(r.blocks.map(b => b.id)).toEqual(['x', 'x-2'])
    expect((r.blocks[1].props as Block).collapsed).toBe('true')
    const edited = ok(`texto\n\n${rendered}`, { existing: dup })
    expect(edited.blocks.map(b => b.id)).toEqual(['n-1', 'x', 'x-2'])
  })

  it('anexar: devolve só os blocos novos, com ids fora da nota e de reservedIds; o limite vale sobre a nota juntada', () => {
    const existing = [{ id: 'n-1', type: 'paragraph', props, content: [T('antes')], children: [] }]
    const r = ok('antes\n\ndepois', { existing, mode: 'append', reservedIds: ['n-2'] })
    expect(r.blocks.map(b => b.id)).toEqual(['n-3', 'n-4'])
    expect(r.losses).toEqual([])
    expect(issues('a\n\nb', { existing, mode: 'append', limits: { maxBlocks: 2 } })).toEqual([{ line: 0, keyword: 'maxBlocks' }])
    expect(parse('a', { existing, mode: 'append', limits: { maxBlocks: 2 } }).ok).toBe(true)
  })

  it('substituir com reservedIds: os blocos novos não usam esses ids', () => {
    expect(ok('a', { reservedIds: ['n-1'] }).blocks.map(b => b.id)).toEqual(['n-2'])
  })

  it('o problema fatal de um bloco herdado volta com a linha onde ele está no Markdown', () => {
    const broken = [
      { id: 'a', type: 'paragraph', props, content: [T('a')], children: [] },
      { id: 'b', type: 'heading', props: { ...props, level: 9 }, content: [T('b')], children: [] },
    ]
    const r = parse(blocksToMarkdown(broken).markdown, { existing: broken })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.issues[0]).toMatchObject({ line: 3, path: '/1/props/level', keyword: 'enum', fatal: true })
  })

  it('diffKeys: prefixo, sufixo e âncoras únicas, sempre crescente', () => {
    expect([...diffKeys(['a', 'b', 'c'], ['a', 'b', 'c'])]).toEqual([0, 1, 2])
    expect([...diffKeys(['a', 'x', 'b', 'c', 'y', 'd'], ['a', 'b', 'z', 'c', 'd'])]).toEqual([0, -1, 1, 3, -1, 4])
    expect([...diffKeys(['u', 'v', 'w', 'v'], ['w', 'u', 'v', 'v'])]).toEqual([1, 2, -1, 3])
    expect([...diffKeys(['k', 'k'], ['k', 'q', 'k'])]).toEqual([0, 2])
    expect([...diffKeys([], ['a'])]).toEqual([])
    expect([...diffKeys(['a'], [])]).toEqual([-1])
    // Âncora com extensão para trás e para frente, e as chaves repetidas fora.
    expect([...diffKeys(['p', 'q', 'A', 'r', 's', 'z'], ['x', 'p', 'q', 'A', 'r', 's', 'y'])]).toEqual([1, 2, 3, 4, 5, -1])
  })

  it('reconcile: bloco sem projeção volta só entre vizinhos intactos e seguidos', () => {
    const hidden = { keys: [], keepIfHidden: true }
    expect(reconcile([hidden, { keys: ['a'] }, hidden], ['a'])).toEqual({
      slots: [{ kind: 'old', index: 0, mode: 'intact', first: -1 }, { kind: 'old', index: 1, mode: 'intact', first: 0 }, { kind: 'old', index: 2, mode: 'intact', first: -1 }],
      fate: ['intact', 'intact', 'intact'],
    })
    expect(reconcile([hidden, { keys: ['a'] }], ['b', 'a']).fate).toEqual(['gone', 'intact'])
    expect(reconcile([hidden], []).fate).toEqual(['intact'])
    expect(reconcile([{ keys: ['a', 'b'] }, { keys: ['c'] }], ['a', 'x', 'c'])).toEqual({
      slots: [{ kind: 'old', index: 0, mode: 'head', first: 0 }, { kind: 'new', index: 1 }, { kind: 'old', index: 1, mode: 'intact', first: 2 }],
      fate: ['head', 'intact'],
    })
  })
})

describe('render', () => {
  const md = (...content: unknown[]) => render([p(...content)]).markdown

  it('escapes de sempre e os de começo de linha; o texto volta igual', () => {
    const cases: [string, string][] = [
      ['*a* _b_ `c` [d](e) <h> \\ | ~i~', '\\*a\\* \\_b\\_ \\`c\\` \\[d\\](e) \\<h\\> \\\\ \\| \\~i\\~'],
      ['# t', '\\# t'], ['- a', '\\- a'], ['+ a', '\\+ a'], ['=== a', '\\=== a'], [':-- a', '\\:-- a'], ['1. a', '1\\. a'], ['2) a', '2\\) a'], ['1.5 a', '1.5 a'],
      ['> a', '\\> a'], ['```a', '\\`\\`\\`a'], ['    código', '&#32;   código'], ['\tx', '&#9;x'], ['fim ', 'fim&#32;'], ['a#b', 'a#b'],
      ['&amp; &x &#1;', '\\&amp; &x \\&#1;'], ['!', '!'], ['https://x.com http://y', 'https\\://x.com http\\://y'], ['www.a.b WWW.c', 'www\\.a.b WWW\\.c'],
      ['a@b.com @a a@ @ x@', 'a\\@b.com @a a@ @ x\\@'], ['@a', '\\@a'], ['[^1]: x', '\\[^1\\]: x'],
    ]
    for (const [text, expected] of cases) {
      expect(md(T(text)), text).toBe(`${expected}\n`)
      expect(compact(ok(md(T(text))).blocks), text).toEqual([{ t: 'paragraph', c: text }])
    }
  })

  it('quebras: \\ no fim da linha, regras de começo depois de cada quebra, <br> no fim e em título e célula', () => {
    expect(md(T('a\n# b\n\nc\n'))).toBe('a\\\n\\# b\\\n\\\nc<br>\n')
    expect(md(T('\n\n'))).toBe('<br><br>\n')
    expect(md(T('\na'))).toBe('\\\na\n')
    expect(render([{ type: 'heading', props: { level: 2 }, content: [T('a\nb #')] }]).markdown).toBe('## a<br>b \\#\n')
    expect(render([{ type: 'heading', content: [T('#')] }, { type: 'heading', content: [T('  x  ')] }]).markdown).toBe('# \\#\n\n# &#32; x &#32;\n')
    expect(compact(ok(render([{ type: 'heading', content: [T('#')] }, { type: 'heading', content: [T('  x  ')] }]).markdown).blocks)).toEqual([{ t: 'heading', c: '#' }, { t: 'heading', c: '  x  ' }])
  })

  it('estilos: um caractere por estilo, os espaços das bordas fora, entidade no vizinho quando o flanqueamento falharia', () => {
    expect(md(T('a', { bold: true }), T('b', { italic: true }), T(' c ', { strike: true }), T('d', { bold: true, italic: true, strike: true }))).toBe('**a**_b_ ~~c~~ **_~~d~~_**\n')
    expect(md(T('a.', { bold: true }), T('b'))).toBe('**a.**&#98;\n')
    expect(md(T('x'), T('(a)', { bold: true }))).toBe('&#120;**(a)**\n')
    expect(md(T('x'), T('y', { italic: true }), T('z'))).toBe('&#120;_y_&#122;\n')
    expect(md(T('😀'), T('"a"', { bold: true }))).toBe('&#128512;**"a"**\n')
    for (const content of [[T('a.', { bold: true }), T('b')], [T('x'), T('y', { italic: true }), T('z')], [T('😀'), T('"a"', { bold: true })]]) {
      expect(strip(ok(md(...content)).blocks[0].content)).toEqual(strip(normalizeNoteContent([p(...content)]).ok && (normalizeNoteContent([p(...content)]) as { blocks: NoteBlock[] }).blocks[0].content))
    }
  })

  it('código em linha: crases a mais que as de dentro, espaço de folga quando precisa, partido em cada quebra', () => {
    expect(md(T('a`b', { code: true }))).toBe('``a`b``\n')
    expect(md(T('`a', { code: true }), T(' '), T(' a ', { code: true }), T(' '), T('  ', { code: true }))).toBe('`` `a `` `  a  ` `  `\n')
    expect(md(T('a\nb', { code: true }))).toBe('`a`\\\n`b`\n')
    expect(compact(ok(md(T('a\nb', { code: true }))).blocks)).toEqual([{ t: 'paragraph', c: [{ t: 'a\nb', s: 'code' }] }])
  })

  it('links: destino cru ou <…>, & de entidade escapado, `!` antes do link escapado; código no 1º link com `]` vira texto', () => {
    expect(linkDest('https://e.com')).toBe('https://e.com')
    expect(linkDest('a b(c)<d>\\e')).toBe('<a b(c)\\<d\\>\\\\e>')
    expect(linkDest('?a=1&amp;b')).toBe('?a=1\\&amp;b')
    expect(linkDest('a|b', true)).toBe('a\\|b')
    expect(linkDest('')).toBe('<>')
    expect(md(T('veja!'), { type: 'link', href: '/x', content: [T('y')] })).toBe('veja\\![y](/x)\n')
    const ref = render([p({ type: 'link', href: '/x', content: [T('a]:b', { code: true })] }), p({ type: 'link', href: '/y', content: [T('c]', { code: true }), T(':d')] })])
    expect(ref.losses).toEqual([{ path: '/0/content', kind: 'codeSpan' }])
    expect(compact(ok(ref.markdown).blocks)).toEqual([{ t: 'paragraph', c: [{ href: '/x', c: 'a]:b' }] }, { t: 'paragraph', c: [{ href: '/y', c: [{ t: 'c]', s: 'code' }, ':d'] }] }])
  })

  it('código: cerca maior que as crases de dentro, ~~~ quando a linguagem tem crase, info escapada', () => {
    expect(render([{ type: 'codeBlock', props: { language: 'ts' }, content: [T('a\n````\nb')] }]).markdown).toBe('`````ts\na\n````\nb\n`````\n')
    expect(render([{ type: 'codeBlock', props: { language: 'a`b' }, content: [T('~~~')] }]).markdown).toBe('~~~~a`b\n~~~\n~~~~\n')
    expect(render([{ type: 'codeBlock', props: { language: 'x\\y&amp;' }, content: [] }]).markdown).toBe('```x\\\\y\\&amp;\n```\n')
    expect(compact(ok('```x\\\\y\\&amp;\n```').blocks)).toEqual([{ t: 'codeBlock', p: { language: 'x\\y&amp;' }, c: [] }])
  })

  it('cada tipo de perda, com o ponteiro', () => {
    const cell = (props: Block, content = 'c') => ({ type: 'tableCell', props, content: [T(content)] })
    const cases: [LossKind, unknown[], string][] = [
      ['textColor', [p(T('a', { textColor: 'red' }))], '/0/content/0'],
      ['backgroundColor', [{ ...p(T('a')), props: { backgroundColor: 'blue' } }], '/0/props/backgroundColor'],
      ['underline', [p(T('a', { underline: true }))], '/0/content/0'],
      ['alignment', [{ ...p(T('a')), props: { textAlignment: 'right' } }], '/0/props/textAlignment'],
      ['columnWidths', [{ type: 'table', content: { type: 'tableContent', headerRows: 1, columnWidths: [120], rows: [{ cells: ['a'] }] } }], '/0/content/columnWidths'],
      ['mergedCells', [{ type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [cell({ colspan: 2 })] }, { cells: ['a', 'b'] }] } }], '/0/content/rows/0/cells/0'],
      ['headerRows', [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a'] }, { cells: ['b'] }] } }], '/0/content/headerRows'],
      ['headerCols', [{ type: 'table', content: { type: 'tableContent', headerRows: 1, headerCols: 1, rows: [{ cells: ['a', 'b'] }, { cells: ['c'] }] } }], '/0/content/headerCols'],
      ['toggle', [{ type: 'toggleListItem', content: [T('a')] }], '/0'],
      ['nestedUnderNonList', [{ ...p(T('a')), children: [p(T('b'))] }], '/0/children/0'],
      ['emptyParagraph', [p(), p(T('a'))], '/0'],
      ['codeStyles', [{ type: 'codeBlock', content: [T('a', { bold: true }), { type: 'link', href: '/x', content: [T('b')] }] }], '/0/content/0'],
      ['codeLanguage', [{ type: 'codeBlock', props: { language: 'a b' }, content: [T('x')] }], '/0/props/language'],
      ['codeWhitespace', [{ type: 'bulletListItem', content: [T('a')], children: [{ type: 'codeBlock', content: [T('x\n   \ny')] }] }], '/0/children/0/content'],
      ['codeLineEnding', [{ type: 'codeBlock', content: [T('a\r\nb')] }], '/0/content'],
      ['listStart', [{ type: 'numberedListItem', props: { start: 1 }, content: [T('a')] }], '/0/props/start'],
      ['imageProps', [{ type: 'image', props: { url: IMG, previewWidth: 300 } }], '/0/props'],
      ['codeSpan', [{ type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [[T('a\\|b', { code: true })]] }] } }], '/0/content/rows/0/cells/0/content'],
    ]
    for (const [kind, blocks, path] of cases) expect(render(blocks).losses, kind).toContainEqual({ path, kind })
    const raw: [LossKind, unknown, string][] = [
      ['unreadable', [null, { type: 'table', content: 'x' }, { type: 'callout', content: [T('texto')] }], '/0'],
      ['listStart', [{ type: 'numberedListItem', props: { start: -2 }, content: [T('a')] }], '/0/props/start'],
      ['unsafeLink', [p({ type: 'link', href: 'a\nb', content: [T('a')] })], '/0/content/0'],
      ['unsafeLink', [p({ type: 'link', href: 'javascript:x', content: [T('a')] }, { type: 'link', href: '', content: 'b' })], '/0/content/1'],
      ['imageProps', [{ type: 'image', props: { url: IMG, name: 'a\nb' } }], '/0/props'],
      ['codeLanguage', [{ type: 'codeBlock', props: { language: '' }, content: [T('x')] }], '/0/props/language'],
      ['truncated', [{ type: 'codeBlock', content: [T('a'.repeat(RENDER_BUDGET))] }], '/0'],
    ]
    for (const [kind, blocks, path] of raw) expect(blocksToMarkdown(blocks).losses, kind).toContainEqual({ path, kind })
    expect(new Set([...cases, ...raw].map(([kind]) => kind)).size).toBe(Object.keys(MARKDOWN_LOSSES).length - 1)
    expect(blocksToMarkdown([{ id: 'd', type: 'diagram' }], { markers: false }).losses).toEqual([{ path: '/0', kind: 'nonMarkdownBlock' }])
  })

  it('parágrafo vazio do fim não é perda; o do meio é', () => {
    expect(render([p(T('a')), p()]).losses).toEqual([])
    expect(render([p(), p(T('a')), p()]).losses).toEqual([{ path: '/0', kind: 'emptyParagraph' }])
  })

  it('tabela: grade com as mescladas vazias, alinhamento só quando a coluna é uniforme', () => {
    const cell = (text: string, props: Block = {}) => ({ type: 'tableCell', props, content: [T(text)] })
    const r = blocksToMarkdown([{ id: 't', type: 'table', props: { textColor: 'red' }, content: { type: 'tableContent', headerRows: 1, rows: [
      { cells: [cell('a', { colspan: 2, textAlignment: 'center' }), cell('b', { textAlignment: 'justify' })] },
      { cells: [cell('c', { rowspan: 2, textAlignment: 'right', backgroundColor: 'red', textColor: 'blue' }), cell('d'), cell('e', { textAlignment: 'justify' })] },
      { cells: [cell('f'), cell('g', { textAlignment: 'justify' })] },
    ] } }])
    expect(r.markdown).toBe('| a |  | b |\n| --- | --- | --- |\n| c | d | e |\n|  | f | g |\n')
    expect(r.losses.map(l => `${l.kind} ${l.path}`)).toEqual([
      'textColor /0/props/textColor', 'mergedCells /0/content/rows/0/cells/0', 'mergedCells /0/content/rows/1/cells/0', 'textColor /0/content/rows/1/cells/0/props/textColor',
      'backgroundColor /0/content/rows/1/cells/0/props/backgroundColor', 'alignment /0/content/rows/0/cells/0/props/textAlignment',
      'alignment /0/content/rows/1/cells/0/props/textAlignment', 'alignment /0/content/rows/0/cells/1/props/textAlignment',
      'alignment /0/content/rows/1/cells/2/props/textAlignment', 'alignment /0/content/rows/2/cells/1/props/textAlignment',
    ])
  })

  it('listas: numeração, separador antes de lista que recomeça, item vazio com filho, filho que não interromperia o parágrafo', () => {
    expect(render([
      { type: 'numberedListItem', props: { start: 5 }, content: [T('a')] }, { type: 'numberedListItem', content: [T('b')] },
      { type: 'numberedListItem', props: { start: 1 }, content: [T('c')] }, { type: 'bulletListItem', content: [] },
      { type: 'checkListItem', props: { checked: true }, content: [T('d')], children: [{ type: 'numberedListItem', props: { start: 3 }, content: [T('e')] }] },
      { type: 'bulletListItem', content: [], children: [p(T('f'))] }, { type: 'bulletListItem', content: [T('g')], children: [{ type: 'bulletListItem', content: [] }] },
    ]).markdown).toBe('5. a\n6. b\n\n<!-- -->\n\n1. c\n\n-\n- [x] d\n\n  3. e\n- <!-- -->\n\n  f\n- g\n\n  -\n')
  })

  it('markers: false põe o rótulo do texto puro; cards: label põe o título do card', () => {
    const SNAP = JSON.stringify({ title: 'Card -- "x"' })
    const blocks = [{ id: 'c', type: 'projectCard', props: { snapshot: SNAP } }, { id: 'i', type: 'image', props: { url: IMG, caption: 'leg' } }]
    expect(blocksToMarkdown(blocks, { markers: false }).markdown).toBe('\\[card\\]\n\n![](' + IMG + ' "leg")\n')
    expect(blocksToMarkdown(blocks, { markers: false, cards: 'label' }).markdown).toContain('\\[card: Card -- "x"\\]')
    expect(blocksToMarkdown(blocks, { cards: 'label' }).markdown).toContain('tipo="projectCard" titulo="Card -&#45; &quot;x&quot;"')
    expect(blocksToMarkdown(blocks).markdown).not.toContain('titulo=')
  })

  it('withUniqueIds: repetido e id que não é texto ganham id determinístico; a nota recebida não muda', () => {
    const note = [{ id: 'a', children: [{ id: 'a' }, { id: 'a-2' }] }, { id: 5 }, { id: '' }, 'x']
    const copy = JSON.stringify(note)
    expect(withUniqueIds(note)).toEqual([{ id: 'a', children: [{ id: 'a-3' }, { id: 'a-2' }] }, { id: 'bloco-2' }, { id: 'bloco-3' }, 'x'])
    expect(JSON.stringify(note)).toBe(copy)
    const clean = [{ id: 'a' }]
    expect(withUniqueIds(clean)).toBe(clean)
    expect(withUniqueIds(null)).toEqual([])
  })

  it('tolerante: content nulo, forma parcial, blocos estranhos e 100 níveis não lançam', () => {
    let deep: Block = p(T('fundo'))
    for (let i = 0; i < 100; i++) deep = { type: 'bulletListItem', content: 'x', children: [deep] }
    for (const value of [null, undefined, 5, {}, [], [null], [{ type: 5 }], [{ type: 'paragraph', content: 'texto', props: 'x' }], [{ content: [5, 'a', { type: 'mention' }, { type: 'link', href: 5, content: 'b' }] }], [deep]]) {
      expect(() => blocksToMarkdown(value), JSON.stringify(value)?.slice(0, 40)).not.toThrow()
      expect(() => blocksToText(value)).not.toThrow()
    }
    expect(blocksToMarkdown(null)).toEqual({ markdown: '', losses: [], blocks: [] })
    expect(blocksToMarkdown([{ content: [5, 'a', { type: 'mention' }, { type: 'link', href: 5, content: 'b' }] }]).markdown).toBe('ab\n')
  })

  it('todas as fixtures (válidas, parciais e o content das fatais, inclusive os 180 KB do text-many-line-breaks) passam pelo render e pelo texto', () => {
    const all: [string, unknown][] = [...VALID, ...PARTIAL, ...FATAL.map(([name, f]) => [name, f.content] as [string, unknown])]
    expect(all.length).toBeGreaterThan(60)
    for (const [name, content] of all) {
      const r = blocksToMarkdown(content)
      expect(typeof r.markdown, name).toBe('string')
      expect(typeof blocksToText(content), name).toBe('string')
      expect(() => markdownToNote(r.markdown, { existing: content }), name).not.toThrow()
    }
    expect(blocksToMarkdown(FATAL.find(([name]) => name === 'text-many-line-breaks')![1].content).markdown.length).toBeGreaterThan(100_000)
  })
})

describe('blocksToText', () => {
  it('um bloco por linha, com prefixos, filhos recuados, tabela em `a | b` e rótulos pt-BR', () => {
    const SNAP = JSON.stringify({ title: 'Lançar' })
    const text = blocksToText([
      { type: 'heading', content: [T('Título')] }, p(T('a\nb')), { type: 'bulletListItem', content: [T('item')], children: [{ type: 'numberedListItem', content: 'um' }, { type: 'numberedListItem', content: 'dois' }] },
      { type: 'numberedListItem', props: { start: 4 }, content: [T('quatro')] }, { type: 'numberedListItem', content: [T('cinco')] }, { type: 'toggleListItem', content: [T('t')] },
      { type: 'checkListItem', props: { checked: true }, content: [T('feito')] }, { type: 'checkListItem', content: [T('falta')] }, { type: 'quote', content: [T('cita\nção')] },
      { type: 'codeBlock', content: [T('x = 1')] }, { type: 'divider' }, { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a', { type: 'tableCell', content: [T('b\nc')] }] }, 'x', { cells: ['d'] }] } },
      { type: 'image', props: { name: 'n', caption: 'legenda' } }, { type: 'image', props: {} }, { type: 'diagram' }, { type: 'projectCard', props: { snapshot: SNAP } },
      { type: 'file', props: { name: 'a.pdf' } }, { type: 'file' }, { type: 'video', props: { name: 'v' } }, { type: 'video' }, { type: 'audio', props: { name: 'a' } }, { type: 'audio' },
      { type: 'link', href: 'x', content: [T('link')] }, p(), p({ type: 'link', href: '/x', content: [T('ligado')] }),
    ])
    expect(text).toBe([
      'Título', 'a', 'b', '- item', '  1. um', '  2. dois', '4. quatro', '5. cinco', '- t', '[x] feito', '[ ] falta', '> cita', '  ção', 'x = 1', '---', 'a | b c', 'd',
      '[imagem: legenda]', '[imagem]', '[diagrama]', '[card]', '[arquivo: a.pdf]', '[arquivo]', '[vídeo: v]', '[vídeo]', '[áudio: a]', '[áudio]', 'link', '', 'ligado',
    ].join('\n'))
    expect(blocksToText([{ type: 'projectCard', props: { snapshot: SNAP } }, { type: 'projectCard', props: { snapshot: '{' } }, { type: 'projectCard', props: { snapshot: '{}' } }], { cards: 'label' })).toBe('[card: Lançar]\n[card]\n[card]')
    expect(blocksToText(null)).toBe('')
    expect(blocksToText([p(T('a')), p(), p()])).toBe('a')
  })
})

describe('propriedades com semente fixa', () => {
  it('(a) subconjunto sem perdas: losses vazio e a leitura dá a mesma nota (fora os ids); com a nota atual, igual com os ids', () => {
    const next = noteGenerator(20261011)
    const failures: string[] = []
    let blocks = 0
    for (let i = 0; i < 300; i++) {
      const norm = normalizeNoteContent(next(), { newId: counter('g') })
      if (!norm.ok) throw new Error(JSON.stringify(norm.issues[0]))
      blocks += norm.blocks.length
      const r = blocksToMarkdown(norm.blocks)
      if (r.losses.length > 0) failures.push(`#${i} perdas ${JSON.stringify(r.losses)}`)
      const back = markdownToNote(r.markdown, { images: IMAGES, newId: counter('b') })
      if (!back.ok) failures.push(`#${i} recusou ${JSON.stringify(back.issues[0])}\n${r.markdown}`)
      else if (JSON.stringify(strip(back.blocks)) !== JSON.stringify(strip(norm.blocks))) failures.push(`#${i} difere\n${r.markdown}`)
      const same = markdownToNote(r.markdown, { images: IMAGES, existing: norm.blocks, newId: counter('s') })
      if (!same.ok || JSON.stringify(same.blocks) !== JSON.stringify(norm.blocks)) failures.push(`#${i} reconciliação não deu a mesma nota`)
    }
    expect(failures.slice(0, 3)).toEqual([])
    expect(blocks).toBeGreaterThan(1000)
  }, 60_000)

  it('(b) idempotência: render(leitura(render(leitura(m)))) = render(leitura(m))', () => {
    const next = markdownGenerator(20261013)
    const failures: string[] = []
    let accepted = 0
    for (let i = 0; i < 400; i++) {
      const md = next()
      const r1 = markdownToNote(md, { images: IMAGES, newId: counter() })
      if (!r1.ok) continue
      accepted++
      const m1 = blocksToMarkdown(r1.blocks).markdown
      const r2 = markdownToNote(m1, { images: IMAGES, newId: counter() })
      if (!r2.ok) {
        failures.push(`#${i} ${JSON.stringify(md)} → ${JSON.stringify(r2.issues[0])}`)
        continue
      }
      const m2 = blocksToMarkdown(r2.blocks).markdown
      if (m1 !== m2) failures.push(`#${i} ${JSON.stringify(md)}\n${m1}\n≠\n${m2}`)
    }
    expect(failures.slice(0, 3)).toEqual([])
    expect(accepted).toBeGreaterThan(150)
  }, 60_000)

  it('(c) a leitura nunca lança; aceita ⇒ forma completa válida; o corpus inteiro passa', () => {
    const next = markdownGenerator(20261014)
    const inputs: [string, string][] = [...CORPUS, ...Array.from({ length: 400 }, (_, i) => [`#${i}`, next()] as [string, string])]
    const rand = mulberry32(7)
    // Também Markdown cortado em lugar qualquer (cercas, comentários e tabelas pela metade).
    for (const [name, md] of CORPUS) inputs.push([`${name} cortado`, md.slice(0, Math.floor(rand() * md.length))])
    const failures: string[] = []
    for (const [name, md] of inputs) {
      let r: MarkdownResult
      try {
        r = markdownToNote(md, { images: IMAGES, newId: counter() })
      } catch (err) {
        failures.push(`${name}: lançou ${String(err)}`)
        continue
      }
      if (r.ok) {
        const full = validateNoteContent(r.blocks, { form: 'full' })
        if (!full.ok) failures.push(`${name}: ${JSON.stringify(full.issues[0])}`)
      } else if (r.issues.some(i => i.keyword === 'internal')) failures.push(`${name}: erro interno`)
    }
    expect(failures).toEqual([])
  }, 60_000)
})

// ── Bateria patológica (cmark e cmark-gfm, mais os casos da avaliação) ───────

const utf8 = (text: string) => new TextEncoder().encode(text).length

/** Repete a unidade até `size` bytes UTF-8 exatos (corta no fim e completa com espaço). */
function fill(unit: (i: number) => string, size: number): string {
  const parts: string[] = []
  let n = 0
  for (let i = 0; n < size; i++) {
    const u = unit(i)
    parts.push(u)
    n += utf8(u)
  }
  let out = parts.join('')
  let bytes = utf8(out)
  while (bytes > size) {
    const last = out.codePointAt(out.length - 1 - (out.length > 1 && /[\udc00-\udfff]/.test(out[out.length - 1]) ? 1 : 0)) as number
    out = out.slice(0, last > 0xffff ? -2 : -1)
    bytes -= utf8(String.fromCodePoint(last))
  }
  return out + ' '.repeat(size - bytes)
}

/** Cada caso gera Markdown de exatamente `n` bytes UTF-8 (o limite de entrada é em bytes). */
const PATHOLOGICAL: Record<string, (n: number) => string> = {
  enfaseAninhada: n => (fill(() => '*a **a ', n / 2) + 'b' + fill(() => ' a** a*', n / 2)).slice(0, n),
  fechadoresSemAbridor: n => fill(() => 'a_ ', n),
  abridoresSemFechador: n => fill(() => '_a ', n),
  enfaseMisturada: n => fill(() => '*a_ ', n),
  multiploDe3: n => 'a**b' + fill(() => 'c* ', n - 4),
  tilsAlternados: n => fill(i => (i % 2 ? '~a ' : 'a~ '), n),
  sublinhadoNaPalavra: n => fill(() => 'a_b', n),
  colchetesFechando: n => fill(() => 'a]', n),
  colchetesAbrindo: n => fill(() => '[a', n),
  linkEEnfase: n => fill(() => '[ a_', n),
  parentesColchete: n => fill(() => '[ (](', n),
  colchetesAninhados: n => '['.repeat(n / 2) + 'a' + ']'.repeat(n / 2 - 1),
  imagensAninhadas: n => ('!['.repeat(n / 3) + 'a' + ']'.repeat(n / 3)).padEnd(n, ']').slice(0, n),
  linkSemFecharA: n => fill(() => '[a](<b', n),
  linkSemFecharB: n => fill(() => '[a](b', n),
  linkParenteses: n => fill(() => '[a](', n),
  destinoComParenteses: n => '[a](' + '('.repeat(n / 2 - 2) + ')'.repeat(n / 2 - 2),
  tituloSemFechar: n => fill(() => '[a](b "', n),
  crases: n => fill(i => 'e' + '`'.repeat((i % 200) + 1), n),
  crasesSemFechar: n => fill(() => '`a', n),
  comentarioSemFechar: n => '</' + fill(() => '<!--', n - 2),
  tagSemFechar: n => fill(() => '<a b="', n),
  tagAtributos: n => '<a' + fill(() => ' b', n - 2),
  menorQue: n => fill(() => '<a ', n),
  entidades: n => fill(() => '&amp;&#x41;&foo; ', n),
  escapes: n => fill(() => '\\*', n),
  autolinkWww: n => fill(() => 'www.', n),
  autolinkProtocolo: n => fill(() => 'http://', n),
  autolinkEmail: n => fill(() => 'a@', n),
  emailLongo: n => 'a'.repeat(n / 2) + '@' + fill(() => 'b.', n / 2 - 1),
  referencias: n => fill(i => `[r${i}]: /u${i}\n`, n / 2) + fill(i => `[r${i}] `, n / 2),
  rotuloLongo: n => fill(() => `[${'a'.repeat(998)}]`, n),
  rotuloSemFechar: n => fill(() => `[${'a'.repeat(1200)}`, n),
  citacoesFundas: n => '> '.repeat(n / 2 - 1) + 'ab',
  listasFundas: n => fill(i => `${'  '.repeat(i % 12)}* a\n`, n),
  listasNumaLinha: n => fill(() => '- ', n - 1) + 'a',
  linhasEmBranco: n => '- a\n' + '\n'.repeat(n - 4),
  quebrasDuras: n => fill(() => 'a  \n', n),
  tabelaMuitasLinhas: n => '| a | b |\n|---|---|\n' + fill(() => '| x | y |\n', n - 20),
  tabelaCabecalhoGigante: n => ('|' + 'a|'.repeat(n / 4) + '\n|' + '-|'.repeat(n / 4)).slice(0, n),
  cercaSemFechar: n => '```\n' + fill(() => 'x\n', n - 4),
  // Revisão do API-023 (parser linear): gatilho de autolink literal recusado
  // na mesma corrida, parênteses e `;` no fim do autolink, corrida de espaços
  // no meio do texto, imagem seguida de quebras, crase depois da cerca e
  // definição de referência sozinha dentro da citação (que não tem teto de filhos).
  autolinkParenteses: n => fill(() => '(http://', n),
  autolinkColchete: n => fill(() => ']http://', n),
  wwwParentesesSublinhado: n => fill(() => '(www._', n),
  wwwSublinhado: n => fill(() => 'www._', n),
  sublinhadoWww: n => fill(() => '_www.', n),
  wwwSegmentoLongo: n => fill(() => '_www.', n / 2) + 'a'.repeat(n / 2),
  wwwDominioCortado: n => fill(() => '(www.a.b_', n / 2) + '.'.repeat(n / 2),
  autolinkParentesesFinais: n => 'http://a.co/' + ')'.repeat(n - 12),
  autolinkWwwParentesesFinais: n => 'www.a.co/' + ')'.repeat(n - 9),
  autolinkParentesesNaCelula: n => '| a |\n|---|\n| http://a.co/' + ')'.repeat(n - 28) + ' |',
  autolinkPontoEVirgula: n => '&' + fill(() => ' http://a;', n - 1),
  espacosNoMeio: n => 'a' + ' '.repeat(n - 2) + 'b',
  espacosNoMeioELinha: n => 'a' + ' '.repeat(n - 4) + 'b\nc',
  tabsNoMeioELinha: n => 'a' + '\t'.repeat(n - 4) + 'b\nc',
  tituloEspacosNoMeio: n => '# a' + ' '.repeat(n - 4) + 'b',
  celulaEspacosNoMeio: n => '| a |\n|---|\n| a' + ' '.repeat(n - 18) + 'b |',
  textoEImagem: n => 'a' + ' '.repeat(n - 9) + 'b![a](x)',
  imagemEQuebras: n => '![a](x)' + fill(() => '\\\n', n - 7),
  itemImagemEQuebras: n => '- ![a](x)' + fill(() => '\\\n  ', n - 9),
  cercaComCrase: n => '`'.repeat(n - 2) + 'a`',
  definicoesNaCitacao: n => fill(() => '>#\n', n / 2) + fill(() => '>[r]:/u\n>#\n', n / 2),
  nul: n => fill(() => 'abc\u0000de\u0000', n),
  // Nota realista densa, perto dos dois limites (5000 blocos e 2 MiB na forma canônica), com todos os tipos e estilos.
  realista: n => fill(i => [
    `## Seção ${i}: planejamento da semana\n\n`,
    `Texto com **negrito**, _itálico_, \`código\`, ~~tachado~~ e [um link](https://exemplo.com/${i}) no meio de um parágrafo comprido, com acentos (ação, mãe, você), números como 1. e 2) no meio da linha, *ênfase* e mais palavras para encher a linha como numa nota de verdade, escrita por alguém que anota muito.\nA segunda linha continua o mesmo parágrafo, com https://exemplo.com/solto e a@b.com, um trecho **com _estilos_ aninhados** e entidades como &amp; e &copy;, até a quebra dura\\\ne a terceira linha que fecha a ideia com mais texto corrido, sem pressa nenhuma de acabar.\n\n`,
    `- item ${i} com texto suficiente para ocupar a linha toda e mais um pouco de explicação\n  - subitem **importante** e [referência][r], com observação longa sobre o andamento\n    1. [ ] tarefa com prazo, responsável e critério de pronto bem descrito\n\n`,
    `> citação ${i} com uma frase inteira de texto, que continua\n> na linha de baixo com _ênfase_.\n\n`,
    i % 14 === 4 ? `| coluna a | coluna b | coluna c |\n|---|:-:|--:|\n| ${i} | **dois** | \`três\` |\n| quatro | cinco | seis |\n\n` : `Outro parágrafo ${i}, só de texto corrido, como a maior parte de uma nota: uma explicação longa sobre o que foi decidido na reunião, quem ficou com cada tarefa, o que falta confirmar e quais são os próximos passos, com _uma ênfase_ aqui e ali para não ficar tudo igual.\n\n`,
    `\`\`\`ts\nconst x = ${i}\nconsole.log(x * 2)\n\`\`\`\n\n`,
    '[r]: https://exemplo.com/referencia\n\n',
  ][i % 7], n),
}

// Tempos locais (Apple M2, Node 22), menor grande dos pares do measure a 512 KiB.
// Máquina quieta: pior caso 165 ms sem coverage e 551 ms com o coverage
// do V8 (linkParenteses); a nota realista (2.511 blocos, 2,07 MB na forma
// canônica), ~55 ms. O teto vale para todos os casos e aí fica ≥ 5× o pior caso
// com coverage (o CI roda com coverage numa máquina mais lenta); com o macOS
// ocupando ~2 núcleos (12/10), cai para 1,6×: de 280 a 770 ms sem coverage
// (linkSemFecharB, sozinho ou com a suíte em paralelo) e até 1.864 ms com
// coverage. A garantia contra o quadrático é a razão de escala t(n)/t(n/4): o
// linear deu até 7,8 no arquivo sozinho e 7,2 na suíte inteira com coverage; com
// carga, a 1ª tentativa passou de 8 em 7 de 839 medidas (até 14), e o retry
// refez todas com 4,2 a 6,4. O quadrático dá de 10 a 44 (mutantes da 1ª rodada a
// 64 KiB); o mais fraco, o indexOf do finalize, de 9,5 a 12,7 a 512 KiB nas três
// tentativas.
const CEILING_MS = 3_000
const MAX_RATIO = 8

describe('bateria patológica no limite de 512 KiB', () => {
  const N = MARKDOWN_LIMITS.maxBytes
  const time = (md: string) => {
    const t = performance.now()
    markdownToNote(md, { newId: counter() })
    return performance.now() - t
  }
  /**
   * Até 6 pares em seguida, o pequeno e logo depois o grande; a razão é a do
   * menor grande pelo menor pequeno dos pares feitos. Com os dois mínimos em
   * janelas separadas (3 grandes, depois 3 pequenos), a carga que mudava entre
   * elas (outro worker, núcleo de eficiência) ia para a razão, e a suíte inteira
   * dava falso vermelho; intercalados, os dois vêm da mesma janela. A razão de
   * um par só não serve: nos dois primeiros pares o pequeno ainda pode pagar o
   * JIT frio do caso (até 5× mais lento com carga), e a menor razão de um par
   * deixava passar um quadrático fraco. Por isso a conta só para a partir do 3º
   * par, no primeiro em que teto e razão passam (o veredito é o melhor do 3º ao
   * 6º), ou depois de um grande acima do dobro do teto (aí já é quadrático, e
   * mais pares só atrasam a falha).
   */
  const measure = (big: string, small: string) => {
    let tBig = Infinity
    let tSmall = Infinity
    let ratio = Infinity
    for (let k = 0; k < 6; k++) {
      tSmall = Math.min(tSmall, time(small))
      const t = time(big)
      tBig = Math.min(tBig, t)
      if (k >= 2) ratio = Math.min(ratio, tBig / Math.max(tSmall, 1))
      if ((tBig < CEILING_MS && ratio < MAX_RATIO) || t > 2 * CEILING_MS) break
    }
    return { tBig, ratio }
  }

  // O tamanho é conferido aqui, na geração que o caso já faz: um teste à parte
  // gerava os 64 casos de novo (1,5 s sozinho) no timeout padrão de 5 s. O retry
  // só salva o linear que pegou carga do 3º ao 6º par: o quadrático fica acima
  // de 8 nas três tentativas.
  it.each(Object.entries(PATHOLOGICAL))('%s', { timeout: 60_000, retry: 2 }, (_name, gen) => {
    const big = gen(N)
    const small = gen(N / 4)
    expect(utf8(big), 'bytes do grande').toBe(N)
    expect(utf8(small), 'bytes do pequeno').toBe(N / 4)
    const { tBig, ratio } = measure(big, small)
    expect(tBig, 'menor tempo do grande (ms)').toBeLessThan(CEILING_MS)
    expect(ratio, 'razão t(n)/t(n/4) dos mínimos').toBeLessThan(MAX_RATIO)
  })
})

describe('desempenho', () => {
  // Nota de 5000 blocos perto de 2 MiB canônicos.
  const big = (() => {
    const content = Array.from({ length: 5000 }, (_, i) => ({ type: i % 4 === 0 ? 'bulletListItem' : 'paragraph', content: [T(`Bloco ${i} ${'palavra '.repeat(20)}*x* [y] <z> | _w_`, i % 3 ? { bold: true } : {})] }))
    const norm = normalizeNoteContent(content, { newId: counter('big') })
    if (!norm.ok) throw new Error(JSON.stringify(norm.issues))
    return norm.blocks
  })()

  it('render e texto de 5000 blocos (~2 MiB): bem abaixo do teto', () => {
    expect(JSON.stringify(big).length).toBeGreaterThan(1_500_000)
    const t = performance.now()
    const r = blocksToMarkdown(big)
    const text = blocksToText(big)
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    expect(r.markdown.length).toBeGreaterThan(800_000)
    expect(text.length).toBeGreaterThan(500_000)
  }, 60_000)

  it('regravar 512 KiB de Markdown sobre essa nota (reconciliação): bem abaixo do teto, e o que não mudou fica', () => {
    const md = blocksToMarkdown(big).markdown
    const lines = md.split('\n')
    lines[100] = 'Editado pela IA'
    const cut = lines.join('\n').slice(0, MARKDOWN_LIMITS.maxBytes)
    const t = performance.now()
    const r = markdownToNote(cut, { existing: big, newId: counter('e') })
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.blocks.filter(b => b.id.startsWith('big-')).length).toBeGreaterThan(r.blocks.length - 3)
  }, 60_000)
})

describe('parser-023: linear sem mudar o resultado (espaço e tab, título ATX, autolink literal, imagem e quebras)', () => {
  it('os cortes por laço dão o mesmo que as regex antigas (propriedade com semente fixa)', () => {
    const rand = mulberry32(23)
    const alphabet = [' ', '\t', '#', '\\', 'a', '\u00a0']
    const bad: string[] = []
    for (let k = 0; k < 20_000; k++) {
      let s = ''
      const len = Math.floor(rand() * 12)
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)]
      if (trimEndSpaceTab(s) !== s.replace(/[ \t]+$/, '')) bad.push(`trimEnd ${JSON.stringify(s)}`)
      if (trimSpaceTab(s) !== s.replace(/^[ \t]+|[ \t]+$/g, '')) bad.push(`trim ${JSON.stringify(s)}`)
      if (stripClosingHashes(s) !== s.replace(/^[ \t]*#+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '')) bad.push(`atx ${JSON.stringify(s)}`)
    }
    expect(bad).toEqual([])
    // splitRow por trechos dá o mesmo que a soma caractere a caractere.
    const splitReference = (raw: string) => {
      const s = raw.replace(/^[ \t]+|[ \t]+$/g, '')
      const cells: string[] = []
      let cur = ''
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 1 < s.length) cur += s[++i] === '|' ? '|' : `\\${s[i]}`
        else if (s[i] === '|') {
          cells.push(cur)
          cur = ''
        } else cur += s[i]
      }
      cells.push(cur)
      if (s.startsWith('|')) cells.shift()
      if (/(^|[^\\])(\\\\)*\|$/.test(s) && cells.length > 0) cells.pop()
      return cells.map(c => c.replace(/^[ \t]+|[ \t]+$/g, ''))
    }
    const cellChars = ['|', '|', '\\', 'a', ' ', '\t', '\u00a0', '`']
    for (let k = 0; k < 20_000; k++) {
      let s = ''
      const len = Math.floor(rand() * 12)
      for (let i = 0; i < len; i++) s += cellChars[Math.floor(rand() * cellChars.length)]
      if (JSON.stringify(splitRow(s)) !== JSON.stringify(splitReference(s))) bad.push(`splitRow ${JSON.stringify(s)}`)
    }
    expect(bad).toEqual([])
    // NBSP não é espaço do CommonMark (o trim() do JS o tiraria).
    expect(trimSpaceTab('\u00a0 a\t\u00a0')).toBe('\u00a0 a\t\u00a0')
    expect(read('# foo#\n# foo \\#\n# a\t##\t\n# #')).toEqual([
      { t: 'heading', c: 'foo#' }, { t: 'heading', c: 'foo #' }, { t: 'heading', c: 'a' }, { t: 'heading', c: [] },
    ])
  })

  // A conta direta do autolink literal, como antes da memorização: o fim da
  // corrida, o corte da pontuação final e o domínio só até o corte.
  function literalReference(s: string): string[] {
    const hrefs: string[] = []
    let pos = 0
    for (const m of s.matchAll(/(?<![A-Za-z])https?:\/\/|(?<![^\s*_~([\]])www\./gi)) {
      if (m.index < pos) continue
      const from = m.index + m[0].length
      let end = from
      while (end < s.length && s[end] !== ' ' && s[end] !== '<' && !(s[end] === ']' && '(['.includes(s[end + 1] || '-'))) end++
      const count = (c: string) => s.slice(from, end).split(c).length - 1
      for (;;) {
        const ch = s[end - 1]
        const entity = /&[A-Za-z0-9]+;$/.exec(s.slice(from, end))
        if (end <= from) break
        else if ('?!.,:*_~\'"'.includes(ch)) end--
        else if (ch === ')' && count(')') > count('(')) end--
        else if (ch === ';' && entity) end = from + entity.index
        else break
      }
      const domain = /^[\w.-]*/.exec(s.slice(from, end))?.[0] ?? ''
      if (!/[^.]/.test(domain) || domain.split('.').slice(-2).some(g => g.includes('_'))) continue
      hrefs.push(`${/^w/i.test(m[0]) ? 'http://' : ''}${s.slice(m.index, end)}`)
      pos = end
    }
    return hrefs
  }

  it('autolink literal: o mesmo resultado da conta direta (propriedade com semente fixa)', () => {
    const rand = mulberry32(230)
    const tokens = ['http://', 'www.', 'WWW.', '_', '_', '.', '.', '(', ')', ')', ';', '&a;', '&amp;', '&', 'a', 'b', '-', '?', ',', ':', '*', '~', "'", ' ', ']', '](', '/']
    const bad: string[] = []
    let links = 0
    for (let k = 0; k < 20_000; k++) {
      let s = ''
      const len = 1 + Math.floor(rand() * 20)
      for (let i = 0; i < len; i++) s += tokens[Math.floor(rand() * tokens.length)]
      const got = parseInline(s).flatMap(p => (p.kind === 'text' && p.href !== null ? [p.href] : []))
      const want = literalReference(s)
      links += want.length
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(s)}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`)
    }
    expect(bad.slice(0, 5)).toEqual([])
    expect(links).toBeGreaterThan(2_000)
  })

  it('autolink literal: parênteses e entidade no fim, domínio cortado no fim e gatilho recusado', () => {
    const pieces = (s: string) => parseInline(s).map(p => (p.kind === 'text' && p.href !== null ? [p.href, p.text] : p.kind === 'text' ? p.text : p.kind))
    expect(pieces('http://a.co/' + ')'.repeat(5))).toEqual([['http://a.co/', 'http://a.co/'], ')))))'])
    expect(pieces('www.a.co/)))')).toEqual([['http://www.a.co/', 'www.a.co/'], ')))'])
    expect(pieces('http://a.co/(b))')).toEqual([['http://a.co/(b)', 'http://a.co/(b)'], ')'])
    expect(pieces('http://a.co/x&amp;')).toEqual([['http://a.co/x', 'http://a.co/x'], '&'])
    // O `&` antes do gatilho não faz entidade com o `;` do fim.
    expect(pieces('a&b http://x.co/c;')).toEqual(['a&b ', ['http://x.co/c;', 'http://x.co/c;']])
    // `.` e `_` do fim saem do domínio só quando tudo depois dele sai como pontuação final.
    expect(pieces('www.a.b_')).toEqual([['http://www.a.b', 'www.a.b'], '_'])
    expect(pieces('www.a.b_(')).toEqual(['www.a.b', '_', '('])
    expect(pieces('www.a_.b.')).toEqual(['www.a', '_', '.b.'])
    expect(pieces('www.a_.b.(')).toEqual([['http://www.a_.b.(', 'www.a_.b.(']])
    expect(pieces('(http://(http://a.co)')).toEqual(['(http://(', ['http://a.co', 'http://a.co'], ')'])
    // Dois gatilhos na mesma corrida: o 2º reaproveita o domínio (cortado no começo) e o fim da corrida.
    expect(pieces('www._www.a')).toEqual(['www.', '_', ['http://www.a', 'www.a']])
    expect(pieces('(www.a.b_(www.a.b_')).toEqual(['(www.a.b', '_', '(', ['http://www.a.b', 'www.a.b'], '_'])
    expect(read('| a |\n|---|\n| http://a.co/))) |')).toEqual([{ t: 'table', c: [['a'], [[{ href: 'http://a.co/', c: 'http://a.co/' }, ')))']]] }])
  })

  it('imagem seguida de quebras duras: as quebras das bordas saem, no parágrafo e no item', () => {
    expect(read(`![a](${IMG})\\\n\\\n b`)).toEqual([{ t: 'image', p: { url: IMG, name: 'a' } }, { t: 'paragraph', c: 'b' }])
    expect(read(`a \\\n![a](${IMG}) \\\n\\\nb`)).toEqual([{ t: 'paragraph', c: 'a' }, { t: 'image', p: { url: IMG, name: 'a' } }, { t: 'paragraph', c: 'b' }])
    expect(read(`- ![a](${IMG})\\\n  \\\n  b`)).toEqual([{ t: 'bulletListItem', c: 'b', ch: [{ t: 'image', p: { url: IMG, name: 'a' } }] }])
  })

  it('regravar sobre nota com 64 Ki espaços (e tabs) no meio de um parágrafo e de um título: bem abaixo do teto, e o que não mudou fica', () => {
    const run = 1 << 16
    const norm = normalizeNoteContent([p(T(`a${' '.repeat(run)}b`)), { type: 'heading', content: [T(`c${'\t'.repeat(run)}d`)] }], { newId: counter('s') })
    if (!norm.ok) throw new Error(JSON.stringify(norm.issues))
    let t = performance.now()
    const r = markdownToNote('x', { existing: norm.blocks, newId: counter('e') })
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    expect(r.ok).toBe(true)
    t = performance.now()
    const same = markdownToNote(blocksToMarkdown(norm.blocks).markdown, { existing: norm.blocks, newId: counter('e') })
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    if (!same.ok) throw new Error(JSON.stringify(same.issues))
    expect(same.blocks).toEqual(norm.blocks)
  }, 60_000)
})

describe('noteLimitIssues (a conferência da nota juntada)', () => {
  const block = (id: string, children: unknown[] = []) => ({ id, type: 'paragraph', children })

  it('nota no limite passa; a forma não importa (só ids, blocos, profundidade e bytes)', () => {
    expect(noteLimitIssues([block('a'), { id: 'b', type: 'x', props: 5 }, 'lixo', null])).toEqual([])
  })

  it('id repetido é fatal; blocos, profundidade e bytes são contrato', () => {
    expect(noteLimitIssues([block('a'), block('b', [block('a')])])).toEqual([{ path: '/1/children/0/id', keyword: 'duplicateId', message: 'Id repetido no documento (o primeiro está em /0)', fatal: true }])
    expect(noteLimitIssues([block('a'), block('b'), block('c')], { limits: { maxBlocks: 2 } }).map(i => i.keyword)).toEqual(['maxBlocks'])
    let deep = block('z')
    for (let i = 0; i < 70; i++) deep = block(`d${i}`, [deep])
    expect(noteLimitIssues([deep]).map(i => [i.keyword, i.path])).toEqual([['maxDepth', '/0/children/0/children/0/children/0/children/0/children/0/children/0/children/0/children/0/children/0/children']])
    expect(noteLimitIssues([{ id: 'a', type: 'paragraph', content: 'x'.repeat(100) }], { limits: { maxBytes: 50 } }).map(i => i.keyword)).toEqual(['maxBytes'])
    expect(noteLimitIssues({}).map(i => [i.keyword, i.fatal])).toEqual([['type', true]])
    expect(HARD_MAX_DEPTH).toBe(64)
  })
})

// ── Revisão do lote 05: render, reconciliação e limites da nota ──────────────

describe('render-023: \\r e BOM, linha em branco, tetos da tabela, ids e reconciliação', () => {
  // Por código: o editor de texto não mostra esses caracteres.
  const [NBSP, IDEOGRAPHIC, EM, BOM] = [0xa0, 0x3000, 0x2003, 0xfeff].map(c => String.fromCharCode(c))
  const ids = counter('r')
  const norm = (blocks: unknown[]) => {
    const r = normalizeNoteContent(blocks, { newId: ids })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return r.blocks
  }
  /** Sem perdas, sem \r na saída, a leitura dá a mesma nota e, com ela como atual, os mesmos ids. */
  const roundTrip = (blocks: NoteBlock[]) => {
    const r = blocksToMarkdown(blocks)
    expect(r.markdown).not.toMatch(/\r/)
    expect(r.losses).toEqual([])
    expect(strip(ok(r.markdown).blocks)).toEqual(strip(blocks))
    expect(ok(r.markdown, { existing: blocks }).blocks).toEqual(blocks)
    return r.markdown
  }
  const props = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
  const P = (id: string, text: string) => ({ id, type: 'paragraph', props, content: [T(text)], children: [] })

  it('R12: \\r no texto em linha sai como &#13;, e o BOM no começo da linha como &#65279;; a ida e volta é exata', () => {
    const note = norm([
      p(T('linha 1\r\nlinha 2')),
      { type: 'heading', props: { level: 2 }, content: [T('a\rb')] },
      { type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [[T('c\rd')], [T('e')]] }, { cells: [[T('f')], [T('\r')]] }] } },
      { type: 'bulletListItem', content: [T('\rx')] },
      { type: 'quote', content: [T('q\r')] },
    ])
    expect(roundTrip(note)).toBe('linha 1&#13;\\\nlinha 2\n\n## a&#13;b\n\n| c&#13;d | e |\n| --- | --- |\n| f | &#13; |\n\n- &#13;x\n\n> q&#13;\n')
    // O texto não vira estrutura (título, lista, setext, dois parágrafos).
    for (const text of ['a\r# T', 'a\r- item', 'a\r---', 'a\r\rb']) roundTrip(norm([p(T(text))]))
    // A leitura tira o BOM do começo do documento: o do título sumia, e o parágrafo só com ele também.
    expect(roundTrip(norm([p(T(`${BOM}Título`)), p(T(`a${BOM}`)), p(T(BOM))]))).toBe(`&#65279;Título\n\na${BOM}\n\n&#65279;\n`)
  })

  it('R12: no código não há entidade: o \\r vira \\n com perda (codeLineEnding), o código em linha sai como texto (codeSpan) e a url da imagem perde CR e LF (imageProps)', () => {
    const r = blocksToMarkdown([
      { id: 'c', type: 'codeBlock', props: { language: 'ts' }, content: [T('a = 1\r\nb = 2\rc')] },
      { id: 'p', type: 'paragraph', content: [T('x'), T('y\rz', { code: true }), T('w')] },
      { id: 'h', type: 'heading', props: { level: 1 }, content: [T('k\r', { code: true })] },
      { id: 't', type: 'table', content: { type: 'tableContent', headerRows: 1, headerCols: 1, rows: [{ cells: [[T('m\rn', { code: true })]] }] } },
      { id: 'i', type: 'image', props: { url: 'u/p\r\n1.png', name: 'n\ra', caption: 'c\rd' } },
    ])
    expect(r.markdown).toBe('```ts\na = 1\nb = 2\nc\n```\n\nxy&#13;zw\n\n# k&#13;\n\n| m&#13;n |\n| --- |\n\n![n a](u/p1.png "c d")\n')
    expect(r.losses).toEqual([
      { path: '/0/content', kind: 'codeLineEnding' }, { path: '/1/content', kind: 'codeSpan' }, { path: '/2/content', kind: 'codeSpan' },
      { path: '/3/content/rows/0/cells/0/content', kind: 'codeSpan' }, { path: '/4/props', kind: 'imageProps' },
    ])
  })

  // A nota da 1ª rodada: o \r cru deslocava o mapa de linhas, e o título, a lista e o fim voltavam com id novo, sem cor e sem alinhamento.
  const crNote = [
    P('a', 'a\rb'),
    { id: 'h', type: 'heading', props: { ...props, textColor: 'red', textAlignment: 'center', level: 2, isToggleable: false }, content: [T('T')], children: [] },
    { id: 'l', type: 'bulletListItem', props, content: [T('item')], children: [] },
    P('e', 'end'),
  ]

  it('R12: a nota com \\r volta igual pelo mesmo Markdown, sem perdas', () => {
    const r = ok(blocksToMarkdown(crNote).markdown, { existing: crNote })
    expect(r.blocks).toEqual(crNote)
    expect(r.losses).toEqual([])
  })

  it('R12 (defesa no plan): se o render emitisse \\r cru, só aquele bloco deixaria de bater; os seguintes voltam intactos', async () => {
    vi.resetModules()
    vi.doMock('./render.ts', async importOriginal => {
      const mod = await importOriginal() as { blocksToMarkdown: typeof blocksToMarkdown }
      const withRawCR = (blocks: unknown, opts?: RenderOptions) => {
        const r = mod.blocksToMarkdown(blocks, opts)
        return { ...r, markdown: r.markdown.replace('&#13;', '\r') }
      }
      return { ...mod, blocksToMarkdown: withRawCR }
    })
    try {
      const { markdownToNote: toNote } = await import('./markdown.ts')
      const r = toNote(blocksToMarkdown(crNote).markdown, { existing: crNote, newId: counter() })
      expect(r.ok && r.blocks.map(b => b.id)).toEqual(['n-1', 'h', 'l', 'e'])
    } finally {
      vi.doUnmock('./render.ts')
      vi.resetModules()
    }
  })

  it('R12/R7: a saída do render nunca tem \\r (notas geradas, com os espaços Unicode, \\r, \\r\\n e o BOM no alfabeto, e as fixtures)', () => {
    const next = noteGenerator(20261011)
    const alphabet = new Map([['NBSP', NBSP], ['U+3000', IDEOGRAPHIC], ['U+2003', EM], ['\\f', '\f'], ['\\v', '\v'], ['\\r', '\r'], ['\\r\\n', '\r\n'], ['BOM', BOM]])
    const seen = new Set<string>()
    const failures: string[] = []
    let bomFirst = 0
    for (let i = 0; i < 300; i++) {
      const blocks = norm(next())
      const strings: string[] = []
      JSON.stringify(blocks, (_k, v: unknown) => {
        if (typeof v === 'string') strings.push(v)
        return v
      })
      const text = strings.join(' ')
      for (const [name, ch] of alphabet) if (text.includes(ch)) seen.add(name)
      const md = blocksToMarkdown(blocks).markdown
      if (md.includes('\r')) failures.push(`#${i}`)
      if (md.startsWith('&#65279;')) bomFirst++
    }
    for (const [name, content] of [...VALID, ...PARTIAL, ...FATAL.map(([n, f]) => [n, f.content] as [string, unknown])]) {
      if (blocksToMarkdown(content).markdown.includes('\r')) failures.push(name)
    }
    expect(failures).toEqual([])
    expect([...seen].sort()).toEqual([...alphabet.keys()].sort())
    expect(bomFirst).toBeGreaterThan(0)
  }, 60_000)

  const SPACES = [NBSP, IDEOGRAPHIC, EM, '\f', '\v']
  const COMBOS: [string, string][] = [['bulletListItem', 'bulletListItem'], ['numberedListItem', 'numberedListItem'], ['bulletListItem', 'numberedListItem'], ['numberedListItem', 'bulletListItem']]

  it('R7: o 1º subitem só com espaço que não é espaço nem tab (NBSP, U+3000, U+2003, \\f, \\v) interrompe o parágrafo do pai, como no CommonMark', () => {
    for (const ch of SPACES) {
      for (const [parent, child] of COMBOS) {
        const lead = parent === 'bulletListItem' ? '- ' : '1. '
        const pad = ' '.repeat(lead.length)
        const marker = (k: number) => (child === 'bulletListItem' ? '- ' : `${k}. `)
        const md = `${lead}Tarefas\n${pad}${marker(1)}${ch}\n${pad}${marker(2)}comprar pão\n`
        expect(read(md), `${JSON.stringify(ch)} ${parent}/${child}`).toEqual([{ t: parent, c: 'Tarefas', ch: [{ t: child, c: ch }, { t: child, c: 'comprar pão' }] }])
      }
    }
    // As outras decisões de linha em branco: a linha só com NBSP é linha da tabela e do código indentado.
    expect(read(`| a |\n| --- |\n${NBSP}\n`)).toEqual([{ t: 'table', c: [['a'], [NBSP]] }])
    expect(read(`    a\n    ${NBSP}\n`)).toEqual([{ t: 'codeBlock', c: `a\n${NBSP}` }])
  })

  it('R7: o render põe linha em branco antes da sublista cujo 1º item é só espaço (por qualquer regra); a regravação mantém a sublista', () => {
    expect(render([{ type: 'bulletListItem', content: [T('Tarefas')], children: [{ type: 'bulletListItem', content: [T(NBSP)] }, { type: 'bulletListItem', content: [T('comprar pão')] }] }]).markdown)
      .toBe(`- Tarefas\n\n  - ${NBSP}\n  - comprar pão\n`)
    for (const ch of SPACES) {
      for (const [parent, child] of COMBOS) {
        const note = norm([{ type: parent, content: [T('Tarefas')], children: [{ type: child, content: [T(ch)] }, { type: child, content: [T('comprar pão')] }, { type: child, content: [T('pagar a conta')] }] }])
        const md = roundTrip(note)
        // A IA corrige uma palavra num subitem: a sublista continua sublista.
        const edited = ok(md.replace('pão', 'leite'), { existing: note })
        expect(compact(edited.blocks), `${JSON.stringify(ch)} ${parent}/${child}`).toEqual([{ t: parent, c: 'Tarefas', ch: [{ t: child, c: ch }, { t: child, c: 'comprar leite' }, { t: child, c: 'pagar a conta' }] }])
      }
    }
  })

  /** O withUniqueIds de antes da correção (quadrático): a referência dos ids. */
  const uniqueIdsBefore = (content: unknown[]): unknown[] => {
    const isObj = (v: unknown): v is Block => typeof v === 'object' && v !== null && !Array.isArray(v)
    const taken = new Set<string>()
    const collect = (list: unknown[]): void => {
      for (const b of list) {
        if (!isObj(b)) continue
        if (typeof b.id === 'string' && b.id !== '') taken.add(b.id)
        if (Array.isArray(b.children)) collect(b.children)
      }
    }
    collect(content)
    const seen = new Set<string>()
    const fresh = (base: string): string => {
      let n = 2
      while (taken.has(`${base}-${n}`)) n++
      taken.add(`${base}-${n}`)
      return `${base}-${n}`
    }
    const walk = (list: unknown[]): unknown[] => list.map(b => {
      if (!isObj(b)) return b
      const valid = typeof b.id === 'string' && b.id !== '' && !seen.has(b.id)
      const id = valid ? (b.id as string) : fresh(typeof b.id === 'string' && b.id !== '' ? b.id.slice(0, 100) : 'bloco')
      seen.add(id)
      return Array.isArray(b.children) ? { ...b, id, children: walk(b.children) } : { ...b, id }
    })
    return walk(content)
  }

  it('R8: withUniqueIds dá os mesmos ids de antes (repetidos, sem id, que parecem gerados, aninhados)', () => {
    const tricky = [
      { id: 'a' }, { id: 'a' }, { id: 'a-2' }, { id: 'a' }, {}, { id: '' }, { id: 5 }, { id: 'bloco-2' }, {},
      { id: 'a', children: [{ id: 'a' }, { id: 'a-3' }, {}] }, { id: 'a-4' }, null,
    ]
    const flat = (list: unknown[]): unknown[] => list.map(b => (b && typeof b === 'object' ? [(b as Block).id, ...(Array.isArray((b as Block).children) ? [flat((b as Block).children as unknown[])] : [])] : b))
    expect(flat(withUniqueIds(tricky))).toEqual([
      ['a'], ['a-5'], ['a-2'], ['a-6'], ['bloco-3'], ['bloco-4'], ['bloco-5'], ['bloco-2'], ['bloco-6'],
      ['a-7', [['a-8'], ['a-3'], ['bloco-7']]], ['a-4'], null,
    ])
    const rand = mulberry32(8)
    const pool: unknown[] = ['x', 'x', 'x-2', 'x-3', 'x-2-2', 'bloco', 'bloco-2', 'bloco-3', 'y', '', undefined, 7]
    const gen = (depth: number): unknown[] => Array.from({ length: 1 + Math.floor(rand() * 6) }, () => {
      const b: Block = { type: 'paragraph' }
      const id = pool[Math.floor(rand() * pool.length)]
      if (id !== undefined) b.id = id
      if (depth < 3 && rand() < 0.3) b.children = gen(depth + 1)
      return b
    })
    for (let k = 0; k < 300; k++) {
      const note = gen(1)
      expect(withUniqueIds(note)).toEqual(uniqueIdsBefore(note))
    }
  })

  it('R8: 20 mil blocos sem id ou com o mesmo id (render e regravação) e 80 mil grupos sem projeção (reconcile): lineares', () => {
    const noIds = Array.from({ length: 20_000 }, (_, i) => ({ type: 'paragraph', content: [T(`p${i}`)] }))
    for (const note of [noIds, noIds.map(b => ({ ...b, id: 'x' }))]) {
      let t = performance.now()
      expect(blocksToMarkdown(note).blocks).toHaveLength(20_000)
      expect(performance.now() - t).toBeLessThan(CEILING_MS)
      t = performance.now()
      expect(markdownToNote('x', { existing: note }).ok).toBe(true)
      expect(performance.now() - t).toBeLessThan(CEILING_MS)
    }
    const groups = [{ keys: ['a'] }, ...Array.from({ length: 80_000 }, () => ({ keys: [], keepIfHidden: true })), { keys: ['b'] }]
    const t = performance.now()
    expect(reconcile(groups, ['a', 'b']).slots).toHaveLength(80_002)
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
  }, 60_000)

  const table = (rows: unknown[]) => [{ id: 't', type: 'table', props: {}, content: { type: 'tableContent', headerRows: 1, rows }, children: [] }]
  const span50 = { type: 'tableCell', props: { colspan: 50 }, content: [] }
  const wideRow = { cells: Array.from({ length: 20 }, () => span50) }

  it('R9: tabela acima dos tetos do validador (100 colunas ou 10 mil células, largura sem corte) é ilegível, sem montar a grade', () => {
    expect(blocksToMarkdown(table([wideRow, ...Array.from({ length: 2000 }, () => ({ cells: [''] }))]))).toEqual({ markdown: '', losses: [{ path: '/0', kind: 'unreadable' }], blocks: [] })
    const cols = (n: number) => ({ cells: Array.from({ length: n }, () => 'a') })
    const unreadable = { path: '/0', kind: 'unreadable' }
    expect(blocksToMarkdown(table([cols(100)])).losses).not.toContainEqual(unreadable)
    expect(blocksToMarkdown(table([cols(101)])).losses).toEqual([unreadable])
    expect(blocksToMarkdown(table(Array.from({ length: 100 }, () => cols(100)))).losses).not.toContainEqual(unreadable)
    expect(blocksToMarkdown(table([...Array.from({ length: 100 }, () => cols(100)), cols(1)])).losses).toEqual([unreadable])
  })

  it('R9: linha de tabela que não é objeto com cells fica de fora, com a perda (não vira linha vazia da largura toda)', () => {
    const r = blocksToMarkdown(table([{ cells: ['a', 'b'] }, 0, null, 'x', { cells: 'não' }, { cells: ['c', 'd'] }]))
    expect(r.markdown).toBe('| a | b |\n| --- | --- |\n| c | d |\n')
    expect(r.losses.filter(l => l.kind === 'unreadable').map(l => l.path)).toEqual(['/0/content/rows/1', '/0/content/rows/2', '/0/content/rows/3', '/0/content/rows/4'])
    expect(blocksToMarkdown(table([0, null])).losses).toEqual([{ path: '/0', kind: 'unreadable' }])
    // A célula que não cabe na grade (a de cima ocupa a coluna) também sai com a perda, não calada.
    const over = blocksToMarkdown(table([{ cells: [{ type: 'tableCell', props: { rowspan: 2 }, content: [T('a')] }, 'b'] }, { cells: ['c', 'd'] }]))
    expect(over.markdown).toBe('| a | b |\n| --- | --- |\n|  | c |\n')
    expect(over.losses).toContainEqual({ path: '/0/content/rows/1/cells/1', kind: 'unreadable' })
  })

  it('R9: a nota do cenário (largura 1000 e 40 mil linhas) não infla a leitura nem a regravação em Markdown', () => {
    const existing = table([wideRow, ...Array.from({ length: 40_000 }, () => ({ cells: [''] }))])
    let t = performance.now()
    expect(blocksToMarkdown(existing).markdown).toBe('')
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    t = performance.now()
    const r = ok('# Nota refeita', { existing })
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    expect(compact(r.blocks)).toEqual([{ t: 'heading', c: 'Nota refeita' }])
    expect(r.losses).toEqual([{ path: '/0', kind: 'unreadable' }])
  })

  it('R9 (defesa no plan): se o render da nota atual estourasse um teto da leitura (120 colunas), a regravação segue sem reconciliar', async () => {
    vi.resetModules()
    vi.doMock('./render.ts', async importOriginal => {
      const mod = await importOriginal() as { blocksToMarkdown: typeof blocksToMarkdown }
      const tooWide = (blocks: unknown, opts?: RenderOptions) => ({ ...mod.blocksToMarkdown(blocks, opts), markdown: `|${' a |'.repeat(120)}\n|${' - |'.repeat(120)}\n` })
      return { ...mod, blocksToMarkdown: tooWide }
    })
    try {
      const { markdownToNote: toNote } = await import('./markdown.ts')
      const r = toNote('um', { existing: [P('um', 'um')], newId: counter() })
      expect(r.ok && r.blocks.map(b => b.id)).toEqual(['n-1'])
    } finally {
      vi.doUnmock('./render.ts')
      vi.resetModules()
    }
  })

  it('R9: o teto de saída do render: a nota fora do contrato que incharia a leitura para nele, com a perda dos blocos de depois', () => {
    // 300 tabelas 100×100 de células vazias (~1,3 KB de JSON cada) dariam 9 MB de Markdown.
    const grid = { type: 'table', content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [span50, span50] }, ...Array.from({ length: 99 }, () => ({ cells: [] }))] } }
    const t = performance.now()
    const r = blocksToMarkdown(Array.from({ length: 300 }, () => grid))
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    // O teto vale dentro do bloco: a tabela que o passaria sai inteira (linhas, mapa e perdas dela).
    expect(r.markdown.length).toBeLessThanOrEqual(RENDER_BUDGET)
    expect(r.markdown.length).toBeGreaterThan(RENDER_BUDGET - 40_000)
    expect(r.markdown).toBe(blocksToMarkdown(Array.from({ length: r.blocks.length }, () => grid)).markdown)
    const cut = r.losses.filter(l => l.kind === 'truncated').map(l => l.path)
    expect(cut.length).toBe(300 - r.blocks.length)
    expect(cut[0]).toBe(`/${r.blocks.length}`)
    expect(r.losses.filter(l => l.kind === 'mergedCells')).toHaveLength(2 * r.blocks.length)
    expect(r.losses.some(l => l.kind === 'unreadable')).toBe(false)
  })

  it('R10: bloco herdado fatal e invisível no Markdown sai com a perda e não trava a regravação (mesmo Markdown, ou com um parágrafo no fim)', () => {
    const hidden: [unknown, LossKind][] = [
      [null, 'unreadable'], ['lixo', 'unreadable'],
      [{ id: 'x', type: 'callout', props: {}, content: [], children: [] }, 'unreadable'],
      [{ id: 'x', type: 'table', props: {}, content: { type: 'tableContent', headerRows: 1, rows: [] }, children: [] }, 'unreadable'],
      [{ id: 'x', type: 'paragraph', props, content: 5, children: [] }, 'emptyParagraph'],
    ]
    for (const [x, kind] of hidden) {
      const existing = [P('um', 'um'), x, P('dois', 'dois')]
      const md = blocksToMarkdown(existing).markdown
      expect(md).toBe('um\n\ndois\n')
      const same = ok(md, { existing })
      expect(same.blocks.map(b => b.id), JSON.stringify(x)).toEqual(['um', 'dois'])
      const more = ok(`${md}\ntrês\n`, { existing })
      expect(more.blocks.map(b => b.id)).toEqual(['um', 'dois', 'n-1'])
      for (const r of [same, more]) expect(r.losses).toEqual([{ path: '/1', kind }])
    }
    // O parágrafo vazio ao lado continua voltando (ele passa no fatal).
    const withEmpty = [P('um', 'um'), { id: 'e', type: 'paragraph', props, content: [], children: [] }, null, P('dois', 'dois')]
    expect(ok('um\n\ndois\n', { existing: withEmpty }).blocks.map(b => b.id)).toEqual(['um', 'e', 'dois'])
  })

  it('R10 (defesa): bloco antigo que não é objeto nunca vira entrada da nota, mesmo se a reconciliação o devolvesse', async () => {
    vi.resetModules()
    vi.doMock('./reconcile.ts', async importOriginal => ({
      ...(await importOriginal() as object),
      reconcile: () => ({ slots: [{ kind: 'old', index: 0, mode: 'intact', first: 0 }, { kind: 'old', index: 1, mode: 'intact', first: -1 }], fate: ['intact', 'intact'] }),
    }))
    try {
      const { markdownToNote: toNote } = await import('./markdown.ts')
      const r = toNote('um', { existing: [P('um', 'um'), null], newId: counter() })
      expect(r.ok && r.blocks.map(b => b.id)).toEqual(['um'])
    } finally {
      vi.doUnmock('./reconcile.ts')
      vi.resetModules()
    }
  })

  const grid50 = (tag: string) => ({ type: 'table', content: { type: 'tableContent', headerRows: 1, rows: Array.from({ length: 50 }, () => ({ cells: Array.from({ length: 50 }, () => [T(tag)]) })) } })

  it('R11: o teto de células da nota inteira vale na nota juntada (substituir e anexar), contra o custo da nota atual', () => {
    const two = norm([grid50('a'), grid50('b')])
    const third = blocksToMarkdown(norm([grid50('c')])).markdown
    // Substituir: as duas ficam intactas e a 3ª soma (Σ células² = 3 × 2.500² > 2 × 2.500²).
    expect(issues(`${blocksToMarkdown(two).markdown}\n${third}`, { existing: two })).toEqual([{ line: 105, keyword: 'maxCells' }])
    // Anexar: a 3ª passa sozinha no normalize; a nota juntada, não.
    expect(issues(third, { existing: two, mode: 'append' })).toEqual([{ line: 1, keyword: 'maxCells' }])
    // Nota antiga já acima do teto: regravar ou anexar sem somar tabela passa; somar mais uma, não.
    const three = [...two, ...norm([grid50('c')])]
    expect(noteTableCost(three)).toBe(3 * 2500 ** 2)
    expect(ok(`texto\n\n${blocksToMarkdown(three).markdown}`, { existing: three }).blocks.slice(1)).toEqual(three)
    expect(ok('texto', { existing: three, mode: 'append' }).blocks).toHaveLength(1)
    expect(issues(third, { existing: three, mode: 'append' })).toEqual([{ line: 1, keyword: 'maxCells' }])
  }, 60_000)

  it('R11 (fase 1): na nota acima do teto, editar uma célula de cada tabela ou encolher as três passa; o teto de cada tabela continua', () => {
    const table = (tag: string, rows: number, edit = false) => {
      const t = { type: 'table', content: { type: 'tableContent', headerRows: 1, rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: 50 }, (): unknown => [T(tag)]) })) } }
      if (edit) t.content.rows[1].cells[0] = [T('editada')]
      return t
    }
    const md = (tables: unknown[]) => tables.map(t => blocksToMarkdown([t]).markdown).join('\n')
    const three = ['a', 'b', 'c'].flatMap(tag => norm([table(tag, 50)]))
    expect(noteTableCost(three)).toBe(3 * 2500 ** 2)
    // As três editadas viram blocos novos (a fase 1 só vê elas), e a nota final custa o mesmo que a atual.
    const edited = ok(md(['a', 'b', 'c'].map(tag => table(tag, 50, true))), { existing: three })
    expect(noteTableCost(edited.blocks)).toBe(3 * 2500 ** 2)
    // Encolhidas para 45×50: custa menos que a atual, ainda acima do teto.
    const shrunk = ok(md(['a', 'b', 'c'].map(tag => table(tag, 45))), { existing: three })
    expect(noteTableCost(shrunk.blocks)).toBe(3 * 2250 ** 2)
    expect(noteTableCost(shrunk.blocks)).toBeGreaterThan(TABLE_LIMITS.noteCellCost)
    // O teto de cada tabela continua na fase 1, e somar tabela continua recusado na fase 2.
    const grown = parse(md([table('a', 50, true), table('b', 50, true), table('c', 51)]), { existing: three })
    expect(!grown.ok && grown.issues.map(({ line, keyword, message }) => ({ line, keyword, message }))).toEqual([{ line: 105, keyword: 'maxCells', message: `A tabela passa de ${TABLE_LIMITS.contractCells} células (o editor fica lento)` }])
    expect(issues(md([...['a', 'b', 'c'].map(tag => table(tag, 50, true)), table('d', 10)]), { existing: three })).toEqual([{ line: 157, keyword: 'maxCells' }])
  }, 60_000)

  it('R11: skipNoteCellCost tira só o teto da nota inteira, no validador e na forma completa; sem ele, nada muda', () => {
    const row = (n: number) => ({ cells: Array.from({ length: n }, () => 'x') })
    const tableBlock = (rows: unknown[]) => ({ type: 'table', content: { type: 'tableContent', rows } })
    const grid = (h: number, w: number) => tableBlock(Array.from({ length: h }, () => row(w)))
    const noteWide = <I extends { message: string }>(list: I[]) => list.filter(i => i.message.includes('nota inteira'))
    // Validador: três 50×50 passam do teto da nota (o caminho JSON e o editor seguem recusando).
    const plain = [grid(50, 50), grid(50, 50), grid(50, 50)]
    expect(noteWide(validateNoteContent(plain).issues)).toHaveLength(1)
    expect(validateNoteContent(plain, { skipNoteCellCost: true }).issues).toEqual([])
    // Forma completa: a célula com props e sem content conta o colspan só no normalize (1.500 → 1.550 células na 3ª).
    const third = tableBlock([{ cells: [{ type: 'tableCell', props: { colspan: 30 } }, 'x'] }, row(1), ...Array.from({ length: 48 }, () => row(30))])
    const fullOnly = [grid(50, 50), grid(40, 50), third]
    expect(validateNoteContent(fullOnly).ok).toBe(true)
    const strict = normalizeNoteContent(fullOnly, { newId: counter('s') })
    expect(!strict.ok && noteWide(strict.issues).map(i => i.path)).toEqual(['/2/content'])
    expect(normalizeNoteContent(fullOnly, { newId: counter('s'), skipNoteCellCost: true }).ok).toBe(true)
    // O teto de cada tabela fica, nas duas formas.
    expect(validateNoteContent([grid(51, 50)], { skipNoteCellCost: true }).issues.map(i => i.message)).toEqual([`A tabela passa de ${TABLE_LIMITS.contractCells} células (o editor fica lento)`])
    const wide = tableBlock([{ cells: [{ type: 'tableCell', props: { colspan: 49 } }, 'x'] }, row(1), ...Array.from({ length: 49 }, () => row(49))])
    const wideOut = normalizeNoteContent([wide], { newId: counter('s'), skipNoteCellCost: true })
    expect(!wideOut.ok && wideOut.issues.map(i => i.message)).toEqual([`A tabela passa de ${TABLE_LIMITS.contractCells} células na forma completa (o editor fica lento)`])
  })

  it('R11: noteLimitIssues e noteTableCost: Σ (linhas × largura)², com os filhos; a base é a nota ou o custo dela', () => {
    const grid = (id: string, rows: number, cols: number) => ({ id, type: 'table', content: { rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: cols }, () => 'a') })) } })
    expect(noteTableCost([grid('a', 50, 50), { id: 'p', type: 'paragraph', children: [grid('b', 10, 10)] }, null, { type: 'table', content: { rows: [0] } }, { type: 'table', content: 'x' }])).toBe(2500 ** 2 + 100 ** 2)
    expect(noteTableCost('x')).toBe(0)
    expect(noteTableCost([{ type: 'table', content: { rows: 'x' } }])).toBe(0)
    // Além de HARD_MAX_DEPTH, como no noteLimitIssues, não conta.
    let deep: Block = grid('z', 2, 2)
    for (let i = 0; i < 70; i++) deep = { id: `d${i}`, type: 'paragraph', children: [deep] }
    expect(noteTableCost([deep])).toBe(0)
    const over = [grid('a', 50, 50), grid('b', 50, 50), { id: 'p', type: 'paragraph', children: [grid('c', 1, 1)] }]
    expect(noteLimitIssues(over)).toEqual([{ path: '/2/children/0/content', keyword: 'maxCells', message: `As tabelas da nota passam do teto de células da nota inteira (soma de células² acima de ${TABLE_LIMITS.noteCellCost}; o editor fica lento)`, fatal: false }])
    expect(noteLimitIssues(over, { baseline: over })).toEqual([])
    expect(noteLimitIssues(over, { baseline: noteTableCost(over) })).toEqual([])
    expect(noteLimitIssues(over, { baseline: noteTableCost(over) - 1 })).toHaveLength(1)
    expect(noteLimitIssues(over.slice(0, 2))).toEqual([])
  })
})

describe('revisão 2 (render-023)', () => {
  const props = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
  const P = (id: string, text: string) => ({ id, type: 'paragraph', props, content: [T(text)], children: [] })
  const code = (text: string) => ({ id: 'code', type: 'codeBlock', props: { language: 'text' }, content: [T(text)], children: [] })
  /** `levels` itens em volta de `inner`: numerados com start 999999999 (11 colunas de recuo por nível) ou marcadores. */
  const nest = (levels: number, inner: unknown[], numbered = true): Block[] => {
    let kids = inner
    for (let d = levels; d >= 1; d--) kids = [{ id: `v${d}`, type: numbered ? 'numberedListItem' : 'bulletListItem', props: numbered ? { ...props, start: 999_999_999 } : props, content: [T(`nível ${d}`)], children: kids }]
    return kids as Block[]
  }
  const deepPath = (levels: number) => `/0${'/children/0'.repeat(levels)}`
  /** Nota válida (contrato inteiro) funda: 9 níveis numerados, 6 itens no 10º com 25 mil quebras cada e o parágrafo do fim. */
  const deepValid = () => [
    ...nest(9, Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, type: 'numberedListItem', props: i === 0 ? { ...props, start: 999_999_999 } : props, content: [T(`item ${i}${'\n'.repeat(25_000)}x`)], children: [] }))),
    P('fim', 'fim da nota'),
  ]

  it('#1: o teto de saída vale dentro do bloco: o código de 20 mil linhas no 64º nível sai inteiro, com a perda nele, e a saída não passa do teto', () => {
    // Sem o teto no bloco, esta nota de 67 KiB (que o editor abre) dava 14 Mi unidades de Markdown.
    const t = performance.now()
    const r = blocksToMarkdown([...nest(63, [code('a\n'.repeat(20_000))]), P('fim', 'fim')])
    expect(performance.now() - t).toBeLessThan(CEILING_MS)
    expect(r.losses).toEqual([{ path: deepPath(63), kind: 'truncated' }, { path: '/1', kind: 'truncated' }])
    expect(r.markdown).toBe(blocksToMarkdown(nest(63, [])).markdown)
    expect(r.blocks).toHaveLength(63)
    expect(r.markdown.length).toBeLessThanOrEqual(RENDER_BUDGET)
  })

  it('#1: o erro no meio do bloco que não é o teto não vira corte: sobe até o blocksToMarkdown, como antes', () => {
    const trap = [{ id: 'h', type: 'heading', props: { get level(): number { throw new Error('getter') } }, content: [T('a')] }]
    const r = blocksToMarkdown(trap)
    expect(r.markdown).toBe('')
    expect(r.losses).toEqual([{ path: '', kind: 'unreadable' }])
  })

  it('#1: a regravação sobre a nota de 64 níveis (código a\\n × 5 mil e × 20 mil) e sobre a nota válida funda fica abaixo do teto de tempo', () => {
    for (const existing of [nest(63, [code('a\n'.repeat(5000))]), nest(63, [code('a\n'.repeat(20_000))]), deepValid()]) {
      const t = performance.now()
      const r = markdownToNote('# Nota refeita', { existing, newId: counter('w') })
      expect(performance.now() - t).toBeLessThan(CEILING_MS)
      expect(r.ok && compact(r.blocks)).toEqual([{ t: 'heading', c: 'Nota refeita' }])
    }
  }, 60_000)

  // Razão de um par medido na mesma janela (o fundo e logo depois o raso), a menor de até 5, como na bateria.
  it('#1 (memória do findNextNonspace): reler o render de 63 itens aninhados custa como o de um código raso com o mesmo recuo', { timeout: 60_000, retry: 2 }, () => {
    // O mesmo tamanho (2.900 linhas de ~700 colunas, dentro dos tetos da reconciliação): ~1,5× o
    // raso; sem a memória, cada um dos 127 contêineres abertos varria o recuo de novo (~33×).
    const deep = [P('um', 'um'), ...nest(63, [code('a\n'.repeat(2900))])]
    const flat = [P('um', 'um'), code(`${' '.repeat(693)}a\n`.repeat(2900))]
    const time = (existing: unknown[]) => {
      const t = performance.now()
      const r = markdownToNote('um', { existing, newId: counter('m') })
      const ms = performance.now() - t
      // O plan rodou: o parágrafo volta com o id.
      expect(r.ok && r.blocks[0].id).toBe('um')
      return ms
    }
    let ratio = Infinity
    for (let k = 0; k < 5 && ratio >= 10; k++) ratio = Math.min(ratio, time(deep) / Math.max(time(flat), 1))
    expect(ratio).toBeLessThan(10)
  })

  it('#1 (tetos da reconciliação): acima de 2 Mi unidades, de 2^18 linhas e células ou de 2^22 linhas × níveis, a regravação segue sem reconciliar', () => {
    const keeps = (existing: unknown[]) => {
      const r = markdownToNote('um', { existing, newId: counter('k') })
      if (!r.ok) throw new Error(JSON.stringify(r.issues))
      return r.blocks[0].id === 'um'
    }
    // Unidades: 2.850 linhas de ~700 colunas cabem em 4 × 512 KiB; 3.050, não.
    expect(keeps([P('um', 'um'), ...nest(63, [code('a\n'.repeat(2850))])])).toBe(true)
    expect(keeps([P('um', 'um'), ...nest(63, [code('a\n'.repeat(3050))])])).toBe(false)
    // Linhas × níveis: linhas em branco no 64º nível custam pouco no render e muito na releitura.
    expect(keeps([P('um', 'um'), ...nest(63, [code('\n'.repeat(64_000))], false)])).toBe(true)
    expect(keeps([P('um', 'um'), ...nest(63, [code('\n'.repeat(67_000))], false)])).toBe(false)
    // Linhas e células: tabelas 100×100 de células mescladas (~10 mil `|` cada).
    const span50 = { type: 'tableCell', props: { colspan: 50 }, content: [] }
    const grid = (id: string) => ({ id, type: 'table', props: {}, content: { type: 'tableContent', headerRows: 1, rows: [{ cells: [span50, span50] }, ...Array.from({ length: 99 }, () => ({ cells: [] }))] }, children: [] })
    expect(keeps([P('um', 'um'), ...Array.from({ length: 24 }, (_, i) => grid(`t${i}`))])).toBe(true)
    const tables = [P('um', 'um'), ...Array.from({ length: 27 }, (_, i) => grid(`t${i}`))]
    expect(keeps(tables)).toBe(false)
    // Sem reconciliar, as perdas do render vão inteiras.
    expect(ok('um', { existing: tables }).losses.filter(l => l.kind === 'mergedCells')).toHaveLength(54)
  }, 60_000)

  it('#2: a nota válida funda sai cortada com a perda truncated (distinta de unreadable) nos blocos de depois do teto', () => {
    const note = deepValid()
    expect(validateNoteContent(note, { stored: true }).issues).toEqual([])
    expect(noteLimitIssues(note)).toEqual([])
    const r = blocksToMarkdown(note)
    // 25 mil linhas de ~110 colunas por item: o 3º passaria do teto.
    const level10 = `${deepPath(8)}/children`
    expect(r.losses).toEqual([...[2, 3, 4, 5].map(i => ({ path: `${level10}/${i}`, kind: 'truncated' })), { path: '/1', kind: 'truncated' }])
    expect(r.markdown.length).toBeLessThanOrEqual(RENDER_BUDGET)
    expect(r.markdown).toContain('item 1')
    expect(r.markdown).not.toContain('item 2')
    expect(MARKDOWN_LOSSES.unreadable).not.toMatch(/teto de saída/)
    expect(MARKDOWN_LOSSES.truncated).toMatch(/teto de saída/)
  })

  it('#2: a nota válida rasa de ~2 MiB na raiz não é cortada', () => {
    const note = Array.from({ length: 900 }, (_, i) => P(`p${i}`, `p${i} ${'palavra '.repeat(260)}`))
    const v = validateNoteContent(note, { stored: true })
    expect(v.issues).toEqual([])
    expect(v.stats.bytes).toBeGreaterThan(1.9 * 2 ** 20)
    const r = blocksToMarkdown(note)
    expect(r.losses).toEqual([])
    expect(r.blocks).toHaveLength(900)
    expect(r.markdown).toContain('p899 palavra')
  })
})

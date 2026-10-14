// API-023: gerador com semente fixa de notas do subconjunto sem perdas do
// Markdown (blocos parciais; o normalize leva à forma canônica). Usado pelas
// propriedades do markdown.test.ts e pela compatibilidade com a colagem do app
// em src/components/noteMarkdown.test.ts.
//
// O alfabeto é hostil de propósito: pontuação que vira sintaxe, espaço e tab
// nas bordas, espaços Unicode, \r, \r\n e BOM, URL, `www.`, e-mail, emoji,
// `&nome;`, `N.` e marcador de bloco no texto. Fica fora o que o render registra
// como perda (cor, sublinhado, alinhamento de bloco, recolhível, filhos de bloco
// que não é lista, parágrafo vazio, \r no código e na imagem) e o que tem outra
// forma canônica (espaço na borda de trecho com negrito, itálico ou tachado,
// que sai dos delimitadores).

export function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let x = Math.imul(state ^ (state >>> 15), 1 | state)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export const GEN_USER = '11111111-1111-4111-8111-111111111111'
export const GEN_PAGE = '22222222-2222-4222-8222-222222222222'

export interface GeneratorOptions {
  /**
   * Só o que a colagem do app (tryParseMarkdownToBlocks) lê igual: sem URL,
   * `www.` e e-mail soltos no texto (o autolink do GFM no app ignora o
   * escape), sem imagem, sem quebra em título e célula (`<br>`), sem
   * alinhamento, sem `start` depois de lista numerada, sem checklist vazio, sem
   * código dentro de link ou junto de outro estilo, sem tab, sem quebra no fim
   * do bloco (`<br>`), sem filho de item que não seja item (a colagem o muda de
   * lugar), sem `start` em item com filhos, sem `>` no texto (o happy-dom
   * duplica o texto com `-->`), sem espaço duplo (a célula da colagem junta),
   * sem linha vazia dentro do trecho e sem os casos da tabela DIVERGENCIAS.
   */
  pasteSafe?: boolean
}

// Espaços que não são linha em branco no CommonMark (NBSP, U+3000, U+2003, \f e
// \v), o \r (sai como &#13;) e o BOM (como &#65279; no começo do documento).
const UNICODE_EDGES = ['\u3000', '\u2003', '\f', '\v', '\r', '\ufeff']
const CHARS = ['a', 'b', 'x', 'Z', '0', '7', ' ', ' ', '\t', '*', '_', '[', ']', '(', ')', '<', '>', '|', '#', '\\', '`', '~', '&', '!', '-', '+', '=', '.', ':', '@', '"', "'", '😀', 'é', 'ç', '\u00a0', ';', '/', '^', '$', '%', '{', '}', ...UNICODE_EDGES]
const WORDS = [
  'https://x.com/a', 'www.y.com', 'a@b.com', 'http://z.org/p?q=1', '&amp;', '&copy;', '&#35;', '&foo;', '1. ', '2) ', '- ', '+ ', '# ', '> ',
  '```', '~~~', '---', '***', '===', '<!-- -->', '<!-- akool:bloco id="x" tipo="diagram" -->', '[x](y)', '![i](u)', '<br>', '<b>', 'texto',
  'palavra', '**', '__', '~~', '[^1]', '[r]: /u', '\\', '|-|', ':--', '    ', '😀😀',
]
const HREFS = ['https://e.com/a', 'https://e.com/a_(b)', 'mailto:a@b.com', '/rel/path', 'https://e.com/a b', 'https://x.com/?q=1&amp;x', '#ancora', 'https://e.com/<x>', 'https://e.com/a\\b', 'tel:123', 'ftp://f.org/x)']
const LANGS = ['text', 'ts', 'js', 'python', 'c++', 'a`b', 'shell-session', 'x&amp;y', 'a\\b']

// Na colagem do app: sem autolink solto, sem `<br>`, sem tab (o app troca por espaços), sem o que vira HTML no remark e sem os espaços Unicode, \r e BOM.
const SAFE_CHARS = CHARS.filter(c => c !== '\t' && c !== '@' && !UNICODE_EDGES.includes(c))
const SAFE_WORDS = WORDS.filter(w => !/https?:|www\.|@|<br>|<b>|<!--|\t|&foo;|\[\^1\]|\[r\]| {4}/.test(w))
const SAFE_HREFS = ['https://e.com/a', 'https://e.com/a_(b)', 'mailto:a@b.com', '/rel/path', '#ancora', 'tel:123']
const SAFE_LANGS = ['text', 'ts', 'js', 'python', 'c++', 'shell-session']

type Block = Record<string, unknown>

/** Uma nota por chamada (blocos parciais), sempre a mesma sequência para a mesma semente. */
export function noteGenerator(seed: number, opts: GeneratorOptions = {}): () => Block[] {
  const rand = mulberry32(seed)
  const safe = opts.pasteSafe === true
  const chars = safe ? SAFE_CHARS : CHARS
  const words = safe ? SAFE_WORDS : WORDS
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))
  const rawText = (max: number, newlines: boolean) => {
    let s = ''
    const n = int(1, max)
    for (let i = 0; i < n; i++) {
      const r = rand()
      // \r\n (fora da colagem, sem gastar sorteio nela): o \r sai como &#13;.
      if (newlines && r < 0.06) s += !safe && rand() < 0.3 ? '\r\n' : '\n'
      else if (r < 0.3) s += pick(words)
      else s += pick(chars)
    }
    return s
  }
  const isSpace = (c: string) => /\s/.test(c)
  /** Trecho com negrito, itálico ou tachado: sem espaço nas bordas de cada linha. */
  const styledText = (newlines: boolean) => rawText(12, newlines).split('\n').map(line => {
    let s = line
    while (s && isSpace(s[0])) s = s.slice(1)
    while (s && isSpace(s[s.length - 1])) s = s.slice(0, -1)
    return s || 'k'
  }).join('\n')
  const inline = (newlines: boolean): Block[] => {
    const items: Block[] = []
    const n = int(1, 5)
    for (let i = 0; i < n; i++) {
      const styles: Record<string, true> = {}
      if (rand() < 0.25) styles.bold = true
      if (rand() < 0.25) styles.italic = true
      if (rand() < 0.15) styles.strike = true
      if (rand() < 0.15) styles.code = true
      // Na colagem do app, a marca de código exclui as outras (excludes: '_' do ProseMirror).
      if (safe && styles.code) for (const k of ['bold', 'italic', 'strike']) delete styles[k]
      const styled = Object.keys(styles).length > 0 && !styles.code
      let text = styled ? styledText(newlines) : rawText(12, newlines)
      // Sem `>` (o `-->` que o normalize forma ao juntar trechos faz o happy-dom
      // duplicar o texto), sem espaço duplo (a célula da colagem junta), sem
      // linha vazia (a colagem tira a quebra do estilo) e sem espaço nas bordas
      // de cada linha.
      if (safe) text = text.replace(/>/g, '').replace(/ {2,}/g, ' ').replace(/\n{2,}/g, '\n').replace(/^[ \u00a0]+|[ \u00a0]+$/gm, '') || 'k'
      // \r no código em linha é perda (codeSpan): sai como texto.
      if (styles.code) text = text.replace(/\r/g, '') || 'k'
      if (rand() < 0.15) {
        // Código com `]` no 1º link do parágrafo viraria definição de referência (perda codeSpan).
        if (styles.code) text = text.replace(/\]/g, ')')
        if (safe) delete styles.code
        items.push({ type: 'link', href: pick(safe ? SAFE_HREFS : HREFS), content: [{ type: 'text', text, styles }] })
      } else items.push({ type: 'text', text, styles })
    }
    if (safe) {
      // A quebra no fim do bloco sai como `<br>`, que a colagem descarta.
      const last = items[items.length - 1]
      const target = (last.type === 'link' ? (last.content as Block[])[0] : last) as { text: string }
      target.text = target.text.replace(/\n+$/, '') || 'k'
    }
    return items
  }
  const listTypes = ['bulletListItem', 'numberedListItem', 'checkListItem']
  const block = (depth: number, inList: boolean): Block => {
    const r = rand()
    if (r < 0.35 && depth < 4) {
      const type = pick(listTypes)
      const b: Block = { type, content: rand() < 0.1 && !(safe && type === 'checkListItem') ? [] : inline(true) }
      if (type === 'checkListItem' && rand() < 0.5) b.props = { checked: true }
      if (rand() < 0.3) b.children = safe ? blocks(depth + 1, true).filter(c => listTypes.includes(String(c.type))) : blocks(depth + 1, true)
      return b
    }
    if (r < 0.5) return { type: 'paragraph', content: inline(true) }
    if (r < 0.58) return { type: 'heading', props: { level: int(1, 6) }, content: rand() < 0.1 ? [] : inline(!safe) }
    if (r < 0.64) return { type: 'quote', content: rand() < 0.1 ? [] : inline(true) }
    if (r < 0.72) {
      // \r no código é perda (codeLineEnding).
      let text = rawText(20, true).replace(/\r/g, '') || 'k'
      // Linha só de espaços no código dentro de item de lista é perda (codeWhitespace).
      if (inList) text = text.split('\n').map(l => (/^[ \t]+$/.test(l) ? 'w' : l)).join('\n')
      return { type: 'codeBlock', props: { language: pick(safe ? SAFE_LANGS : LANGS) }, content: rand() < 0.1 ? [] : [{ type: 'text', text, styles: {} }] }
    }
    if (r < 0.8) {
      const cols = int(1, 4)
      const rows = int(1, 4)
      const aligns = Array.from({ length: cols }, () => (safe ? 'left' : pick(['left', 'left', 'center', 'right'])))
      const cell = () => {
        if (rand() < 0.15) return []
        // Na célula, código com `\` logo antes de `|` não tem forma no GFM (perda codeSpan).
        return JSON.parse(JSON.stringify(inline(!safe)).replace(/\\\\\|/g, '\\\\ |')) as Block[]
      }
      return {
        type: 'table',
        content: { type: 'tableContent', headerRows: 1, rows: Array.from({ length: rows }, () => ({ cells: aligns.map(a => ({ type: 'tableCell', props: { textAlignment: a }, content: cell() })) })) },
      }
    }
    if (r < 0.86) return { type: 'divider' }
    if (r < 0.93 && !safe) {
      // \r no nome ou na legenda é perda (imageProps).
      const label = () => rawText(8, false).replace(/\r/g, '')
      return { type: 'image', props: { url: `${GEN_USER}/${GEN_PAGE}/${int(1, 999)}.webp`, name: rand() < 0.3 ? '' : label(), caption: rand() < 0.5 ? '' : label() } }
    }
    return { type: 'paragraph', content: inline(true) }
  }
  const blocks = (depth: number, inList: boolean): Block[] => {
    const list: Block[] = []
    const n = int(1, depth === 1 ? 8 : 3)
    for (let i = 0; i < n; i++) {
      const b = block(depth, inList)
      // `start` que o Markdown representa: no começo da sequência, ≠ 1; logo depois de numerado, qualquer um.
      if (b.type === 'numberedListItem' && rand() < 0.3) {
        const prevNumbered = list.length > 0 && list[list.length - 1].type === 'numberedListItem'
        const start = int(0, 12)
        // Na colagem, o `start` some quando o item tem filhos: fica de fora no modo pasteSafe.
        if (safe ? !prevNumbered && start > 1 && b.children === undefined : prevNumbered || start !== 1) b.props = { ...(b.props as object), start }
      }
      list.push(b)
    }
    return list
  }
  return () => {
    const list = blocks(1, false)
    // O BOM no começo do documento (fora da colagem): sai como &#65279;, porque a leitura tira o cru.
    const first = list[0].content
    if (!safe && rand() < 0.15 && Array.isArray(first) && first[0]?.type === 'text' && Object.keys(first[0].styles).length === 0) first[0].text = `\ufeff${first[0].text}`
    return list
  }
}

const MD_PIECES = [
  '# ', '## ', '###### ', '####### ', '- ', '* ', '+ ', '1. ', '3) ', '- [ ] ', '- [x] ', '> ', '>> ', '    ', '\t', '```', '~~~', '```ts', '---', '***', '___',
  '| a | b |', '|---|:-:|', '| 1 \\| 2 |', '[r]: /u "t"', '[r]', '[x](y)', '[x](<a b>)', '![i](u/p/1.png)', '<br>', '<b>x</b>', '<!-- c -->',
  '<!-- akool:bloco id="x" tipo="diagram" -->', '**', '*', '_', '__', '~', '~~', '`', '``', '\\', '&amp;', '&#0;', '&copy;', 'https://x.com/a',
  'www.y.com', 'a@b.com', '<https://a.b>', '[^1]', 'texto', 'palavra', '😀', 'é', '\u0000', '\ud800', '  ', '\r\n', '=', '-', '(', ')', '[', ']',
]

/** Markdown aleatório (linhas de pedaços de sintaxe), para o fuzz e a idempotência. */
export function markdownGenerator(seed: number): () => string {
  const rand = mulberry32(seed)
  return () => {
    const lines: string[] = []
    const n = 1 + Math.floor(rand() * 25)
    for (let i = 0; i < n; i++) {
      let line = ''
      const k = Math.floor(rand() * 8)
      for (let j = 0; j < k; j++) line += MD_PIECES[Math.floor(rand() * MD_PIECES.length)]
      lines.push(rand() < 0.15 ? '' : line)
    }
    return lines.join('\n')
  }
}

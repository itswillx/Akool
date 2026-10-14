// API-020: o schema das notas (BlockNote) que o app usa, em dados puros. O
// validador (schema.ts) e a normalização (normalize.ts) leem daqui. A
// paridade com o schema real (src/components/noteSchema.ts) fica em
// src/components/noteSchema.test.ts, porque a fronteira de imports do API-005
// não deixa o @blocknote/core entrar em _domain; a paridade da versão
// instalada fica em blocknote.test.ts (package-lock.json).
//
// Subir o BlockNote (o ^0.50.0 aceita 0.50.x) exige atualizar este arquivo e
// republicar a function api: o app e a API precisam aceitar a mesma coisa
// (docs/api-arquitetura.md §3).

export const BLOCKNOTE_VERSION = '0.50.0'

export type ContentKind = 'inline' | 'table' | 'none'
export type PropPrimitive = string | number | boolean

/** Uma prop do `propSchema` do BlockNote, como ele a declara. */
export interface PropSpec {
  readonly default?: PropPrimitive
  readonly values?: readonly PropPrimitive[]
  readonly type?: 'string' | 'number' | 'boolean'
  readonly optional?: true
}

export interface BlockSpecDef {
  readonly content: ContentKind
  readonly propSchema: Readonly<Record<string, PropSpec>>
}

const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const
const backgroundColor = { default: 'default' } as const
const textColor = { default: 'default' } as const
const textAlignment = { default: 'left', values: ALIGNMENTS } as const

/** Os 16 tipos de bloco do NoteEditor: os 14 padrão do BlockNote 0.50 mais diagram e projectCard. */
export const BLOCK_SPECS = {
  audio: { content: 'none', propSchema: { backgroundColor, name: { default: '' }, url: { default: '' }, caption: { default: '' }, showPreview: { default: true } } },
  bulletListItem: { content: 'inline', propSchema: { backgroundColor, textColor, textAlignment } },
  checkListItem: { content: 'inline', propSchema: { backgroundColor, textColor, textAlignment, checked: { default: false, type: 'boolean' } } },
  codeBlock: { content: 'inline', propSchema: { language: { default: 'text' } } },
  divider: { content: 'none', propSchema: {} },
  file: { content: 'none', propSchema: { backgroundColor, name: { default: '' }, url: { default: '' }, caption: { default: '' } } },
  heading: {
    content: 'inline',
    propSchema: { backgroundColor, textColor, textAlignment, level: { default: 1, values: [1, 2, 3, 4, 5, 6] }, isToggleable: { default: false, optional: true } },
  },
  image: {
    content: 'none',
    propSchema: { textAlignment, backgroundColor, name: { default: '' }, url: { default: '' }, caption: { default: '' }, showPreview: { default: true }, previewWidth: { type: 'number' } },
  },
  numberedListItem: { content: 'inline', propSchema: { backgroundColor, textColor, textAlignment, start: { type: 'number' } } },
  paragraph: { content: 'inline', propSchema: { backgroundColor, textColor, textAlignment } },
  quote: { content: 'inline', propSchema: { backgroundColor, textColor } },
  table: { content: 'table', propSchema: { textColor } },
  toggleListItem: { content: 'inline', propSchema: { backgroundColor, textColor, textAlignment } },
  video: {
    content: 'none',
    propSchema: { textAlignment, backgroundColor, name: { default: '' }, url: { default: '' }, caption: { default: '' }, showPreview: { default: true }, previewWidth: { type: 'number' } },
  },
  // src/components/diagramBlockConfig.ts: JSON em texto (diagram.ts confere o conteúdo).
  diagram: { content: 'none', propSchema: { elements: { default: '[]' }, appState: { default: '{}' }, collapsed: { default: 'false' } } },
  // src/components/blocks/ProjectCardBlock.tsx: snapshot em JSON (projectCard.ts).
  projectCard: { content: 'none', propSchema: { cardId: { default: '' }, boardId: { default: '' }, snapshot: { default: '{}' } } },
} as const satisfies Record<string, BlockSpecDef>

export type BlockType = keyof typeof BLOCK_SPECS

/** Os 7 estilos padrão: booleanos ou texto (cor). */
export const STYLE_SPECS = {
  bold: 'boolean',
  italic: 'boolean',
  underline: 'boolean',
  strike: 'boolean',
  code: 'boolean',
  textColor: 'string',
  backgroundColor: 'string',
} as const satisfies Record<string, 'boolean' | 'string'>

export type StyleName = keyof typeof STYLE_SPECS

/** Conteúdo em linha padrão: só texto e link (o NoteEditor não registra outros). */
export const INLINE_TYPES = ['text', 'link'] as const

/** Props da célula de tabela (`tableCell`), na ordem em que o BlockNote as devolve. */
export const TABLE_CELL_DEFAULTS = { colspan: 1, rowspan: 1, backgroundColor: 'default', textColor: 'default', textAlignment: 'left' } as const

/** Props cujo valor é cor: texto livre (o colar da web traz rgb() e funções de cor). */
export const COLOR_PROPS: ReadonlySet<string> = new Set(['backgroundColor', 'textColor'])
export const MAX_COLOR_LENGTH = 64

/**
 * Limites de contrato da API: 2 MiB sobre o JSON compacto, 5000 blocos e
 * profundidade 10, com os blocos da raiz na profundidade 1. Os 2 MiB valem
 * sobre a forma canônica, que é a gravada: o validador mede o que recebe, e o
 * normalize mede de novo o que devolve (a forma completa ganha id, props e
 * children em cada bloco e props em cada célula, e pode crescer muito).
 */
export const LIMITS = { maxBytes: 2 * 1024 * 1024, maxBlocks: 5000, maxDepth: 10 } as const
export type Limits = { maxBytes: number; maxBlocks: number; maxDepth: number }

/**
 * Teto do percurso no modo só fatal (guarda do NoteEditor): conteúdo gravado
 * pode passar dos 10 níveis de contrato, mas o BlockNote converte os blocos por
 * recursão e estoura a pilha bem antes de 400 mil níveis (que o JSON.parse aceita).
 */
export const HARD_MAX_DEPTH = 64

/**
 * Tetos de tabela. Os fatais (maxSpan, maxColumns, maxCells) existem porque,
 * sem eles, um colspan de 100 mil numa célula vira 100 mil colunas no
 * editor.document, e o próximo save passa de 2 MB.
 * Os de contrato têm outro motivo: o tableContentToNodes do BlockNote 0.50 é
 * quadrático por tabela. Medido no create: 50x50 leva cerca de 0,7 s e
 * 100x100 cerca de 11 s. A API recusa uma tabela acima de 2.500 células
 * (contractCells) e uma nota cuja soma de células² das tabelas passa de
 * 2 × 2.500² (noteCellCost, cerca de 1,5 s de create: duas tabelas 50x50).
 * Sem o teto da nota, 260 tabelas 25x100 cabem em 2 MiB e travam o editor por
 * minutos. Conteúdo gravado acima deles ainda abre, só fica lento.
 */
export const TABLE_LIMITS = { maxSpan: 50, maxColumns: 100, maxCells: 10_000, contractCells: 2_500, noteCellCost: 2 * 2_500 * 2_500 } as const

/**
 * Teto fatal de nós por item em linha. O BlockNote 0.50 (blockToNode.ts)
 * empilha os nós de um item num só `push(...nós)`: fora do bloco de código,
 * cada \n vira um hardBreak e cada trecho entre eles um nó de texto, e o link
 * soma as partes. Com uns 110 mil nós o V8 estoura a pilha ("Error creating
 * document from blocks passed as initialContent"); 30 mil deixa folga para o
 * JavaScriptCore (Safari). Como contrato, a soma da lista inteira também não
 * passa disso: ao ler de volta, o editor junta os trechos vizinhos num item só.
 */
export const MAX_INLINE_NODES = 30_000

/** Pesquisa sem cair no protótipo (`constructor`, `toString`, `__proto__`). */
export function blockSpecOf(type: unknown): BlockSpecDef | undefined {
  return typeof type === 'string' && Object.hasOwn(BLOCK_SPECS, type) ? BLOCK_SPECS[type as BlockType] : undefined
}

export function styleKindOf(name: string): 'boolean' | 'string' | undefined {
  return Object.hasOwn(STYLE_SPECS, name) ? STYLE_SPECS[name as StyleName] : undefined
}

// Porte do isAllowedUri do BlockNote 0.50 (extensions/tiptap-extensions/Link/link.ts):
// http, https, ftp, ftps, mailto, tel, callto, sms, cid, xmpp e caminhos
// relativos, depois de tirar os espaços Unicode (lista do DOMPurify). Vazio passa.
// eslint-disable-next-line no-control-regex
const UNICODE_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g
// eslint-disable-next-line no-useless-escape
const ALLOWED_URI = /^(?:(?:http|https|ftp|ftps|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z0-9+.\-]+(?:[^a-z+.\-:]|$))/i

export function isAllowedHref(href: string): boolean {
  if (!href) return true
  return ALLOWED_URI.test(href.replace(UNICODE_WHITESPACE, ''))
}

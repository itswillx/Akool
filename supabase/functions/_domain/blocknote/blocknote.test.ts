import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { MAX_ISSUES } from '../../_api/schema.ts'
import { diagramIssues } from './diagram.ts'
import { defaultNewId, normalizeNoteContent, type NoteBlock } from './normalize.ts'
import { newProjectCardIds, snapshotIssues, type ProjectCardSnapshot } from './projectCard.ts'
import { findFatalNoteIssue, textNodeCount, toSchemaIssues, validateNoteContent, type BlockIssue, type ValidateOptions } from './schema.ts'
import { tableGridProblem, tableWidth } from './table.ts'
import { BLOCKNOTE_VERSION, HARD_MAX_DEPTH, LIMITS, MAX_INLINE_NODES, TABLE_LIMITS, isAllowedHref } from './spec.ts'

// API-020: validador e normalizador das notas, sem o BlockNote (a fronteira do
// API-005 não deixa importar @blocknote/core aqui). A prova de que o editor
// carrega o que o validador aceita fica em src/components/noteSchema.test.ts.

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')

function fixtures<T>(dir: string): [string, T][] {
  const path = join(HERE, 'fixtures', dir)
  return readdirSync(path).filter(f => f.endsWith('.json')).sort().map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(path, f), 'utf8')) as T])
}

interface FatalFixture { content: unknown; path: string; keyword: string; breaks: string }
const VALID = fixtures<unknown[]>('valid')
const PARTIAL = fixtures<unknown[]>('partial')
const FATAL = fixtures<FatalFixture>('fatal')

const issuesOf = (value: unknown, opts?: ValidateOptions): BlockIssue[] => validateNoteContent(value, opts).issues
const one = (value: unknown, opts?: ValidateOptions) => issuesOf(value, opts).map(({ path, keyword, fatal }) => ({ path, keyword, fatal }))
const p = (content: unknown, props?: unknown) => [{ type: 'paragraph', ...(props === undefined ? {} : { props }), content }]
const counter = () => {
  let n = 0
  return () => `id-${++n}`
}

const SNAPSHOT: ProjectCardSnapshot = {
  title: 'Card', description: '', priority: 'medium', startDate: null, dueDate: '2026-10-20', labels: ['a'],
  checklist: [{ text: 'x', completed: false }], completed: false, columnName: null, boardName: 'Quadro', boardIcon: '📋', boardColor: '#6366f1',
}
const cardBlock = (patch: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
  [{ type: 'projectCard', props: { cardId: '', boardId: '', snapshot: JSON.stringify({ ...SNAPSHOT, ...patch }), ...props } }]

describe('versão do BlockNote', () => {
  it('BLOCKNOTE_VERSION é a instalada (package-lock.json): subir o BlockNote exige rever o spec e republicar a api', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string }> }
    for (const name of ['core', 'react', 'mantine']) {
      expect(lock.packages[`node_modules/@blocknote/${name}`].version, name).toBe(BLOCKNOTE_VERSION)
    }
  })

  it('_api/schema.ts continua folha: _domain pode importá-lo sem ciclo', () => {
    const source = readFileSync(join(HERE, '..', '..', '_api', 'schema.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*(import|export)\s[^\n]*\sfrom\s/m)
  })
})

describe('fixtures fatais (as que derrubam o editor, o render do card ou outro bloco)', () => {
  it('são pelo menos 30, de todas as classes', () => {
    expect(FATAL.length).toBeGreaterThanOrEqual(30)
    expect(new Set(FATAL.map(([, f]) => f.breaks))).toEqual(new Set(['create', 'mount', 'card', 'corrupt']))
  })

  it.each(FATAL)('%s: recusada com o ponteiro, a palavra-chave e a marca fatal', (_name, f) => {
    const result = validateNoteContent(f.content)
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({ path: f.path, keyword: f.keyword, fatal: true })
    // A guarda do NoteEditor acha o mesmo problema, no modo gravado e só fatal.
    expect(findFatalNoteIssue(f.content)).toMatchObject({ path: f.path, keyword: f.keyword, fatal: true })
  })
})

describe('fixtures válidas (geradas pelo próprio BlockNote)', () => {
  it.each(VALID)('%s: passa nas formas parcial e completa, e o normalize devolve a mesma nota', (_name, content) => {
    expect(issuesOf(content)).toEqual([])
    expect(issuesOf(content, { form: 'full' })).toEqual([])
    expect(findFatalNoteIssue(content)).toBeNull()
    const normalized = normalizeNoteContent(content, { newId: () => { throw new Error('não deveria gerar id') } })
    expect(normalized).toEqual({ ok: true, blocks: content })
    // Byte a byte, inclusive a ordem das chaves.
    expect(JSON.stringify((normalized as { blocks: NoteBlock[] }).blocks)).toBe(JSON.stringify(content))
  })

  it.each(PARTIAL)('%s (parcial): passa na forma parcial, não na completa, e o normalize leva à completa', (_name, content) => {
    expect(issuesOf(content)).toEqual([])
    expect(issuesOf(content, { form: 'full' }).length).toBeGreaterThan(0)
    const normalized = normalizeNoteContent(content, { newId: counter() })
    if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))
    expect(issuesOf(normalized.blocks, { form: 'full' })).toEqual([])
    expect(normalizeNoteContent(normalized.blocks)).toEqual(normalized)
  })
})

describe('regras de contrato (o editor carrega, mas perde ou guarda errado)', () => {
  it.each<[string, unknown, string, string]>([
    ['prop desconhecida', p('x', { foo: 1 }), '/0/props/foo', 'additionalProperties'],
    ['alinhamento fora da lista', p('x', { textAlignment: 'diagonal' }), '/0/props/textAlignment', 'enum'],
    ['checked em texto', [{ type: 'checkListItem', props: { checked: 'sim' }, content: 'x' }], '/0/props/checked', 'type'],
    ['start em texto', [{ type: 'numberedListItem', props: { start: 'um' }, content: 'x' }], '/0/props/start', 'type'],
    ['previewWidth zero', [{ type: 'image', props: { previewWidth: 0 } }], '/0/props/previewWidth', 'minimum'],
    ['language numérica', [{ type: 'codeBlock', props: { language: 5 }, content: 'x' }], '/0/props/language', 'type'],
    ['cor de bloco com 65 caracteres', p('x', { textColor: 'x'.repeat(65) }), '/0/props/textColor', 'maxLength'],
    ['cor de estilo com 65 caracteres', p([{ type: 'text', text: 'x', styles: { backgroundColor: 'y'.repeat(65) } }]), '/0/content/0/styles/backgroundColor', 'maxLength'],
    ['estilo booleano em texto', p([{ type: 'text', text: 'x', styles: { bold: 'sim' } }]), '/0/content/0/styles/bold', 'type'],
    ['cor de estilo numérica', p([{ type: 'text', text: 'x', styles: { textColor: 5 } }]), '/0/content/0/styles/textColor', 'type'],
    ['href javascript:', p([{ type: 'link', href: 'javascript:alert(1)', content: 'x' }]), '/0/content/0/href', 'format'],
    ['link sem href', p([{ type: 'link', content: 'x' }]), '/0/content/0/href', 'required'],
    ['id com 129 caracteres', [{ id: 'i'.repeat(129), type: 'paragraph' }], '/0/id', 'maxLength'],
    ['props em texto', [{ type: 'paragraph', props: 'x', content: 'x' }], '/0/props', 'type'],
    ['chave a mais no bloco', [{ type: 'paragraph', content: 'x', extra: 1 }], '/0/extra', 'additionalProperties'],
    ['chave a mais no texto', p([{ type: 'text', text: 'x', styles: {}, data: 1 }]), '/0/content/0/data', 'additionalProperties'],
    ['prop da célula desconhecida', [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', props: { foo: 1 }, content: [] }] }] } }], '/0/content/rows/0/cells/0/props/foo', 'additionalProperties'],
    ['alinhamento da célula', [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', props: { textAlignment: 'diagonal' }, content: [] }] }] } }], '/0/content/rows/0/cells/0/props/textAlignment', 'enum'],
    ['largura de coluna em texto', [{ type: 'table', content: { type: 'tableContent', columnWidths: ['100px'], rows: [{ cells: ['a'] }] } }], '/0/content/columnWidths/0', 'type'],
    ['cardId fora do formato', cardBlock({}, { cardId: 'abc' }), '/0/props/cardId', 'pattern'],
    ['collapsed fora da lista', [{ type: 'diagram', props: { collapsed: 'talvez' } }], '/0/props/collapsed', 'enum'],
    // O normalize completaria snapshot '{}', que o contrato do snapshot recusa.
    ['card sem snapshot', [{ type: 'projectCard', props: { cardId: '', boardId: '' } }], '/0/props/snapshot', 'required'],
    ['card sem props', [{ type: 'projectCard' }], '/0/props/snapshot', 'required'],
  ])('%s', (_name, content, path, keyword) => {
    expect(one(content)).toEqual([{ path, keyword, fatal: false }])
    expect(findFatalNoteIssue(content)).toBeNull()
  })

  it('\\u0000 e surrogate solto em qualquer texto, inclusive chaves, id, href e props', () => {
    const bad = 'a\u0000b'
    const lone = 'a\ud800b'
    const content = [
      { id: lone, type: 'paragraph', props: { textColor: bad }, content: [{ type: 'text', text: bad, styles: {} }, { type: 'link', href: `https://x.dev/${lone}`, content: 'l' }] },
      { type: 'paragraph', content: 'x', [`k${bad}`]: 1 },
      { type: 'paragraph', content: '\udc00' },
    ]
    const chars = issuesOf(content).filter(i => i.keyword === 'char').map(i => i.path)
    expect(chars).toEqual(['/0/id', '/0/props/textColor', '/0/content/0/text', '/0/content/1/href', `/1/k${bad}`, '/2/content'])
    expect(findFatalNoteIssue(content)).toBeNull()
    // Par de surrogates (emoji) é texto normal.
    expect(issuesOf(p('😀 olá'))).toEqual([])
  })

  it('cores livres até 64 caracteres: rgb() e funções de cor coladas da web passam', () => {
    const color = 'color-mix(in srgb, rgb(34 139 34 / 0.5) 40%, transparent)'
    expect(color.length).toBeLessThanOrEqual(64)
    expect(issuesOf(p([{ type: 'text', text: 'x', styles: { textColor: color } }], { backgroundColor: 'rgb(255, 0, 0)' }))).toEqual([])
  })

  it('URL de mídia só pela estrutura (texto), sem política', () => {
    expect(issuesOf([{ type: 'image', props: { url: 'uid/page/1.webp' } }, { type: 'file', props: { url: 'blob:qualquer' } }])).toEqual([])
    expect(one([{ type: 'video', props: { url: 5 } }])).toEqual([{ path: '/0/props/url', keyword: 'type', fatal: false }])
  })

  it('heading com nível fora de 1..6 é fatal (o render faz createElement(`h${level}`) e o PDF caía)', () => {
    for (const level of [0, 7, 9, 1.5, '2', '1 2', null]) {
      expect(findFatalNoteIssue([{ type: 'heading', props: { level }, content: 'x' }]), String(level)).toMatchObject({ path: '/0/props/level', keyword: 'enum' })
    }
    expect(issuesOf([{ type: 'heading', props: { level: 6, isToggleable: true }, content: 'x' }])).toEqual([])
  })

  it('valor de prop ou de estilo que não é simples é fatal (e o percurso não desce nele)', () => {
    expect(one(p('x', { textColor: { a: { b: {} } } }))).toEqual([{ path: '/0/props/textColor', keyword: 'type', fatal: true }])
    expect(one(p([{ type: 'text', text: 'x', styles: { bold: [true] } }]))).toEqual([{ path: '/0/content/0/styles/bold', keyword: 'type', fatal: true }])
  })

  it('props.id troca o id do bloco no BlockNote: fatal', () => {
    expect(one(p('x', { id: 'outro' }))).toEqual([{ path: '/0/props/id', keyword: 'additionalProperties', fatal: true }])
  })
})

describe('forma parcial e completa', () => {
  it('a completa exige id, props completas, content em lista, children e estilos ligados', () => {
    const paths = issuesOf([{ type: 'paragraph', content: 'x' }], { form: 'full' }).map(i => `${i.path} ${i.keyword}`)
    expect(paths).toEqual(['/0 required', '/0/props required', '/0/content type', '/0/children required'])
    const full = { id: 'a', type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, children: [] }
    expect(one([{ ...full, content: [{ type: 'text', text: 'x', styles: { bold: false } }] }], { form: 'full' })).toEqual([{ path: '/0/content/0/styles/bold', keyword: 'const', fatal: false }])
    expect(one([{ ...full, props: { backgroundColor: 'default' }, content: [] }], { form: 'full' }).map(i => i.keyword)).toEqual(['required', 'required'])
    expect(one([{ id: 'd', type: 'divider', props: {}, content: [], children: [] }], { form: 'full' })).toEqual([{ path: '/0/content', keyword: 'additionalProperties', fatal: false }])
  })

  it('bloco sem conteúdo tolera content vazio na parcial; com conteúdo é fatal', () => {
    for (const content of ['', [], null]) expect(issuesOf([{ type: 'divider', content }])).toEqual([])
    expect(one([{ type: 'image', content: 'x' }])).toEqual([{ path: '/0/content', keyword: 'type', fatal: true }])
  })
})

describe('limites', () => {
  const flat = (n: number) => Array.from({ length: n }, () => ({ type: 'paragraph', content: 'x' }))
  const deep = (levels: number) => {
    let block: Record<string, unknown> = { type: 'paragraph', content: 'fundo' }
    for (let i = 1; i < levels; i++) block = { type: 'bulletListItem', content: 'n', children: [block] }
    return [block]
  }

  it('5000 blocos passam; 5001 não (e o percurso para cedo)', () => {
    expect(validateNoteContent(flat(LIMITS.maxBlocks))).toMatchObject({ ok: true, stats: { blocks: 5000, depth: 1 } })
    expect(one(flat(LIMITS.maxBlocks + 1))).toEqual([{ path: '', keyword: 'maxBlocks', fatal: false }])
  })

  it('profundidade 10 (raiz = 1) passa; 11 é contrato; acima do teto duro é fatal', () => {
    expect(validateNoteContent(deep(10))).toMatchObject({ ok: true, stats: { depth: 10 } })
    const eleven = one(deep(11))
    expect(eleven).toEqual([{ path: '/0' + '/children/0'.repeat(9) + '/children', keyword: 'maxDepth', fatal: false }])
    expect(findFatalNoteIssue(deep(HARD_MAX_DEPTH))).toBeNull()
    expect(findFatalNoteIssue(deep(HARD_MAX_DEPTH + 1))).toMatchObject({ keyword: 'maxDepth', fatal: true })
  })

  it('abaixo do limite de contrato o percurso ainda acha o que é fatal', () => {
    const content = deep(12)
    let leaf = content[0] as { children: unknown[] }
    while ((leaf.children?.[0] as { children?: unknown[] })?.children) leaf = leaf.children[0] as { children: unknown[] }
    leaf.children = [{ type: 'callout' }]
    expect(issuesOf(content)[0]).toMatchObject({ keyword: 'enum', fatal: true })
  })

  it('2 MiB sobre o JSON compacto, medido no fim (ou o tamanho do gateway)', () => {
    const big = p('x'.repeat(LIMITS.maxBytes))
    expect(one(big)).toEqual([{ path: '', keyword: 'maxBytes', fatal: false }])
    expect(validateNoteContent(p('olá')).stats.bytes).toBe(new TextEncoder().encode(JSON.stringify(p('olá'))).length)
    expect(one(p('x'), { bytes: LIMITS.maxBytes + 1 })).toEqual([{ path: '', keyword: 'maxBytes', fatal: false }])
  })

  it('aninhamento além da pilha do JSON.stringify vira problema, nunca exceção', () => {
    let junk: unknown = 0
    for (let i = 0; i < 200_000; i++) junk = [junk]
    const content = [{ type: 'paragraph', content: 'x', extra: junk }]
    expect(() => validateNoteContent(content)).not.toThrow()
    expect(one(content)).toEqual([
      { path: '/0/extra', keyword: 'additionalProperties', fatal: false },
      { path: '', keyword: 'maxBytes', fatal: false },
    ])
    expect(findFatalNoteIssue(content)).toBeNull()
  })

  it('no máximo 20 problemas, com os fatais primeiro', () => {
    const content = [...Array.from({ length: 30 }, () => p('x', { foo: 1 })[0]), { type: 'callout' }]
    const issues = issuesOf(content)
    expect(issues).toHaveLength(MAX_ISSUES)
    expect(issues[0]).toMatchObject({ path: '/30/type', fatal: true })
    expect(issues.slice(1).every(i => !i.fatal)).toBe(true)
  })

  it('raiz que não é lista é fatal', () => {
    expect(one({ type: 'paragraph' })).toEqual([{ path: '', keyword: 'type', fatal: true }])
    expect(one('texto')).toEqual([{ path: '', keyword: 'type', fatal: true }])
  })
})

describe('tabelas', () => {
  const cell = (props: Record<string, unknown>, content: unknown = 'a') => ({ type: 'tableCell', props, content })
  const table = (rows: unknown[], extra: Record<string, unknown> = {}) => [{ type: 'table', content: { type: 'tableContent', rows, ...extra } }]

  it('colspan e rowspan de 1 a 50; 51 é fatal', () => {
    expect(issuesOf(table([{ cells: [cell({ colspan: 50 })] }]))).toEqual([])
    expect(one(table([{ cells: [cell({ colspan: 51 })] }]))).toEqual([{ path: '/0/content/rows/0/cells/0/props/colspan', keyword: 'type', fatal: true }])
    expect(one(table([{ cells: [cell({ rowspan: '2' })] }, { cells: ['b'] }]))).toEqual([{ path: '/0/content/rows/0/cells/0/props/rowspan', keyword: 'type', fatal: true }])
  })

  it('grade de até 100 colunas e 10 mil células', () => {
    const row = (n: number) => ({ cells: Array.from({ length: n }, () => 'x') })
    expect(issuesOf(table([row(100)]))).toEqual([])
    expect(one(table([row(101)]))).toEqual([{ path: '/0/content', keyword: 'maxColumns', fatal: true }])
    expect(one(table(Array.from({ length: 101 }, () => row(100))))).toEqual([{ path: '/0/content', keyword: 'maxCells', fatal: true }])
    expect(one(table([{ cells: [cell({ colspan: 50 }), cell({ colspan: 50 }), 'x'] }]))).toEqual([{ path: '/0/content', keyword: 'maxColumns', fatal: true }])
  })

  it('acima de 2.500 células é contrato (o editor fica lento), não fatal: a guarda deixa abrir', () => {
    const row = (n: number) => ({ cells: Array.from({ length: n }, () => 'x') })
    expect(issuesOf(table(Array.from({ length: 50 }, () => row(50))))).toEqual([])
    const big = table(Array.from({ length: 51 }, () => row(50)))
    expect(one(big)).toEqual([{ path: '/0/content', keyword: 'maxCells', fatal: false }])
    expect(issuesOf(big, { fatalOnly: true })).toEqual([])
  })

  it('teto de células da nota inteira (Σ células²): duas 50x50 passam; a tabela que cruza o teto é contrato', () => {
    const row = (n: number) => ({ cells: Array.from({ length: n }, () => 'x') })
    const t50 = table(Array.from({ length: 50 }, () => row(50)))[0]
    const t10 = table(Array.from({ length: 10 }, () => row(10)))[0]
    expect(2 * 2500 ** 2).toBe(TABLE_LIMITS.noteCellCost)
    expect(issuesOf([t50, t50])).toEqual([])
    // A terceira, mesmo pequena, passa do orçamento: o ponteiro é o dela.
    expect(one([t50, t50, t10])).toEqual([{ path: '/2/content', keyword: 'maxCells', fatal: false }])
    expect(issuesOf([t50, t10, t50])[0]).toMatchObject({ path: '/2/content', keyword: 'maxCells' })
    expect(issuesOf([t50, t50, t50])[0].message).toMatch(/nota inteira/)
    // Conteúdo gravado continua abrindo (só fica lento).
    expect(issuesOf([t50, t50, t50, t50], { fatalOnly: true })).toEqual([])
    expect(findFatalNoteIssue([t50, t50, t50, t50])).toBeNull()
  })

  it('célula com props e sem content: se a grade não fecha na forma completa, é fatal já na entrada', () => {
    // O BlockNote carrega (largura 1), mas o editor.document e o normalize contam o colspan.
    const content = table([
      { cells: [cell({ rowspan: 2 }, 'x'), 'a', 'b'] },
      { cells: [{ type: 'tableCell', props: { colspan: 2 } }, { type: 'tableCell', props: { colspan: 2 } }] },
      { cells: ['a'] },
    ])
    expect(tableGridProblem(content[0].content.rows as { cells: unknown[] }[])).toBeNull()
    expect(one(content)).toEqual([{ path: '/0/content/rows/1/cells/1', keyword: 'table', fatal: true }])
    expect(findFatalNoteIssue(content)).toMatchObject({ path: '/0/content/rows/1/cells/1', keyword: 'table', fatal: true })
    expect(normalizeNoteContent(content)).toMatchObject({ ok: false, issues: [{ fatal: true }] })
  })

  it('columnWidths além da grade é fatal; menor que a primeira linha só na forma completa', () => {
    expect(one(table([{ cells: ['a'] }], { columnWidths: [10, 20] }))).toEqual([{ path: '/0/content/columnWidths', keyword: 'maxItems', fatal: true }])
    expect(one(table([{ cells: ['a'] }], { columnWidths: 'x' }))).toEqual([{ path: '/0/content/columnWidths', keyword: 'type', fatal: true }])
    expect(issuesOf(table([{ cells: ['a', 'b'] }], { columnWidths: [10] }))).toEqual([])
  })

  it('headerRows e headerCols inteiros dentro do teto', () => {
    expect(one(table([{ cells: ['a'] }], { headerRows: 1e9 }))).toEqual([{ path: '/0/content/headerRows', keyword: 'type', fatal: true }])
    expect(one(table([{ cells: ['a'] }], { headerCols: 1.5 }))).toEqual([{ path: '/0/content/headerCols', keyword: 'type', fatal: true }])
    expect(issuesOf(table([{ cells: ['a'] }], { headerRows: 3 }))).toEqual([])
  })

  it('a grade segue o BlockNote: célula sobreposta, sem lugar ou além da largura', () => {
    expect(tableGridProblem([{ cells: [cell({ rowspan: 2 }), 'b'] }, { cells: ['c', 'd'] }])).toMatchObject({ keyword: 'table', at: ['rows', 1, 'cells', 1] })
    expect(tableGridProblem([{ cells: [cell({ rowspan: 2 }), 'b'] }, { cells: [cell({ colspan: 2 })] }])).toMatchObject({ keyword: 'table', message: 'colspan passa da largura da tabela' })
    expect(tableGridProblem([{ cells: [cell({ rowspan: 2 }), 'b'] }, { cells: ['c'] }])).toBeNull()
    // Célula parcial sem content: na largura o BlockNote conta colspan 1.
    expect(tableGridProblem([{ cells: [{ type: 'tableCell', props: { colspan: 2 } }] }])).toMatchObject({ message: 'colspan passa da largura da tabela' })
    expect(tableGridProblem([{ cells: [{ type: 'tableCell', props: { colspan: 2 } }] }], true)).toBeNull()
  })

  it('props nulo numa célula é fatal (getColspan lê props.colspan)', () => {
    expect(one(table([{ cells: [{ type: 'tableCell', props: null, content: 'a' }] }]))).toEqual([{ path: '/0/content/rows/0/cells/0/props', keyword: 'type', fatal: true }])
  })
})

describe('ids', () => {
  const two = [{ id: 'a', type: 'paragraph', content: 'x' }, { id: 'b', type: 'paragraph', content: 'y', children: [{ id: 'a', type: 'paragraph', content: 'z' }] }]

  it('repetido é fatal, no que vem depois (pré-ordem)', () => {
    expect(one(two)).toEqual([{ path: '/1/children/0/id', keyword: 'duplicateId', fatal: true }])
    expect(issuesOf(two)[0].message).toContain('/0')
  })

  it('reservedIds: anexar com um id que já está na nota é fatal', () => {
    expect(one([{ id: 'x', type: 'paragraph' }], { reservedIds: ['x'] })).toEqual([{ path: '/0/id', keyword: 'duplicateId', fatal: true }])
    expect(normalizeNoteContent([{ id: 'x', type: 'paragraph' }], { reservedIds: ['x'] }).ok).toBe(false)
  })

  it('o normalize troca o repetido que vem depois (e o que colide com os reservados)', () => {
    const result = normalizeNoteContent([...two, { id: 'r', type: 'divider' }], { renameDuplicateIds: true, reservedIds: ['r'], newId: counter() })
    if (!result.ok) throw new Error('falhou')
    expect(result.blocks.map(b => b.id)).toEqual(['a', 'b', 'id-2'])
    expect(result.blocks[1].children[0].id).toBe('id-1')
  })

  it('newId padrão: UUID v4, com getRandomValues quando falta randomUUID', () => {
    expect(defaultNewId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const fallback = defaultNewId({ getRandomValues: <T extends Uint8Array>(a: T) => { a.fill(0xff); return a } })
    expect(fallback).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })
})

describe('href (porte do isAllowedUri do BlockNote)', () => {
  it.each([
    ['https://exemplo.com', true], ['http://x', true], ['mailto:a@b.c', true], ['tel:+55', true], ['ftp://x', true],
    ['/caminho', true], ['#ancora', true], ['pagina.html', true], ['', true],
    ['javascript:alert(1)', false], ['JaVaScRiPt:x', false], ['java\u0000script:x', false], [' javascript:x', false],
    ['data:text/html,x', false], ['vbscript:x', false],
  ])('%j → %s', (href, allowed) => {
    expect(isAllowedHref(href)).toBe(allowed)
  })
})

describe('chaves do protótipo', () => {
  it('constructor, toString e __proto__ não passam por tipo, estilo nem prop', () => {
    const fromJson = JSON.parse('[{"type":"__proto__"},{"type":"paragraph","props":{"__proto__":1},"content":[{"type":"text","text":"x","styles":{"constructor":true}}]}]') as unknown[]
    expect(one(fromJson)).toEqual([
      { path: '/0/type', keyword: 'enum', fatal: true },
      { path: '/1/content/0/styles/constructor', keyword: 'enum', fatal: true },
      { path: '/1/props/__proto__', keyword: 'additionalProperties', fatal: false },
    ])
  })
})

describe('projectCard', () => {
  const issues = (patch: Record<string, unknown>, opts?: { stored?: boolean }) => snapshotIssues(JSON.stringify({ ...SNAPSHOT, ...patch }), opts)

  it('o snapshot do buildCardSnapshot passa; boardColor é texto curto (não #rrggbb)', () => {
    expect(issues({})).toEqual([])
    expect(issues({ boardColor: 'blue' })).toEqual([])
    expect(issues({ boardColor: 'x'.repeat(65) })).toMatchObject([{ path: '/boardColor', keyword: 'maxLength', fatal: false }])
  })

  it('tipos que o render usa são fatais; o resto é contrato', () => {
    expect(issues({ title: 1 })).toMatchObject([{ path: '/title', keyword: 'type', fatal: true }])
    expect(issues({ labels: [1] })).toMatchObject([{ path: '/labels/0', keyword: 'type', fatal: true }])
    expect(issues({ checklist: [{ text: 1, completed: 'x' }] })).toMatchObject([
      { path: '/checklist/0/text', fatal: true }, { path: '/checklist/0/completed', fatal: true },
    ])
    expect(issues({ columnName: 3 })).toMatchObject([{ path: '/columnName', fatal: true }])
    expect(issues({ completed: 'sim' })).toMatchObject([{ path: '/completed', fatal: true }])
    expect(issues({ priority: 'urgentissimo' })).toMatchObject([{ path: '/priority', keyword: 'enum', fatal: false }])
    expect(issues({ dueDate: '2026-02-30' })).toMatchObject([{ path: '/dueDate', keyword: 'format', fatal: false }])
    expect(issues({ startDate: 5 })).toMatchObject([{ path: '/startDate', keyword: 'type', fatal: false }])
  })

  it('limites por code point, como o Postgres (rótulo com emoji)', () => {
    expect(issues({ labels: ['😀'.repeat(50)] })).toEqual([])
    expect(issues({ labels: ['😀'.repeat(51)] })).toMatchObject([{ path: '/labels/0', keyword: 'maxLength' }])
    expect(issues({ labels: Array.from({ length: 31 }, (_, i) => `r${i}`) })).toMatchObject([{ path: '/labels', keyword: 'maxItems' }])
    expect(issues({ checklist: Array.from({ length: 501 }, () => ({ text: 'x', completed: false })) })).toMatchObject([{ path: '/checklist', keyword: 'maxItems' }])
  })

  it('as 12 chaves exatas; no modo gravado, chave a mais é tolerada', () => {
    expect(issues({ extra: 1 })).toMatchObject([{ path: '/extra', keyword: 'additionalProperties', fatal: false }])
    expect(issues({ extra: 1 }, { stored: true })).toEqual([])
    const missing: Partial<ProjectCardSnapshot> = { ...SNAPSHOT }
    delete missing.boardColor
    expect(snapshotIssues(JSON.stringify(missing), { stored: true })).toMatchObject([{ path: '/boardColor', keyword: 'required' }])
  })

  it('JSON ilegível e raiz que não é objeto: contrato (o bloco desenha o rótulo padrão)', () => {
    expect(snapshotIssues('{oops')).toMatchObject([{ keyword: 'json', fatal: false }])
    expect(snapshotIssues('[1]')).toMatchObject([{ path: '', keyword: 'type', fatal: false }])
    expect(snapshotIssues(5)).toEqual([])
  })

  it('no validador da nota, o ponteiro é o da prop e o caminho interno vai na mensagem', () => {
    const [issue] = issuesOf(cardBlock({ labels: ['ok', 'x'.repeat(51)] }))
    expect(issue).toMatchObject({ path: '/0/props/snapshot', keyword: 'snapshot', fatal: false })
    expect(issue.message).toMatch(/^\/labels\/1: /)
  })
})

describe('diagram', () => {
  const props = (elements: unknown, appState: unknown = { viewBackgroundColor: '#fff', zoom: { value: 1 }, scrollX: 0, scrollY: 0 }) =>
    ({ elements: JSON.stringify(elements), appState: JSON.stringify(appState), collapsed: 'false' })

  it('só os elementos que o app cria; image, embeddable e iframe ficam para o API-054', () => {
    expect(diagramIssues(props([{ id: 'a', type: 'rectangle' }, { id: 'b', type: 'frame' }]))).toEqual([])
    for (const type of ['image', 'embeddable', 'iframe', 'magicframe']) {
      expect(diagramIssues(props([{ id: 'a', type }])), type).toMatchObject([{ prop: 'elements', path: '/0/type', keyword: 'enum' }])
    }
    expect(diagramIssues(props([{ type: 'text' }]))).toMatchObject([{ prop: 'elements', path: '/0/id', keyword: 'required' }])
  })

  it('appState com as 4 chaves e zoom finito em (0, 30]', () => {
    expect(diagramIssues(props([], { zoom: { value: 30 } }))).toEqual([])
    expect(diagramIssues(props([], { zoom: { value: 0 } }))).toMatchObject([{ prop: 'appState', path: '/zoom/value', keyword: 'minimum' }])
    expect(diagramIssues(props([], { zoom: { value: 31 } }))).toMatchObject([{ path: '/zoom/value', keyword: 'maximum' }])
    expect(diagramIssues(props([], { zoom: { value: 'x' } }))).toMatchObject([{ path: '/zoom/value', keyword: 'type' }])
    expect(diagramIssues(props([], { theme: 'dark' }))).toMatchObject([{ path: '/theme', keyword: 'additionalProperties' }])
  })

  it('JSON ilegível: contrato (o bloco já preserva o dado, REL-004)', () => {
    expect(diagramIssues({ elements: 'não é json', appState: '{' })).toMatchObject([{ prop: 'elements', keyword: 'json' }, { prop: 'appState', keyword: 'json' }])
    const [issue] = issuesOf([{ type: 'diagram', props: { elements: '[{"id":"a","type":"iframe"}]' } }])
    expect(issue).toMatchObject({ path: '/0/props/elements', keyword: 'elements', fatal: false, message: '/0/type: Valor fora da lista permitida' })
  })
})

describe('normalize: forma canônica do BlockNote', () => {
  const norm = (content: unknown) => {
    const result = normalizeNoteContent(content, { newId: counter() })
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    return result.blocks
  }
  const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: t, styles })

  it('props completas na ordem do propSchema; start só quando veio', () => {
    const [heading, numbered, image] = norm([{ type: 'heading', content: 'h' }, { type: 'numberedListItem', content: 'n' }, { type: 'image', props: { previewWidth: 300 } }])
    expect(heading.props).toEqual({ backgroundColor: 'default', textColor: 'default', textAlignment: 'left', level: 1, isToggleable: false })
    expect(Object.keys(numbered.props)).toEqual(['backgroundColor', 'textColor', 'textAlignment'])
    expect(Object.keys(image.props)).toEqual(['textAlignment', 'backgroundColor', 'name', 'url', 'caption', 'showPreview', 'previewWidth'])
  })

  it('estilos desligados somem; textos iguais se juntam; vazio some', () => {
    expect(norm(p([text('a', { bold: false, textColor: '' }), text('b'), text('', { bold: true }), 'c']))[0].content).toEqual([text('abc')])
    expect(norm(p([text('a', { textColor: 'red', bold: true })]))[0].content).toEqual([text('a', { bold: true, textColor: 'red' })])
  })

  it('quebra de linha fica com o trecho anterior; sem trecho, vira texto sem estilo', () => {
    expect(norm(p([text('a', { bold: true }), text('\nb')]))[0].content).toEqual([text('a\n', { bold: true }), text('b')])
    expect(norm(p([text('\nb', { bold: true })]))[0].content).toEqual([text('\n'), text('b', { bold: true })])
    expect(norm(p([text('a'), { type: 'link', href: 'https://x', content: '\nl' }]))[0].content).toEqual([text('a\n'), { type: 'link', href: 'https://x', content: [text('l')] }])
    expect(norm(p([{ type: 'link', href: 'https://x', content: 'l' }, text('\nz', { italic: true })]))[0].content).toEqual([{ type: 'link', href: 'https://x', content: [text('l\n')] }, text('z', { italic: true })])
  })

  it('no bloco de código o texto fica inteiro (sem quebra) e o estilo vale', () => {
    expect(norm([{ type: 'codeBlock', content: [text('\n', { bold: true }), text('x\n')] }])[0].content).toEqual([text('\n', { bold: true }), text('x\n')])
  })

  it('links vizinhos com o mesmo href se juntam; link vazio some', () => {
    expect(norm(p([{ type: 'link', href: 'https://x', content: 'a' }, { type: 'link', href: 'https://x', content: [text('b', { bold: true })] }, { type: 'link', href: 'https://y', content: '' }]))[0].content)
      .toEqual([{ type: 'link', href: 'https://x', content: [text('a'), text('b', { bold: true })] }])
  })

  it('tabela: células completas, columnWidths da primeira linha e cabeçalho no ponto fixo', () => {
    const [table] = norm([{ type: 'table', content: { type: 'tableContent', headerRows: 3, columnWidths: [100], rows: [{ cells: ['a', null] }, { cells: [[text('c')], { type: 'tableCell', props: { textAlignment: 'center' }, content: 'd' }] }] } }])
    const content = table.content as { columnWidths: unknown; headerRows: number; headerCols: number; rows: { cells: { props: unknown; content: unknown }[] }[] }
    expect(content.columnWidths).toEqual([100, null])
    expect([content.headerRows, content.headerCols]).toEqual([2, 2])
    expect(content.rows[0].cells[1]).toEqual({ type: 'tableCell', content: [], props: { colspan: 1, rowspan: 1, backgroundColor: 'default', textColor: 'default', textAlignment: 'left' } })
    expect(content.rows[1].cells[1].props).toMatchObject({ textAlignment: 'center' })
  })

  it('tabela irregular: a leitura do editor muda o cabeçalho, e o normalize repete até parar', () => {
    const [table] = norm([{ type: 'table', content: { type: 'tableContent', headerCols: 1, rows: [{ cells: ['a', 'b'] }, { cells: ['c'] }] } }])
    const content = table.content as { headerRows?: number; headerCols?: number }
    // Uma leitura dá (1, 1); a seguinte, (2, 1), que é o ponto fixo.
    expect([content.headerRows, content.headerCols]).toEqual([2, 1])
    expect(normalizeNoteContent([table]).ok && (normalizeNoteContent([table]) as { blocks: NoteBlock[] }).blocks[0]).toEqual(table)
  })

  it('bloco sem conteúdo fica sem content; children sempre lista; type ausente vira paragraph', () => {
    const [divider, para] = norm([{ type: 'divider', content: '' }, { content: 'x', children: null }])
    expect('content' in divider).toBe(false)
    expect(para).toMatchObject({ id: 'id-2', type: 'paragraph', children: [] })
  })

  it('nota inválida não é normalizada', () => {
    expect(normalizeNoteContent([{ type: 'callout' }])).toMatchObject({ ok: false, issues: [{ path: '/0/type', fatal: true }] })
  })
})

describe('nós em linha (o BlockNote empilha os nós de um item num só push)', () => {
  const lines = (n: number) => 'a\n'.repeat(n)
  const t = (value: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: value, styles })
  const tableOf = (cells: unknown[]) => [{ type: 'table', content: { type: 'tableContent', rows: [{ cells }] } }]

  it('textNodeCount: um nó por trecho e por quebra; no bloco de código, um só', () => {
    expect([textNodeCount('', false), textNodeCount('abc', false), textNodeCount('a\nb', false), textNodeCount('\n\n', false), textNodeCount('a\n', false)]).toEqual([0, 1, 3, 2, 2])
    expect(textNodeCount(lines(60_000), false)).toBe(120_000)
    expect([textNodeCount(lines(60_000), true), textNodeCount('', true)]).toEqual([1, 0])
  })

  it('até 30 mil nós por item passa; acima é fatal, também para a guarda', () => {
    expect(textNodeCount(lines(15_000), false)).toBe(MAX_INLINE_NODES)
    expect(issuesOf(p(lines(15_000)))).toEqual([])
    expect(one(p(lines(15_000) + 'a'))).toEqual([{ path: '/0/content', keyword: 'maxInlineNodes', fatal: true }])
    expect(findFatalNoteIssue(p([t('x'), t(lines(15_001))]))).toMatchObject({ path: '/0/content/1', keyword: 'maxInlineNodes' })
    expect(findFatalNoteIssue(p([lines(15_001)]))).toMatchObject({ path: '/0/content/0', keyword: 'maxInlineNodes' })
  })

  it('o link soma as partes (um só push) e quebra até no bloco de código', () => {
    const link = { type: 'link', href: 'https://x.dev', content: [t(lines(10_000)), t(lines(10_000), { bold: true })] }
    expect(one(p([link]))).toEqual([{ path: '/0/content/0', keyword: 'maxInlineNodes', fatal: true }])
    expect(one([{ type: 'codeBlock', content: [{ ...link, content: lines(15_001) }] }])).toEqual([{ path: '/0/content/0', keyword: 'maxInlineNodes', fatal: true }])
    // Texto no bloco de código é um nó só.
    expect(issuesOf([{ type: 'codeBlock', content: lines(100_000) }])).toEqual([])
  })

  it('células: texto solto, lista e content da tableCell também (o editor as devolve como [text])', () => {
    expect(one(tableOf([lines(15_001)]))).toEqual([{ path: '/0/content/rows/0/cells/0', keyword: 'maxInlineNodes', fatal: true }])
    expect(one(tableOf([[t(lines(15_001))]]))).toEqual([{ path: '/0/content/rows/0/cells/0/0', keyword: 'maxInlineNodes', fatal: true }])
    expect(one(tableOf([{ type: 'tableCell', content: lines(15_001) }]))).toEqual([{ path: '/0/content/rows/0/cells/0/content', keyword: 'maxInlineNodes', fatal: true }])
  })

  it('a soma da lista é contrato: itens pequenos que o editor juntaria num só passam do teto', () => {
    const content = p([t(lines(10_000)), t(lines(10_000), { bold: true }), t(lines(10_000))])
    expect(one(content)).toEqual([{ path: '/0/content', keyword: 'maxInlineNodes', fatal: false }])
    expect(findFatalNoteIssue(content)).toBeNull()
    expect(normalizeNoteContent(content).ok).toBe(false)
  })
})

describe('forma canônica dentro dos limites (normalize ok ⇒ a saída passa na completa e é ponto fixo)', () => {
  const row = (n: number, value: unknown = 'x') => ({ cells: Array.from({ length: n }, () => value) })
  const tableBlock = (rows: unknown[]) => ({ type: 'table', content: { type: 'tableContent', rows } })
  const grid = (h: number, w: number, value: unknown = 'x') => tableBlock(Array.from({ length: h }, () => row(w, value)))

  function property(content: unknown) {
    const result = normalizeNoteContent(content, { newId: counter() })
    if (result.ok) {
      expect(issuesOf(result.blocks, { form: 'full' })).toEqual([])
      expect(normalizeNoteContent(result.blocks)).toEqual(result)
      expect(jsonBytes(result.blocks)).toBeLessThanOrEqual(LIMITS.maxBytes)
    }
    return result
  }

  it('fixtures e casos perto dos limites', () => {
    const cases: unknown[] = [
      ...VALID.map(([, c]) => c), ...PARTIAL.map(([, c]) => c),
      [grid(50, 50), grid(50, 50)],
      Array.from({ length: 300 }, () => grid(5, 5, '')),
      p([{ type: 'text', text: 'a\n'.repeat(7_000), styles: {} }, { type: 'text', text: 'b\n'.repeat(7_000), styles: {} }]),
      p([{ type: 'link', href: 'https://x.dev', content: 'l'.repeat(10) + '\n'.repeat(29_000) }, { type: 'text', text: '\n'.repeat(500) + 'z', styles: {} }]),
    ]
    let ok = 0
    for (const content of cases) if (property(content).ok) ok++
    expect(ok).toBe(cases.length)
  })

  it('1000 parágrafos de 1990 caracteres, sem id: a entrada cabe em 2 MiB, a forma canônica não (maxBytes)', () => {
    const content = Array.from({ length: 1000 }, () => ({ type: 'paragraph', content: 'x'.repeat(1990) }))
    expect(jsonBytes(content)).toBeLessThan(LIMITS.maxBytes)
    expect(validateNoteContent(content).ok).toBe(true)
    expect(property(content)).toEqual({ ok: false, issues: [{ path: '', keyword: 'maxBytes', message: expect.stringMatching(/forma canônica/) as unknown, fatal: false }] })
  })

  it('os bytes contam em UTF-8: texto acentuado que cabe na entrada passa na forma canônica (maxBytes)', () => {
    // 'é' tem 2 bytes; a estimativa corrente (por comprimento) fica por baixo, e a medida final pega.
    const content = Array.from({ length: 1000 }, () => ({ type: 'paragraph', content: 'é'.repeat(1000) }))
    expect(validateNoteContent(content).ok).toBe(true)
    expect(property(content)).toMatchObject({ ok: false, issues: [{ path: '', keyword: 'maxBytes', fatal: false }] })
  })

  it('tabelas pequenas de células vazias (195 KB) virariam mais de 2 MiB: maxBytes, sem montar a saída inteira', () => {
    const content = Array.from({ length: 1000 }, () => grid(5, 5, ''))
    expect(validateNoteContent(content).ok).toBe(true)
    expect(property(content)).toMatchObject({ ok: false, issues: [{ keyword: 'maxBytes' }] })
    // Pior caso: 5000 tabelas 7x7 (1,4 MB) virariam uns 33 MB; a estimativa para
    // cedo, antes de montar e medir a saída (o maior JSON montado é o da entrada).
    const worst = Array.from({ length: LIMITS.maxBlocks }, () => grid(7, 7, ''))
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      expect(normalizeNoteContent(worst)).toMatchObject({ ok: false, issues: [{ keyword: 'maxBytes' }] })
      const largest = Math.max(...stringify.mock.results.map(r => (typeof r.value === 'string' ? r.value.length : 0)))
      expect(largest).toBe(jsonBytes(worst))
    } finally {
      stringify.mockRestore()
    }
  })

  it('6 tabelas 50x50 (64 KB) virariam 2,7 MB: o teto de células da nota recusa antes', () => {
    const content = Array.from({ length: 6 }, () => grid(50, 50))
    expect(property(content)).toMatchObject({ ok: false, issues: [{ path: '/2/content', keyword: 'maxCells', fatal: false }] })
  })

  it('os tetos de células valem com a largura completa (célula com props e sem content conta o colspan)', () => {
    // 51 linhas: largura 49 na entrada (2.499 células), 50 na forma completa (2.550).
    const rows = [{ cells: [{ type: 'tableCell', props: { colspan: 49 } }, 'x'] }, row(1), ...Array.from({ length: 49 }, () => row(49))]
    expect([tableWidth(rows, false), tableWidth(rows, true)]).toEqual([49, 50])
    const content = [tableBlock(rows)]
    expect(validateNoteContent(content).ok).toBe(true)
    expect(property(content)).toMatchObject({ ok: false, issues: [{ path: '/0/content', keyword: 'maxCells', fatal: false }] })
    // O mesmo vale para o teto da nota inteira: 2.500² + 2.000² + 1.500² é o teto
    // exato na entrada; com a largura completa, a terceira tem 1.550 células.
    const third = [{ cells: [{ type: 'tableCell', props: { colspan: 30 } }, 'x'] }, row(1), ...Array.from({ length: 48 }, () => row(30))]
    const three = [grid(50, 50), grid(40, 50), tableBlock(third)]
    expect(validateNoteContent(three).ok).toBe(true)
    expect(property(three)).toMatchObject({ ok: false, issues: [{ path: '/2/content', keyword: 'maxCells', message: expect.stringMatching(/nota inteira/) as unknown }] })
  })

  it('card de projeto sem snapshot não é aceito (o padrão {} que o normalize gravaria o contrato recusa)', () => {
    for (const content of [[{ type: 'projectCard', props: { cardId: 'c', boardId: 'b' } }], [{ type: 'projectCard' }], [{ type: 'projectCard', props: { snapshot: '{}' } }]]) {
      expect(validateNoteContent(content).ok).toBe(false)
      expect(property(content).ok).toBe(false)
    }
  })
})

describe('bordas do percurso e do normalize', () => {
  it('headerRows null ou 0 só aparecem na forma parcial; na completa são contrato', () => {
    const cellFull = (text: string) => ({ type: 'tableCell', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', colspan: 1, rowspan: 1 }, content: [{ type: 'text', text, styles: {} }] })
    const full = (extra: Record<string, unknown>) => [{
      id: 't', type: 'table', props: { textColor: 'default' }, children: [],
      content: { type: 'tableContent', columnWidths: [null], rows: [{ cells: [cellFull('a')] }], ...extra },
    }]
    expect(issuesOf(full({}), { form: 'full' })).toEqual([])
    expect(one(full({ headerRows: null }), { form: 'full' })).toEqual([{ path: '/0/content/headerRows', keyword: 'type', fatal: false }])
    expect(one(full({ headerCols: 0 }), { form: 'full' })).toEqual([{ path: '/0/content/headerCols', keyword: 'minimum', fatal: false }])
    expect(issuesOf(full({ headerRows: null, headerCols: 0 }))).toEqual([])
  })

  it('célula com content que não é texto nem lista é fatal', () => {
    const table = [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', props: {}, content: 5 }] }] } }]
    expect(one(table)).toEqual([{ path: '/0/content/rows/0/cells/0/content', keyword: 'type', fatal: true }])
  })

  it('conteúdo que o JSON.stringify não mede (ciclo) vira maxBytes, nunca exceção', () => {
    const block: Record<string, unknown> = { type: 'paragraph', content: 'a' }
    const note = [block]
    block.children = note
    const issues = issuesOf(note)
    expect(issues.some(i => i.keyword === 'maxBytes' && !i.fatal)).toBe(true)
    expect(issues.some(i => i.fatal)).toBe(true)
  })

  it('newId que repete ids é erro de programação: o normalize lança em vez de gravar ids iguais', () => {
    expect(() => normalizeNoteContent([{ type: 'paragraph' }, { type: 'paragraph' }], { newId: () => 'mesmo' })).toThrow('newId devolveu ids repetidos')
  })

  it('erro que não é o do teto de bytes sobe (não vira maxBytes)', () => {
    expect(() => normalizeNoteContent([{ type: 'paragraph' }], { newId: () => { throw new TypeError('sem gerador') } })).toThrow('sem gerador')
  })
})

describe('toSchemaIssues', () => {
  it('tira o campo fatal (não documentado no corpo do erro) e põe os fatais primeiro', () => {
    const issues: BlockIssue[] = [
      { path: '/0/props/foo', keyword: 'additionalProperties', message: 'a', fatal: false },
      { path: '/1/type', keyword: 'enum', message: 'b', fatal: true },
    ]
    expect(toSchemaIssues(issues)).toEqual([
      { path: '/1/type', keyword: 'enum', message: 'b' },
      { path: '/0/props/foo', keyword: 'additionalProperties', message: 'a' },
    ])
  })
})

describe('newProjectCardIds (API-044)', () => {
  const block = (id: string | undefined, snapshot = '{}') => ({ ...(id ? { id } : {}), type: 'projectCard', props: { cardId: 'c', boardId: 'b', snapshot } })

  it('novos, sem id ou com props alteradas; os iguais ficam de fora', () => {
    const before = [block('a'), { id: 'p', type: 'paragraph' }, block('b')]
    const after = [
      block('a'),
      { id: 'p', type: 'projectCard', props: {} },
      { id: 'x', type: 'paragraph', children: [block('n'), block(undefined)] },
      block('b', '{"title":"inventado"}'),
    ]
    expect(newProjectCardIds(before, after)).toEqual([
      { id: 'p', path: '/1' },
      { id: 'n', path: '/2/children/0' },
      { id: null, path: '/2/children/1' },
      { id: 'b', path: '/3' },
    ])
    expect(newProjectCardIds(before, before)).toEqual([])
    expect(newProjectCardIds(null, 'x')).toEqual([])
  })
})

describe('desempenho', () => {
  it('5000 blocos cuja forma canônica beira os 2 MiB: valida e normaliza bem abaixo do teto de CPU da edge', () => {
    const content = Array.from({ length: LIMITS.maxBlocks }, (_, i) => ({ id: `b${i}`, type: 'paragraph', content: [text(i, 220)] }))
    const started = performance.now()
    const result = validateNoteContent(content)
    expect(result.issues).toEqual([])
    const normalized = normalizeNoteContent(content)
    if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))
    expect(performance.now() - started).toBeLessThan(1500)
    // A forma canônica (props e children em cada bloco) é a que conta, e cabe.
    const bytes = jsonBytes(normalized.blocks)
    expect(bytes).toBeGreaterThan(1_950_000)
    expect(bytes).toBeLessThanOrEqual(LIMITS.maxBytes)
  })

  it('a mesma nota com textos maiores cabe na entrada, mas não na forma canônica: maxBytes', () => {
    const content = Array.from({ length: LIMITS.maxBlocks }, (_, i) => ({ id: `b${i}`, type: 'paragraph', content: [text(i, 300)] }))
    expect(validateNoteContent(content).issues).toEqual([])
    expect(normalizeNoteContent(content)).toMatchObject({ ok: false, issues: [{ path: '', keyword: 'maxBytes', fatal: false }] })
  })
})

function text(i: number, length: number) {
  return { type: 'text', text: `${i} `.padEnd(length, 'x'), styles: i % 2 ? { bold: true } : {} }
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

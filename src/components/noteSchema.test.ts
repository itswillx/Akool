// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement, type FC } from 'react'
import { BlockNoteEditor } from '@blocknote/core'
import { jsPDF } from 'jspdf'
import { cleanup, render } from '@testing-library/react'

// API-020: compatibilidade do validador (supabase/functions/_domain/blocknote)
// com o BlockNote de verdade. Fica aqui porque a fronteira do API-005 não deixa
// o @blocknote/core entrar em _domain; as fixtures vêm por import.meta.glob
// (node:fs em src quebraria o tsc -b). Prova:
// - o spec é o schema real do NoteEditor;
// - cada fixture válida passa no validador e, normalizada, é ponto fixo do
//   editor (create, mount, render do card e PDF sem exceção);
// - cada fixture fatal o validador recusa, e o BlockNote (ou o render, ou o
//   PDF) de fato quebra;
// - mutação com semente fixa: sem problema fatal ⇒ create, mount, render do
//   card e do diagrama e PDF sem exceção (a guarda do NoteEditor depende disso);
//   e aceito na forma parcial ⇒ o normalize devolve uma saída que passa na
//   completa, carrega igual no editor e normalizada de novo não muda.

// Os renders React dos blocos custom, para desenhar o card fora do editor.
const renders = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@blocknote/react', async importOriginal => {
  const mod = await importOriginal<typeof import('@blocknote/react')>()
  const capture = ((config: { type: string }, impl: { render: unknown }, ...rest: unknown[]) => {
    renders.set(config.type, impl.render)
    return (mod.createReactBlockSpec as (...args: unknown[]) => unknown)(config, impl, ...rest)
  }) as unknown as typeof mod.createReactBlockSpec
  return { ...mod, createReactBlockSpec: capture }
})
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../contexts/PagesContext', () => ({ usePages: () => ({ setActivePanel: () => {} }) }))
// O canvas do Excalidraw é lazy e pesado; aqui só importa que o bloco renderize.
vi.mock('./DiagramCanvas', () => ({ default: () => null }))

import { noteSchema } from './noteSchema'
import { extractBlocks } from '../lib/pdf/noteBlocks'
import { renderLine } from '../lib/pdf/textRender'
import { BLOCK_SPECS, INLINE_TYPES, MAX_INLINE_NODES, STYLE_SPECS, TABLE_CELL_DEFAULTS } from '../../supabase/functions/_domain/blocknote/spec'
import { findFatalNoteIssue, validateNoteContent } from '../../supabase/functions/_domain/blocknote/schema'
import { normalizeNoteContent } from '../../supabase/functions/_domain/blocknote/normalize'

interface FatalFixture { content: unknown[]; path: string; keyword: string; breaks: 'create' | 'mount' | 'card' | 'corrupt' }
const entries = <T>(map: Record<string, T>) => Object.entries(map).map(([file, value]) => [file.split('/').pop()!.replace('.json', ''), value] as [string, T]).sort()
const VALID = entries(import.meta.glob<unknown[]>('../../supabase/functions/_domain/blocknote/fixtures/valid/*.json', { eager: true, import: 'default' }))
const PARTIAL = entries(import.meta.glob<unknown[]>('../../supabase/functions/_domain/blocknote/fixtures/partial/*.json', { eager: true, import: 'default' }))
const FATAL = entries(import.meta.glob<FatalFixture>('../../supabase/functions/_domain/blocknote/fixtures/fatal/*.json', { eager: true, import: 'default' }))

const t = (key: string) => key
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const create = (content: unknown[]) => BlockNoteEditor.create({ schema: noteSchema, ...(content.length > 0 ? { initialContent: content as never } : {}) })

// O happy-dom aceita qualquer nome em createElement; o navegador lança
// InvalidCharacterError (é o que derruba o heading com level '1 2' de verdade).
const VALID_TAG = /^[A-Za-z][A-Za-z0-9._:-]*$/
let restoreDom: (() => void) | null = null
beforeAll(() => {
  const original = document.createElement.bind(document)
  const strict = (name: string, options?: ElementCreationOptions) => {
    if (!VALID_TAG.test(name)) throw new DOMException(`'${name}' is not a valid tag name`, 'InvalidCharacterError')
    return original(name, options)
  }
  const spy = vi.spyOn(document, 'createElement').mockImplementation(strict)
  restoreDom = () => spy.mockRestore()
})
afterAll(() => restoreDom?.())

function mount(editor: ReturnType<typeof create>) {
  const div = document.createElement('div')
  document.body.appendChild(div)
  try {
    editor.mount(div)
    editor.unmount()
  } finally {
    div.remove()
  }
}

type BlockView = FC<{ block: unknown; editor: unknown; contentRef: (el: HTMLElement | null) => void }>
const fakeEditor = { isEditable: false, updateBlock: () => {}, getBlock: () => undefined }

/** Desenha o render React do bloco (card ou diagrama) fora do editor; lança se o render lançar. */
function renderBlock(type: 'projectCard' | 'diagram', props: unknown) {
  const View = renders.get(type) as BlockView
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    render(createElement(View, { block: { id: 'b', type, props, children: [] }, editor: fakeEditor, contentRef: () => {} }))
  } finally {
    cleanup()
    quiet.mockRestore()
  }
}

function customBlocks(content: unknown, found: { type: 'projectCard' | 'diagram'; props: unknown }[] = [], depth = 0): typeof found {
  if (!Array.isArray(content) || depth > 70) return found
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: unknown; props?: unknown; children?: unknown }
    if (b.type === 'projectCard' || b.type === 'diagram') found.push({ type: b.type, props: b.props })
    customBlocks(b.children, found, depth + 1)
  }
  return found
}

function pdf(content: unknown[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  for (const line of extractBlocks(content, t)) renderLine(doc, line, 20)
}

describe('paridade do spec com o schema real do NoteEditor', () => {
  it('os 16 tipos, o content e o propSchema de cada um (na mesma ordem)', () => {
    const real = Object.fromEntries(Object.entries(noteSchema.blockSchema).map(([type, spec]) => [type, { content: spec.content, propSchema: spec.propSchema }]))
    expect(real).toEqual(json(BLOCK_SPECS))
    for (const [type, spec] of Object.entries(BLOCK_SPECS)) {
      expect(Object.keys(real[type].propSchema), type).toEqual(Object.keys(spec.propSchema))
    }
  })

  it('os 7 estilos, o conteúdo em linha e os padrões da célula de tabela', () => {
    expect(Object.fromEntries(Object.entries(noteSchema.styleSchema).map(([name, spec]) => [name, spec.propSchema]))).toEqual(STYLE_SPECS)
    expect(Object.keys(noteSchema.inlineContentSchema)).toEqual([...INLINE_TYPES])
    const table = create([{ type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a'] }] } }]).document[0].content as { rows: { cells: { props: unknown }[] }[] }
    expect(JSON.stringify(table.rows[0].cells[0].props)).toBe(JSON.stringify(TABLE_CELL_DEFAULTS))
  })

  it('só o codeBlock guarda o texto inteiro (spec.code): o validador conta os nós em linha por isso', () => {
    const nodes = create([]).pmSchema.nodes
    expect(Object.values(nodes).filter(node => node.spec.code).map(node => node.name)).toEqual(['codeBlock'])
  })
})

describe('nós em linha: o teto fatal fica abaixo do que derruba o create', () => {
  const lines = (n: number) => 'a\n'.repeat(n)
  const text = (value: string, styles: Record<string, boolean> = {}) => ({ type: 'text', text: value, styles })

  it('logo abaixo do teto (30 mil nós num item) carrega e volta igual', () => {
    const content = [{ type: 'paragraph', content: [text(lines(14_999) + 'a')] }]
    expect(findFatalNoteIssue(content)).toBeNull()
    expect(validateNoteContent(content).issues).toEqual([])
    const normalized = normalizeNoteContent(content, { newId: () => 'id-1' })
    if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))
    expect(JSON.stringify(create(json(normalized.blocks)).document)).toBe(JSON.stringify(normalized.blocks))
  })

  it('o link soma as partes: cinco partes abaixo do teto derrubam o create juntas', () => {
    const parts = Array.from({ length: 5 }, (_, i) => text(lines(14_000), i % 2 ? { bold: true } : {}))
    const content = [{ type: 'paragraph', content: [{ type: 'link', href: 'https://exemplo.com', content: parts }] }]
    expect(findFatalNoteIssue(content)).toMatchObject({ path: '/0/content/0', keyword: 'maxInlineNodes' })
    expect(() => create(json(content))).toThrow()
    // As mesmas partes como itens soltos não derrubam (cada uma é um push), mas a API recusa a soma.
    const loose = [{ type: 'paragraph', content: parts }]
    expect(findFatalNoteIssue(loose)).toBeNull()
    expect(() => create(json(loose))).not.toThrow()
    expect(validateNoteContent(loose).issues).toMatchObject([{ path: '/0/content', keyword: 'maxInlineNodes', fatal: false }])
  })

  it('célula em texto com muitas quebras carrega uma vez, mas a forma que o editor devolve não abre de novo', () => {
    const content = [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [lines(60_000)] }] } }]
    expect(findFatalNoteIssue(content)).toMatchObject({ path: '/0/content/rows/0/cells/0', keyword: 'maxInlineNodes' })
    const saved = json(create(json(content)).document)
    expect(() => create(saved)).toThrow()
    expect(2 * 60_000).toBeGreaterThan(MAX_INLINE_NODES)
  })
})

describe('fixtures válidas: ponto fixo do editor', () => {
  it.each([...VALID, ...PARTIAL])('%s', (_name, fixture) => {
    expect(validateNoteContent(fixture).issues).toEqual([])
    // O que o validador aceita carrega como veio.
    expect(() => create(json(fixture))).not.toThrow()

    let n = 0
    const normalized = normalizeNoteContent(fixture, { newId: () => `gerado-${++n}` })
    if (!normalized.ok) throw new Error(JSON.stringify(normalized.issues))
    const editor = create(json(normalized.blocks))
    expect(JSON.stringify(editor.document)).toBe(JSON.stringify(normalized.blocks))
    mount(editor)
    expect(normalizeNoteContent(normalized.blocks)).toEqual(normalized)

    for (const block of customBlocks(editor.document)) renderBlock(block.type, block.props)
    expect(() => pdf(normalized.blocks)).not.toThrow()
  })
})

describe('fixtures fatais: o validador recusa, e o BlockNote de fato quebra', () => {
  it.each(FATAL)('%s', (_name, fixture) => {
    expect(validateNoteContent(fixture.content).issues[0]).toMatchObject({ path: fixture.path, keyword: fixture.keyword, fatal: true })
    expect(findFatalNoteIssue(fixture.content)).not.toBeNull()
    const content = json(fixture.content)
    if (fixture.breaks === 'create') {
      expect(() => create(content)).toThrow()
    } else if (fixture.breaks === 'mount') {
      const editor = create(content)
      expect(() => mount(editor)).toThrow()
    } else if (fixture.breaks === 'card') {
      // As props que o editor entrega ao render do bloco.
      const [card] = customBlocks(create(content).document)
      expect(() => renderBlock('projectCard', card.props)).toThrow()
    } else {
      // Id repetido: editar o segundo bloco grava no primeiro (DiagramBlockView.saveNow/toggleCollapsed).
      const editor = create(content)
      editor.updateBlock(editor.document[1], { type: 'diagram', props: { collapsed: 'true' } } as never)
      expect(editor.document.map(b => (b.props as { collapsed?: string }).collapsed)).toEqual(['true', 'false'])
    }
  })
})

// ── Mutação com semente fixa ──────────────────────────────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// Texto com 120 mil nós (o create estoura a pilha com uns 110 mil).
const MANY_BREAKS = 'a\n'.repeat(60_000)
const POOL: unknown[] = [
  null, 0, -1, 1, 2, 3, 7, 1.5, 51, 100000, '', 'x', 'a\nb', '1 2', 'default', 'rgb(1, 2, 3)', 'javascript:alert(1)', '#fff', 'true',
  true, false, [], {}, [null], ['x'], [1, 2], { a: 1 },
  { type: 'text', text: 'x', styles: {} }, { type: 'text', text: 'y', styles: { bold: true } },
  { type: 'link', href: 'https://exemplo.com', content: 'l' }, { type: 'paragraph', content: 'p' }, { type: 'heading', props: { level: 2 }, content: 'h' },
  { type: 'tableCell', props: { colspan: 2 }, content: 'c' }, { type: 'tableCell', props: { rowspan: 2 }, content: [] }, { type: 'tableCell', props: { colspan: 2 } },
  { type: 'divider' }, { type: 'projectCard', props: { snapshot: '{}' } }, { type: 'projectCard', props: { cardId: '', boardId: '' } },
  MANY_BREAKS, { type: 'text', text: MANY_BREAKS, styles: {} }, { type: 'link', href: 'https://exemplo.com', content: MANY_BREAKS },
  'paragraph', 'heading', 'table', 'diagram', 'projectCard', 'callout', 'constructor',
]
const KEYS = ['foo', 'id', 'type', 'props', 'content', 'children', 'styles', 'text', 'href', 'level', 'colspan', 'rowspan', 'headerRows', 'headerCols', 'columnWidths', 'cells', 'rows', 'title', 'labels', 'checklist', 'completed', 'description', 'boardName', 'priority', 'dueDate']
const JSON_PROPS = new Set(['snapshot', 'elements', 'appState'])

type Slot = { parent: Record<string, unknown> | unknown[]; key: string | number }

function slots(root: unknown): Slot[] {
  const out: Slot[] = []
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) node.forEach((v, i) => { out.push({ parent: node, key: i }); stack.push(v) })
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) { out.push({ parent: node as Record<string, unknown>, key: k }); stack.push(v) }
    }
  }
  return out
}

function mutate(root: unknown[], rand: () => number): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]
  const all = slots(root)
  if (all.length === 0) return 'vazio'
  const slot = pick(all)
  const current = (slot.parent as Record<string | number, unknown>)[slot.key]
  // Props com JSON em texto: muda dentro do JSON e grava de novo.
  if (typeof current === 'string' && JSON_PROPS.has(String(slot.key)) && rand() < 0.8) {
    let inner: unknown
    try { inner = JSON.parse(current) } catch { inner = {} }
    const wrapper = [inner]
    const what = mutate(wrapper, rand)
    ;(slot.parent as Record<string, unknown>)[slot.key] = JSON.stringify(wrapper[0])
    return `${String(slot.key)}{${what}}`
  }
  const op = Math.floor(rand() * 5)
  const value = json(pick(POOL))
  if (op === 0 || op === 1) {
    (slot.parent as Record<string | number, unknown>)[slot.key] = value
    return `set ${String(slot.key)}=${JSON.stringify(value)}`
  }
  if (op === 2) {
    if (Array.isArray(slot.parent)) slot.parent.splice(Number(slot.key), 1)
    else delete slot.parent[String(slot.key)]
    return `del ${String(slot.key)}`
  }
  if (op === 3) {
    if (Array.isArray(slot.parent)) {
      // Duplica um item da lista (bloco com o mesmo id, célula a mais…).
      slot.parent.splice(Number(slot.key), 0, json(current))
      return `dup ${String(slot.key)}`
    }
    slot.parent[pick(KEYS)] = value
    return `add ${JSON.stringify(value)}`
  }
  if (current && typeof current === 'object') {
    const key = pick(KEYS)
    ;(current as Record<string, unknown>)[key] = value
    return `in ${String(slot.key)}.${key}=${JSON.stringify(value)}`
  }
  (slot.parent as Record<string | number, unknown>)[slot.key] = pick(['paragraph', 'heading', 'table', 'codeBlock', 'divider', 'projectCard', 'diagram', 'image'])
  return `type ${String(slot.key)}`
}

/** Aceito na forma parcial ⇒ o normalize dá certo, e a saída é forma completa, ponto fixo do editor e do normalize. */
function normalizedProblem(content: unknown[]): string | null {
  let n = 0
  const normalized = normalizeNoteContent(content, { newId: () => `m-${++n}` })
  if (!normalized.ok) return `normalize recusou: ${JSON.stringify(normalized.issues[0])}`
  const full = validateNoteContent(normalized.blocks, { form: 'full' })
  if (!full.ok) return `saída fora da forma completa: ${JSON.stringify(full.issues[0])}`
  if (JSON.stringify(normalizeNoteContent(normalized.blocks)) !== JSON.stringify(normalized)) return 'normalize não é idempotente'
  // Nota vazia: o editor abre com um parágrafo vazio (e o app trata [] como página nova).
  if (normalized.blocks.length > 0 && JSON.stringify(create(json(normalized.blocks)).document) !== JSON.stringify(normalized.blocks)) {
    return 'a saída não é ponto fixo do editor'
  }
  return null
}

describe('mutação com semente fixa', () => {
  it('sem problema fatal ⇒ create, mount, render do card e do diagrama e PDF sem exceção; aceito ⇒ normalize coerente', () => {
    const rand = mulberry32(20261007)
    const seeds = [...VALID, ...PARTIAL].map(([, content]) => content)
    const failures: string[] = []
    let accepted = 0
    let strict = 0
    let fatalBreaks = 0
    for (let i = 0; i < 500; i++) {
      const content = json(seeds[i % seeds.length])
      const steps = [mutate(content, rand)]
      if (rand() < 0.4) steps.push(mutate(content, rand))
      const fatal = findFatalNoteIssue(content)
      if (fatal) {
        if (fatal.keyword === 'maxInlineNodes') fatalBreaks++
        continue
      }
      accepted++
      const where = `#${i} ${steps.join(' · ')}`
      try {
        const editor = create(json(content))
        mount(editor)
        // O render do bloco recebe as props do editor (padrões preenchidos).
        for (const block of customBlocks(editor.document)) renderBlock(block.type, block.props)
        pdf(content)
        if (validateNoteContent(content).ok) {
          strict++
          const problem = normalizedProblem(content)
          if (problem) failures.push(`${where}: ${problem}`)
        }
      } catch (err) {
        failures.push(`${where}: ${String(err).slice(0, 160)}`)
      }
    }
    expect(failures).toEqual([])
    // A propriedade não pode passar no vazio.
    expect(accepted).toBeGreaterThan(150)
    expect(strict).toBeGreaterThan(50)
    expect(fatalBreaks).toBeGreaterThan(0)
  }, 60_000)
})


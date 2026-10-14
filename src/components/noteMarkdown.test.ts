// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement, type FC } from 'react'
import { BlockNoteEditor } from '@blocknote/core'
import { jsPDF } from 'jspdf'
import { cleanup, render } from '@testing-library/react'

// API-023: o Markdown sem DOM (supabase/functions/_domain/blocknote/markdown.ts
// e render.ts) contra o BlockNote de verdade. Fica aqui pelo mesmo motivo do
// noteSchema.test.ts: a fronteira do API-005 não deixa o @blocknote/core entrar
// em _domain, e as fixtures vêm por import.meta.glob (node:fs em src quebraria
// o tsc -b). Prova:
// - o exemplo e o note-markdown.md viram blocos que o editor abre como vieram
//   (ponto fixo), monta, desenha os blocos de marcador e exporta em PDF;
// - leitura: no corpus, o nosso parser lê como a colagem do app
//   (tryParseMarkdownToBlocks), menos as divergências de propósito, que ficam
//   na tabela DIVERGENCIAS (o teste falha se uma delas deixar de existir);
// - escrita: a colagem do app lê o Markdown do nosso render igual ao nosso
//   parser (no subconjunto sem URL solta, cujo autolink no app ignora o escape);
// - fuzz com semente: Markdown aleatório aceito ⇒ ponto fixo do editor, mount e PDF.

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
vi.mock('./DiagramCanvas', () => ({ default: () => null }))

import { noteSchema } from './noteSchema'
import { extractBlocks } from '../lib/pdf/noteBlocks'
import { renderLine } from '../lib/pdf/textRender'
import { markdownToNote } from '../../supabase/functions/_domain/blocknote/markdown'
import { blocksToMarkdown, MARKER_TYPES } from '../../supabase/functions/_domain/blocknote/render'
import { normalizeNoteContent } from '../../supabase/functions/_domain/blocknote/normalize'
import { GEN_PAGE, GEN_USER, markdownGenerator, noteGenerator } from '../../supabase/functions/_domain/blocknote/fixtures/markdown/generator'

type Block = Record<string, unknown>
const entries = <T>(map: Record<string, T>, ext: string) => Object.entries(map).map(([file, value]) => [file.split('/').pop()!.replace(ext, ''), value] as [string, T]).sort()
const MARKDOWN = Object.fromEntries(entries(import.meta.glob<string>('../../supabase/functions/_domain/blocknote/fixtures/markdown/*.md', { query: '?raw', import: 'default', eager: true }), '.md'))
const CORPUS = entries(import.meta.glob<string>('../../supabase/functions/_domain/blocknote/fixtures/markdown/corpus/*.md', { query: '?raw', import: 'default', eager: true }), '.md')
const EXEMPLO = (await import('../../supabase/functions/_domain/blocknote/fixtures/markdown/exemplo.json')).default as unknown as Block[]
const NOTE_MARKDOWN = (await import('../../supabase/functions/_domain/blocknote/fixtures/valid/note-markdown.json')).default as unknown as Block[]
const VALID = entries(import.meta.glob<unknown[]>('../../supabase/functions/_domain/blocknote/fixtures/valid/*.json', { eager: true, import: 'default' }), '.json')

const IMAGES = { userId: GEN_USER, pageId: GEN_PAGE }
const t = (key: string) => key
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const create = (content: unknown[]) => BlockNoteEditor.create({ schema: noteSchema, ...(content.length > 0 ? { initialContent: content as never } : {}) })
const oracle = create([])

const VALID_TAG = /^[A-Za-z][A-Za-z0-9._:-]*$/
let restoreDom: (() => void) | null = null
beforeAll(() => {
  const original = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation((name: string, options?: ElementCreationOptions) => {
    if (!VALID_TAG.test(name)) throw new DOMException(`'${name}' is not a valid tag name`, 'InvalidCharacterError')
    return original(name, options)
  })
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

function pdf(content: unknown[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  for (const line of extractBlocks(content, t)) renderLine(doc, line, 20)
}

/** Abre no editor e confere: ponto fixo, mount, blocos custom e PDF. */
function opensInEditor(blocks: unknown[]): void {
  // Nota vazia: o editor abre com um parágrafo vazio (o app trata [] como página nova).
  if (blocks.length === 0) return
  const editor = create(json(blocks))
  expect(JSON.stringify(editor.document)).toBe(JSON.stringify(blocks))
  mount(editor)
  for (const block of editor.document as Block[]) {
    if (block.type === 'projectCard' || block.type === 'diagram') renderBlock(block.type, block.props)
  }
  expect(() => pdf(blocks)).not.toThrow()
}

const stripIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (k, v: unknown) => (k === 'id' ? undefined : v))) as unknown

/**
 * Forma comparável das duas leituras: sem ids e com os espaços em volta da
 * quebra dura e nas bordas do conteúdo tirados (a colagem do app põe um espaço
 * depois da quebra, às vezes noutro trecho, e um no começo de alguns itens de
 * checklist); o caminho relativo da imagem perde o host que a colagem
 * acrescenta (http://localhost:3000/ no happy-dom).
 */
function comparable(blocks: unknown): unknown {
  type Run = { text: string; styles: string; href: string | null }
  const fixInline = (items: unknown[]): unknown[] => {
    const runs: Run[] = []
    for (const raw of items as Block[]) {
      if (raw.type === 'link') for (const part of raw.content as Block[]) runs.push({ text: String(part.text), styles: JSON.stringify(part.styles), href: String(raw.href) })
      else runs.push({ text: String(raw.text), styles: JSON.stringify(raw.styles), href: null })
    }
    runs.forEach((run, i) => {
      run.text = run.text.replace(/ *\n */g, '\n')
      if (i === 0 || runs[i - 1].text.endsWith('\n')) run.text = run.text.replace(/^ +/, '')
    })
    if (runs.length > 0) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, '')
    const out: Block[] = []
    for (const run of runs.filter(r => r.text !== '')) {
      const last = out[out.length - 1]
      const lastRun = last ? (last.type === 'link' ? (last.content as Block[])[(last.content as Block[]).length - 1] : last) : null
      const lastHref = last && last.type === 'link' ? String(last.href) : null
      if (lastRun && lastHref === run.href && JSON.stringify(lastRun.styles) === run.styles) {
        lastRun.text = `${String(lastRun.text)}${run.text}`
        continue
      }
      const text = { type: 'text', text: run.text, styles: JSON.parse(run.styles) as unknown }
      if (run.href === null) out.push(text)
      else if (last && last.type === 'link' && lastHref === run.href) (last.content as Block[]).push(text)
      else out.push({ type: 'link', href: run.href, content: [text] })
    }
    return out
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (!value || typeof value !== 'object') return value
    const out: Block = {}
    for (const [k, v] of Object.entries(value as Block)) {
      if (k === 'id') continue
      if (k === 'url' && typeof v === 'string') out[k] = v.replace(/^http:\/\/localhost:3000\//, '')
      else if (k === 'content' && Array.isArray(v)) out[k] = fixInline(v)
      else out[k] = walk(v)
    }
    return out
  }
  return walk(blocks)
}

/** O primeiro bloco raiz que difere, para a mensagem de falha. */
function firstDifference(a: unknown, b: unknown): string {
  const x = Array.isArray(a) ? a : [a]
  const y = Array.isArray(b) ? b : [b]
  let i = 0
  while (i < Math.max(x.length, y.length) && JSON.stringify(x[i]) === JSON.stringify(y[i])) i++
  return `bloco ${i}\nnosso=${JSON.stringify(x[i])}\napp=${JSON.stringify(y[i])}`
}

const ours = (md: string): unknown => {
  const r = markdownToNote(md, { images: IMAGES })
  return r.ok ? r.blocks : { erro: r.issues.map(i => i.keyword) }
}
const theirs = (md: string): unknown => json(oracle.tryParseMarkdownToBlocks(md))

describe('o Markdown de exemplo abre no editor real', () => {
  it('exemplo.md (com a nota dos marcadores): ponto fixo, mount, diagrama, card e PDF', () => {
    const existing = EXEMPLO.filter(b => MARKER_TYPES.includes(String(b.type)) || b.type === 'image')
    let n = 0
    const r = markdownToNote(MARKDOWN.exemplo, { existing, images: { userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', pageId: '9b2f1c3a-5d4e-4f60-8a7b-1c2d3e4f5a6b' }, newId: () => `novo-${++n}` })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(stripIds(r.blocks)).toEqual(stripIds(EXEMPLO))
    const types = new Set<string>(r.blocks.map(b => b.type))
    for (const type of ['diagram', 'projectCard', 'file', 'image', 'table', 'codeBlock', 'quote']) expect(types.has(type), type).toBe(true)
    opensInEditor(r.blocks)
  })

  it('note-markdown.md: os mesmos blocos de fixtures/valid/note-markdown.json', () => {
    const r = markdownToNote(MARKDOWN['note-markdown'])
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(stripIds(r.blocks)).toEqual(stripIds(NOTE_MARKDOWN))
    opensInEditor(r.blocks)
  })
})

// Divergências de propósito entre o nosso parser e a colagem do app (remark +
// HTML + DOM no happy-dom). Cada uma é um caso do corpus; o teste falha se ela
// deixar de existir (subiu o BlockNote? confira e tire daqui).
const DIVERGENCIAS: Record<string, string> = {
  'checklist-numerada': 'o nosso lê `1. [ ] x` como checklist; a colagem perde a caixa e deixa o item numerado',
  'checklist-vazio': 'o nosso lê `- [ ]` como checklist vazio; a colagem, como item com o texto "[ ]"',
  'citacao-com-lista': 'o nosso achata a citação em linhas (com aviso); a colagem junta os itens com espaço',
  'entidade-rara': 'o nosso conhece só as entidades nomeadas comuns (e as acentuadas): &spades; fica literal',
  'html-bloco': 'o nosso não tem bloco HTML (só comentário): o texto vira Markdown; a colagem descarta o bloco',
  'imagem-com-legenda': 'o nosso guarda o título da imagem como legenda; a colagem o ignora',
  'imagem-na-celula': 'o nosso deixa o texto alternativo na célula (com aviso); a colagem deixa a célula vazia',
  'imagem-no-meio': 'o nosso divide o parágrafo e mantém a imagem (com aviso); a colagem descarta a imagem',
  'imagem-no-titulo': 'o nosso põe a imagem depois do título (com aviso); a colagem a descarta',
  'item-com-comentario': 'o nosso usa `- <!-- -->` para o item vazio com filho; a colagem faz do filho o conteúdo',
  'link-com-codigo': 'a colagem perde o link de um código dentro de link; o nosso mantém os dois',
  'link-com-espaco': 'a colagem codifica o destino (espaço vira %20); o nosso guarda como veio',
  'lista-delimitador-trocado': 'o nosso dá start: 1 à lista que vem logo depois de outra numerada (o editor mostra 1); a colagem continua a numeração',
  'lista-depois-de-lista': 'idem, separada por `<!-- -->` (é a forma do nosso render)',
  'marcador-em-codigo': 'happy-dom: texto com `-->` sai duplicado na colagem (no navegador não); o nosso guarda o código literal',
  'marcador-escapado': 'happy-dom: idem, com o marcador escapado no texto',
  'nota-de-rodape': 'o nosso não tem nota de rodapé (fica texto, com aviso); a colagem cria a seção Footnotes',
  'quebra-br': 'o nosso lê `<br>` como quebra de linha (é o que o render usa em título e célula); a colagem o descarta',
  'tabela-alinhamento': 'o nosso guarda o alinhamento da coluna nas células; a colagem deixa tudo à esquerda',
  'texto-com-fim-de-comentario': 'happy-dom: texto com `-->` sai duplicado na colagem (no navegador não)',
  'titulo-no-item': 'o nosso lê `- # título` como item vazio com um título filho; a colagem achata o título no item',
  'url-escapada': 'o escape bloqueia o autolink no nosso; na colagem, o autolink do GFM roda depois dos escapes',
}

describe('leitura: o corpus como a colagem do app lê', () => {
  it('toda divergência listada é um caso do corpus', () => {
    const names = new Set(CORPUS.map(([name]) => name))
    expect(Object.keys(DIVERGENCIAS).filter(name => !names.has(name))).toEqual([])
  })

  it.each(CORPUS)('%s', (name, md) => {
    const a = comparable(ours(md))
    const b = comparable(theirs(md))
    if (Object.hasOwn(DIVERGENCIAS, name)) expect(a, `divergência que deixou de existir: ${DIVERGENCIAS[name]}`).not.toEqual(b)
    else expect(a).toEqual(b)
  })
})

describe('escrita: a colagem do app lê o nosso Markdown igual', () => {
  it('notas geradas (sem URL solta) e as fixtures válidas sem blocos de marcador', () => {
    const next = noteGenerator(20261011, { pasteSafe: true })
    const notes: [string, unknown[]][] = []
    for (let i = 0; i < 120; i++) notes.push([`gerada #${i}`, next()])
    for (const [name, content] of VALID) {
      const kept = (content as Block[]).filter(b => !MARKER_TYPES.includes(String(b.type)) && b.type !== 'image')
      if (kept.length > 0) notes.push([name, kept])
    }
    const failures: string[] = []
    let n = 0
    for (const [name, content] of notes) {
      const norm = normalizeNoteContent(content, { newId: () => `g-${++n}` })
      if (!norm.ok) throw new Error(`${name}: ${JSON.stringify(norm.issues[0])}`)
      const md = blocksToMarkdown(norm.blocks).markdown
      const a = comparable(ours(md))
      const b = comparable(theirs(md))
      if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${name}\n${md}\n${firstDifference(a, b)}`)
    }
    expect(failures.slice(0, 3)).toEqual([])
  }, 60_000)
})

describe('fuzz com semente', () => {
  it('Markdown aleatório aceito ⇒ ponto fixo do editor, mount e PDF', () => {
    const next = markdownGenerator(20261012)
    const failures: string[] = []
    let accepted = 0
    for (let i = 0; i < 300; i++) {
      const md = next()
      const r = markdownToNote(md, { images: IMAGES })
      if (!r.ok) continue
      accepted++
      try {
        opensInEditor(r.blocks)
      } catch (err) {
        failures.push(`#${i} ${JSON.stringify(md)}: ${String(err).slice(0, 600)}`)
      }
    }
    expect(failures).toEqual([])
    expect(accepted).toBeGreaterThan(120)
  }, 60_000)
})

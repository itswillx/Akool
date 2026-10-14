import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { extractBlocks, inlineText, pdfSafe } from './noteBlocks'
import { renderLine } from './textRender'

// ARCH-005: a extração dos blocos da nota, sem jsPDF.
// API-020: a forma que o BlockNote grava de verdade (link com content, content
// em texto, tabela) e conteúdo fora da forma, que não pode derrubar o PDF.
const t = (key: string) => `[${key}]`

describe('noteBlocks', () => {
  it('inlineText junta texto, texto solto e o conteúdo dos links (a forma que o BlockNote grava)', () => {
    const content = [
      { type: 'text', text: 'veja ', styles: {} },
      { type: 'link', href: 'https://exemplo.com', content: [{ type: 'text', text: 'aqui', styles: { bold: true } }] },
      ' e ',
      { type: 'link', href: 'https://exemplo.com', content: 'ali' },
      null, { x: 1 },
    ]
    expect(inlineText(content)).toBe('veja aqui e ali')
    expect(inlineText('content em texto')).toBe('content em texto')
    expect(inlineText(5)).toBe('')
  })

  it('pdfSafe tira acentos e símbolos fora do ASCII', () => {
    expect(pdfSafe('Relatório — ação ✓')).toBe('Relatorio  acao ')
  })

  it('títulos, listas, código, parágrafo vazio e filhos', () => {
    const blocks = [
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Titulo' }] },
      { type: 'heading', props: { level: 5 }, content: [{ type: 'text', text: 'Fundo' }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'um' }], children: [{ type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'feito' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
      { type: 'paragraph', content: [] },
      { type: 'image' },
      { type: 'paragraph', content: [{ type: 'text', text: 'texto' }] },
    ]
    expect(extractBlocks(blocks, t)).toEqual([
      { text: 'Titulo', style: 'h2' },
      { text: 'Fundo', style: 'h3' },
      { text: '- um', style: 'li' },
      { text: '[x] feito', style: 'li' },
      { text: 'x = 1', style: 'code' },
      { text: '', style: 'blank' },
      { text: 'texto', style: 'p' },
    ])
  })

  it('content em texto (forma parcial) entra, inclusive no título', () => {
    expect(extractBlocks([{ type: 'paragraph', content: 'texto parcial' }, { type: 'heading', content: 'H' }], t)).toEqual([
      { text: 'texto parcial', style: 'p' },
      { text: 'H', style: 'h1' },
    ])
  })

  it('tabela sai como linhas "a | b"', () => {
    const table = { type: 'table', content: { type: 'tableContent', rows: [
      { cells: ['a', [{ type: 'text', text: 'b', styles: {} }]] },
      { cells: [{ type: 'tableCell', props: {}, content: [{ type: 'link', href: 'https://x', content: 'c' }] }, null] },
    ] } }
    expect(extractBlocks([table], t)).toEqual([
      { text: 'a | b', style: 'p' },
      { text: 'c | ', style: 'p' },
      { text: '', style: 'blank' },
    ])
  })

  it('título com nível fora de 1..6 vira parágrafo (o estilo h0 derrubava o jsPDF)', () => {
    const lines = extractBlocks([0, 7, '1 2', 1.5, null].map(level => ({ type: 'heading', props: { level }, content: 'x' })), t)
    expect(lines.map(l => l.style)).toEqual(['p', 'p', 'p', 'p', 'h1'])
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    for (const line of lines) expect(() => renderLine(doc, line, 20)).not.toThrow()
  })

  it('card de projeto: título, contexto, prioridade traduzida, prazo, descrição e checklist', () => {
    const snapshot = JSON.stringify({ title: 'Card', boardName: 'Quadro', columnName: 'Fazendo', priority: 'high', dueDate: '2026-10-02', completed: true, description: 'desc', checklist: [{ text: 'a', completed: false }] })
    const lines = extractBlocks([{ type: 'projectCard', props: { snapshot } }], t)
    expect(lines.map(l => l.text)).toEqual([
      'Card', 'Quadro · Fazendo', '[projects_priority]: [projects_priority_high]  |  [projects_due_date]: 2026-10-02  |  [pdf_card_completed]', 'desc', '[ ] a', '',
    ])
    expect(lines[0].style).toBe('h3')
  })

  it('card com snapshot ilegível vira só o rótulo', () => {
    expect(extractBlocks([{ type: 'projectCard', props: { snapshot: '{oops' } }], t).map(l => l.text)).toEqual(['[projects_table_card]', ''])
    expect(extractBlocks([{ type: 'projectCard', props: { snapshot: { title: 'objeto' } } }], t).map(l => l.text)).toEqual(['[projects_table_card]', ''])
  })

  it('campos do snapshot com tipo errado passam por coerção e não derrubam o jsPDF', () => {
    const snapshot = JSON.stringify({ title: ['a', 'b'], boardName: { a: 1 }, columnName: 3, priority: { x: 1 }, dueDate: 5, completed: 'sim', description: 7, checklist: [null, { text: { a: 1 }, completed: true }, 'x'] })
    const lines = extractBlocks([{ type: 'projectCard', props: { snapshot } }], t)
    expect(lines.map(l => l.text)).toEqual(['[projects_table_card]', '3', '[projects_due_date]: 5', '7', '[ ] ', '[x] ', '[ ] ', ''])
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    for (const line of lines) expect(() => renderLine(doc, line, 20)).not.toThrow()
  })

  it('bloco fora da forma é pulado sem derrubar o resto, e a recursão tem teto', () => {
    let deep: Record<string, unknown> = { type: 'paragraph', content: 'fundo' }
    for (let i = 0; i < 5000; i++) deep = { type: 'paragraph', content: 'n', children: [deep] }
    const lines = extractBlocks([null, 5, 'oi', { type: 7, props: 'x', content: { a: 1 } }, deep, { type: 'paragraph', content: 'fim' }], t)
    expect(lines.at(-1)).toEqual({ text: 'fim', style: 'p' })
    expect(lines.length).toBeLessThan(100)
  })
})

import { describe, expect, it } from 'vitest'
import { extractBlocks, inlineText, pdfSafe } from './noteBlocks'

// ARCH-005: a extração dos blocos da nota, sem jsPDF.
const t = (key: string) => `[${key}]`

describe('noteBlocks', () => {
  it('inlineText junta os trechos de texto e ignora o resto', () => {
    expect(inlineText([{ text: 'a' }, { type: 'link', text: 'b' }, null, { x: 1 }])).toBe('ab')
    expect(inlineText('não é lista')).toBe('')
  })

  it('pdfSafe tira acentos e símbolos fora do ASCII', () => {
    expect(pdfSafe('Relatório — ação ✓')).toBe('Relatorio  acao ')
  })

  it('títulos, listas, código, parágrafo vazio e filhos', () => {
    const blocks = [
      { type: 'heading', props: { level: 2 }, content: [{ text: 'Titulo' }] },
      { type: 'heading', props: { level: 5 }, content: [{ text: 'Fundo' }] },
      { type: 'bulletListItem', content: [{ text: 'um' }], children: [{ type: 'checkListItem', props: { checked: true }, content: [{ text: 'feito' }] }] },
      { type: 'codeBlock', content: [{ text: 'x = 1' }] },
      { type: 'paragraph', content: [] },
      { type: 'image' },
      { type: 'paragraph', content: [{ text: 'texto' }] },
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
  })
})

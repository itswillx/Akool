import { describe, expect, it, vi } from 'vitest'
import type { jsPDF } from 'jspdf'
import { CONTENT_W, MARGIN, PAGE_H } from './layout'
import { ensureLine, renderLine } from './textRender'

// ARCH-005: as linhas extraídas da nota viram texto no jsPDF, com fonte por
// estilo, fundo no código e quebra de página quando não cabe.

function fakeDoc(wrapTo = 1) {
  const calls: string[] = []
  const doc = {
    setFont: vi.fn((_f: string, style: string) => { calls.push(`font:${style}`) }),
    setFontSize: vi.fn((n: number) => { calls.push(`size:${n}`) }),
    splitTextToSize: vi.fn((text: string) => Array.from({ length: wrapTo }, () => text)),
    setFillColor: vi.fn(), setTextColor: vi.fn(),
    rect: vi.fn((...a: unknown[]) => { calls.push(`rect:${a.join(',')}`) }),
    text: vi.fn((_t: string[], x: number, y: number) => { calls.push(`text:${x},${y}`) }),
    addPage: vi.fn(() => { calls.push('addPage') }),
  }
  return { doc: doc as unknown as jsPDF, calls, raw: doc }
}

describe('renderLine', () => {
  it('linha em branco só avança, sem desenhar', () => {
    const { doc, calls } = fakeDoc()
    expect(renderLine(doc, { style: 'blank', text: '' }, 20)).toBe(23)
    expect(calls).toEqual([])
  })

  it('título sai em negrito, maior, e avança a altura do título', () => {
    const { doc, calls } = fakeDoc()
    const next = renderLine(doc, { style: 'h1', text: 'Título' }, 20)
    expect(calls).toEqual(['font:bold', 'size:16', `text:${MARGIN},20`])
    expect(next).toBe(20 + 8 + 3)
  })

  it('parágrafo quebrado em duas linhas avança as duas', () => {
    const { doc, calls } = fakeDoc(2)
    const next = renderLine(doc, { style: 'p', text: 'longo' }, 40)
    expect(calls).toEqual(['font:normal', 'size:10', `text:${MARGIN},40`])
    expect(next).toBe(40 + 2 * 5.5 + 2)
  })

  it('código ganha fundo cinza e recuo, e devolve a cor do texto ao preto', () => {
    const { doc, calls, raw } = fakeDoc()
    const next = renderLine(doc, { style: 'code', text: 'x = 1' }, 50)
    expect(raw.splitTextToSize).toHaveBeenCalledWith('x = 1', CONTENT_W - 4)
    expect(calls).toEqual(['font:normal', 'size:9', `rect:${MARGIN},${50 - 3.5},${CONTENT_W},${5 + 4},F`, `text:${MARGIN + 2},50`])
    expect(raw.setTextColor).toHaveBeenLastCalledWith(0, 0, 0)
    expect(next).toBe(50 + 5 + 2)
  })

  it('devolve -1 (sem desenhar) quando a linha não cabe na página', () => {
    const { doc, raw } = fakeDoc()
    expect(renderLine(doc, { style: 'p', text: 'fim' }, PAGE_H - MARGIN - 1)).toBe(-1)
    expect(raw.text).not.toHaveBeenCalled()
  })
})

describe('ensureLine', () => {
  it('abre página nova e desenha no topo quando não cabe', () => {
    const { doc, calls } = fakeDoc()
    const next = ensureLine(doc, { style: 'li', text: 'item' }, PAGE_H)
    expect(calls).toEqual(['font:normal', 'size:10', 'addPage', 'font:normal', 'size:10', `text:${MARGIN},${MARGIN}`])
    expect(next).toBe(MARGIN + 5.5 + 2)
  })

  it('não abre página quando cabe', () => {
    const { doc, raw } = fakeDoc()
    expect(ensureLine(doc, { style: 'p', text: 'ok' }, 30)).toBe(30 + 5.5 + 2)
    expect(raw.addPage).not.toHaveBeenCalled()
  })
})

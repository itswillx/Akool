// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { markdownToHtml, htmlToMarkdown } from './markdownHtml'

// Parse an HTML string into a detached element, like the contentEditable would hold.
function intoDom(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}
// Full round-trip: markdown the editor opens with → HTML → markdown it saves.
function roundTrip(md: string): string {
  return htmlToMarkdown(intoDom(markdownToHtml(md)))
}

describe('markdownToHtml', () => {
  it('emits real tags instead of markdown symbols', () => {
    expect(markdownToHtml('**Problema:** algo')).toContain('<strong>Problema:</strong>')
    expect(markdownToHtml('roda `npm test`')).toContain('<code>npm test</code>')
    expect(markdownToHtml('um *destaque*')).toContain('<em>destaque</em>')
  })
  it('keeps links as anchors (preserving relative paths too)', () => {
    expect(markdownToHtml('[x](https://a.com)')).toContain('<a href="https://a.com">x</a>')
    expect(markdownToHtml('[f](src/x.ts)')).toContain('<a href="src/x.ts">f</a>')
  })
  it('escapes HTML-significant chars in text', () => {
    expect(markdownToHtml('a < b & c')).toContain('a &lt; b &amp; c')
  })
  it('drops javascript: links to plain text', () => {
    const out = markdownToHtml('[x](javascript:alert(1))')
    expect(out).not.toContain('<a ')
    expect(out).toContain('x')
  })
})

describe('round-trip (markdown → html → markdown)', () => {
  it('preserves bold, italic and code', () => {
    expect(roundTrip('**negrito** e *ital* e `cod`')).toBe('**negrito** e *ital* e `cod`')
  })
  it('preserves http links', () => {
    expect(roundTrip('veja [docs](https://example.com)')).toBe('veja [docs](https://example.com)')
  })
  it('preserves relative file links (no data loss on edit)', () => {
    expect(roundTrip('**Arquivos:** [a.ts](src/a.ts)')).toBe('**Arquivos:** [a.ts](src/a.ts)')
  })
  it('preserves headings', () => {
    expect(roundTrip('## Seção')).toBe('## Seção')
  })
  it('preserves bullet lists', () => {
    expect(roundTrip('- um\n- dois')).toBe('- um\n- dois')
  })
  it('preserves numbered lists', () => {
    expect(roundTrip('1. um\n2. dois')).toBe('1. um\n2. dois')
  })
  it('preserves the imported-card description shape', () => {
    const md = '**Problema:** updatePage manda o write direto.\n\n**Esforço:** L\n\n**Arquivos:** `supabaseClient.ts`'
    expect(roundTrip(md)).toBe(md)
  })
})

describe('htmlToMarkdown serialization tolerance', () => {
  it('ignores styling spans and uses STRONG/B and EM/I alike', () => {
    const el = intoDom('<div><b>x</b> <span style="color:red"><i>y</i></span></div>')
    expect(htmlToMarkdown(el)).toBe('**x** *y*')
  })
  it('turns browser <div> line splits into separate paragraphs', () => {
    const el = intoDom('<div>linha um</div><div>linha dois</div>')
    expect(htmlToMarkdown(el)).toBe('linha um\n\nlinha dois')
  })
  it('removes formatting when the wrapper is gone (toggle off leaves no **)', () => {
    // After execCommand unbolds, the <strong> is removed by the browser.
    const el = intoDom('<div>texto sem marca</div>')
    const out = htmlToMarkdown(el)
    expect(out).toBe('texto sem marca')
    expect(out).not.toContain('**')
  })
})

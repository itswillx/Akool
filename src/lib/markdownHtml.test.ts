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
  it('turns safe links into external anchors', () => {
    expect(markdownToHtml('[x](https://a.com)')).toContain('<a href="https://a.com" target="_blank" rel="noopener noreferrer">x</a>')
    expect(markdownToHtml('[m](mailto:a@b.com)')).toContain('href="mailto:a@b.com"')
  })
  it('keeps relative paths as inert anchors (no href, still in the markdown)', () => {
    const a = intoDom(markdownToHtml('[f](src/x.ts)')).querySelector('a')!
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.getAttribute('data-md-href')).toBe('src/x.ts')
    expect(a.textContent).toBe('f')
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

// SEC-010: the editor feeds this HTML to innerHTML, outside React's own
// javascript: filter, so no payload may come out as a navigable href.
describe('markdownToHtml link allowlist (SEC-010)', () => {
  const payloads = [
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](\u0001javascript:alert(1))', // the URL parser strips leading controls
    '[x](java\tscript:alert(1))', // …and tabs/newlines anywhere
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](vbscript:msgbox(1))',
    '[x](&#106;avascript:alert(1))', // HTML entity: must not be decoded into a scheme
    '[x](javascript&#58;alert(1))',
    '[x](https://a.com"onmouseover="alert(1))', // quote can't break out of href
  ]

  it.each(payloads)('%s yields no unsafe href and no handler attribute', md => {
    const root = intoDom(markdownToHtml(md))
    for (const a of Array.from(root.querySelectorAll('a[href]'))) {
      expect(a.getAttribute('href')).toMatch(/^(https?:\/\/|mailto:)/i)
    }
    for (const el of Array.from(root.querySelectorAll('*'))) {
      expect(el.getAttributeNames().filter(n => n.startsWith('on'))).toEqual([])
    }
  })

  it('keeps file:line references as inert anchors, not as a scheme', () => {
    const a = intoDom(markdownToHtml('[p](ProjectsPanel.tsx:972)')).querySelector('a')!
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.getAttribute('data-md-href')).toBe('ProjectsPanel.tsx:972')
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
    expect(roundTrip('[p](ProjectsPanel.tsx:972)')).toBe('[p](ProjectsPanel.tsx:972)')
  })
  it('preserves mailto links', () => {
    expect(roundTrip('[fale](mailto:a@b.com)')).toBe('[fale](mailto:a@b.com)')
  })
  it('keeps only the label of links with a blocked scheme', () => {
    expect(roundTrip('ver [x](javascript:void) aqui')).toBe('ver x aqui')
    expect(roundTrip('ver [x](data:text/html,oi) aqui')).toBe('ver x aqui')
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

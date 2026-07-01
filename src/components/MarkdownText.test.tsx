import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownText } from './MarkdownText'

const html = (text: string) => renderToStaticMarkup(<MarkdownText text={text} />)

describe('MarkdownText', () => {
  it('renders bold markup as <strong>, not literal asterisks', () => {
    const out = html('**Problema:** algo')
    expect(out).toContain('<strong')
    expect(out).toContain('Problema:')
    expect(out).not.toContain('**')
  })

  it('renders inline code as <code>', () => {
    const out = html('roda `npm test`')
    expect(out).toContain('<code')
    expect(out).toContain('npm test')
    expect(out).not.toContain('`')
  })

  it('renders italics as <em> for *text*', () => {
    expect(html('um *destaque* aqui')).toContain('<em')
  })

  it('leaves snake_case identifiers literal (no spurious italics)', () => {
    const out = html('o campo assignee_user_id e parent_card_id')
    expect(out).not.toContain('<em')
    expect(out).toContain('assignee_user_id')
    expect(out).toContain('parent_card_id')
  })

  it('turns http links into safe anchors', () => {
    const out = html('veja [docs](https://example.com)')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('does NOT make relative file paths clickable, keeping only the label', () => {
    const out = html('**Arquivos:** [PagesContext.tsx](src/contexts/PagesContext.tsx)')
    expect(out).not.toContain('<a ')
    expect(out).toContain('PagesContext.tsx')
    expect(out).not.toContain('src/contexts/PagesContext.tsx')
  })

  it('renders bullet lists', () => {
    const out = html('- um\n- dois')
    expect(out).toContain('<ul')
    expect((out.match(/<li/g) ?? []).length).toBe(2)
  })

  it('renders headings', () => {
    expect(html('## Seção')).toContain('Seção')
  })

  it('renders the imported-card description shape with bold + code', () => {
    const desc = '**Problema:** updatePage manda o write direto.\n\n**Esforço:** M\n\n**Arquivos:** `PagesContext.tsx`'
    const out = html(desc)
    expect((out.match(/<strong/g) ?? []).length).toBe(3)
    expect(out).toContain('<code')
    expect(out).not.toContain('**')
  })

  it('returns nothing for empty text', () => {
    expect(html('   ')).toBe('')
  })
})

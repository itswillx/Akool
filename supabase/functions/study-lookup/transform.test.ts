import { describe, expect, it } from 'vitest'
import { compactText, decodeHtmlEntities, wikipediaExtractToMarkdown } from './transform.ts'
import { cacheKey } from './cache.ts'

// SEC-007: a study-lookup foi versionada a partir do código publicado. Estes
// testes cobrem as partes puras (sem Deno) que decidem o que chega ao navegador.

describe('study-lookup: transformações', () => {
  it('decodifica entidades nomeadas e numéricas, e deixa as inválidas', () => {
    expect(decodeHtmlEntities('a&amp;b &lt;x&gt; &#233; &#xE9; &quot;q&quot; &bogus;')).toBe('a&b <x> é é "q" &bogus;')
  })

  it('tira todo HTML e mantém só parágrafos e negrito em Markdown', () => {
    const md = wikipediaExtractToMarkdown('<p><b>Fotossíntese</b> é o processo<script>x()</script>.</p><p>Segundo&nbsp;parágrafo</p>')
    expect(md).toBe('**Fotossíntese** é o processo.\n\nSegundo parágrafo')
    expect(md).not.toMatch(/<|>/)
  })

  it('corta no limite em fronteira de palavra e fecha o negrito', () => {
    const md = wikipediaExtractToMarkdown(`<b>${'palavra '.repeat(40)}</b>`, 50)
    expect(md.endsWith('…')).toBe(true)
    expect(md.length).toBeLessThanOrEqual(51)
    expect((md.match(/\*\*/g) ?? []).length % 2).toBe(0)
  })

  it('compactText remove tags e espaços extras; não-texto vira vazio', () => {
    expect(compactText('  <i>Título</i>\n  do   livro ')).toBe('Título do livro')
    expect(compactText(42)).toBe('')
  })

  it('cacheKey normaliza caixa e espaços, preserva acento e sufixa um hash estável', () => {
    const a = cacheKey('  Sessão   Plenária ')
    expect(a).toBe(cacheKey('sessão plenária'))
    expect(a.startsWith('sessão plenária#')).toBe(true)
    expect(cacheKey('sessao plenaria')).not.toBe(a)
    expect(a.split('#')[1]).toMatch(/^[0-9a-f]{16}$/)
  })
})

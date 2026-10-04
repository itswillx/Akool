import { describe, expect, it } from 'vitest'
import { helpContent } from './helpContent'

// A Ajuda nos dois idiomas tem a mesma estrutura: mesmas categorias, artigos e
// passos, na mesma ordem (o texto muda, os ids não).
describe('helpContent', () => {
  const shape = (lang: 'pt-BR' | 'en') =>
    helpContent[lang].categories.map(c => ({ id: c.id, icon: c.icon, articles: c.articles.map(a => [a.id, a.steps.length]) }))

  it('pt-BR e inglês com as mesmas categorias, artigos e número de passos', () => {
    expect(shape('en')).toEqual(shape('pt-BR'))
  })

  it('todo artigo tem título, resumo e pelo menos um passo', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      for (const article of helpContent[lang].categories.flatMap(c => c.articles)) {
        expect(article.title.trim()).not.toBe('')
        expect(article.summary.trim()).not.toBe('')
        expect(article.steps.length).toBeGreaterThan(0)
      }
    }
  })
})

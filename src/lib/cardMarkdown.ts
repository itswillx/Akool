// API-027: o Markdown do card mora em supabase/functions/_domain (a API exporta o
// mesmo). O app passa o seu `t` (as chaves do CardMarkdownKey existem no app).
export {
  formatCardAsMarkdown,
  type CardMarkdownContext,
  type CardMarkdownKey,
  type CardMarkdownSource,
} from '../../supabase/functions/_domain/cardMarkdown'

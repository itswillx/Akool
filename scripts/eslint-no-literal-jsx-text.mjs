// UX-011: texto de interface escrito direto no JSX não passa pela tradução e
// aparece em português para quem usa o app em inglês (e vice-versa). Acusa:
//   - texto com letras entre tags: <span>Salvar</span>;
//   - string literal em title, placeholder, aria-label e alt, direto
//     (title="Fechar") ou dentro de uma expressão (title={x ? 'Abrir' : 'Fechar'}).
// Passam: a marca (Akool), texto sem palavras (números, símbolos, emoji) e
// exemplos de formato (e-mail, URL). O texto vai para src/i18n e entra com t().

const LABEL_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'alt'])
const ALLOWED = [/^Akool$/, /@/, /^https?:\/\//]

function isUiText(value) {
  const text = value.trim()
  if (!/\p{L}{2,}/u.test(text)) return false
  return !ALLOWED.some(re => re.test(text))
}

function stringsIn(expression) {
  if (!expression) return []
  if (expression.type === 'Literal' && typeof expression.value === 'string') return [expression]
  if (expression.type === 'TemplateLiteral') return expression.quasis.length === 1 ? [expression] : []
  if (expression.type === 'ConditionalExpression') return [...stringsIn(expression.consequent), ...stringsIn(expression.alternate)]
  if (expression.type === 'LogicalExpression') return stringsIn(expression.right)
  return []
}

function literalText(node) {
  return node.type === 'TemplateLiteral' ? node.quasis[0].value.cooked ?? '' : String(node.value)
}

export const noLiteralJsxText = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Texto de interface fixo no JSX, fora da tradução (src/i18n).' },
    schema: [],
    messages: { literal: 'Texto fixo "{{text}}": mova para as traduções (src/i18n) e use t().' },
  },
  create(context) {
    const report = (node, text) => context.report({ node, messageId: 'literal', data: { text: text.trim().slice(0, 40) } })
    return {
      JSXText(node) {
        if (isUiText(node.value)) report(node, node.value)
      },
      JSXExpressionContainer(node) {
        if (node.parent.type !== 'JSXElement' && node.parent.type !== 'JSXFragment') return
        for (const literal of stringsIn(node.expression)) {
          if (isUiText(literalText(literal))) report(literal, literalText(literal))
        }
      },
      JSXAttribute(node) {
        if (!LABEL_ATTRIBUTES.has(node.name.name) || !node.value) return
        const literals = node.value.type === 'Literal' ? [node.value]
          : node.value.type === 'JSXExpressionContainer' ? stringsIn(node.value.expression) : []
        for (const literal of literals) {
          if (isUiText(literalText(literal))) report(literal, literalText(literal))
        }
      },
    }
  },
}

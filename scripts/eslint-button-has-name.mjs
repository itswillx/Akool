// UX-008: botão precisa de nome acessível. Um <button> só com ícone é anunciado
// só como "botão" pelo leitor de tela. Vale texto dentro (inclusive em <span> e
// em expressões como {t('...')}), aria-label, aria-labelledby ou title.
// Botões com aria-hidden (atalhos só de mouse, fora do Tab) não contam, e
// spread de props ({...props}) é aceito, porque o nome pode vir dali.

function expressionHasText(expression) {
  if (!expression || expression.type === 'JSXEmptyExpression') return false
  if (expression.type === 'JSXElement' || expression.type === 'JSXFragment') return childrenHaveText(expression.children)
  if (expression.type === 'ConditionalExpression') return expressionHasText(expression.consequent) || expressionHasText(expression.alternate)
  if (expression.type === 'LogicalExpression') return expressionHasText(expression.right)
  return true
}

function childrenHaveText(children) {
  return children.some(child =>
    (child.type === 'JSXText' && child.value.trim() !== '') ||
    (child.type === 'JSXExpressionContainer' && expressionHasText(child.expression)) ||
    ((child.type === 'JSXElement' || child.type === 'JSXFragment') && childrenHaveText(child.children)))
}

const NAME_ATTRIBUTES = new Set(['aria-label', 'aria-labelledby', 'title', 'aria-hidden'])

export const buttonHasName = {
  meta: {
    type: 'problem',
    docs: { description: 'Botão sem nome acessível (só ícone, sem texto, aria-label ou title).' },
    schema: [],
    messages: { noName: 'Botão sem nome acessível: dê um aria-label (i18n) ao botão só com ícone.' },
  },
  create(context) {
    return {
      JSXElement(node) {
        const name = node.openingElement.name
        if (name.type !== 'JSXIdentifier' || name.name !== 'button') return
        const attributes = node.openingElement.attributes
        if (attributes.some(a => a.type === 'JSXSpreadAttribute')) return
        if (attributes.some(a => a.type === 'JSXAttribute' && NAME_ATTRIBUTES.has(a.name.name))) return
        if (childrenHaveText(node.children)) return
        context.report({ node: node.openingElement, messageId: 'noName' })
      },
    }
  },
}

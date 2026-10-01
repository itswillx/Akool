// UX-015: cor é token (var(--color-*)), não hex solto no TSX. Um hex novo numa
// tela fica fora do tema escuro e da decisão de accent. Acusa string literal
// que é só uma cor hex (#rgb, #rrggbb, #rrggbbaa) ou que contém um hex num
// template de estilo. Paletas de dados (cor de quadro, categoria, conta, meta,
// avatar; cores dos passos do tour) ficam em arquivos listados no
// eslint.config.js, fora da regra; o PDF (jsPDF/canvas) também, porque não lê CSS.
const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/

export const noHexColor = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Cor hex fixa no código; use um token (var(--color-*)) de src/index.css.' },
    schema: [],
    messages: { hex: 'Cor hex "{{hex}}": use um token (var(--color-*)) ou registre a paleta no eslint.config.js.' },
  },
  create(context) {
    const report = (node, text) => {
      const m = HEX.exec(text)
      if (m) context.report({ node, messageId: 'hex', data: { hex: m[0] } })
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') report(node, node.value)
      },
      TemplateElement(node) {
        report(node, node.value.cooked ?? '')
      },
    }
  },
}

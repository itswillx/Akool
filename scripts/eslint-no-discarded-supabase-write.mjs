// REL-004: regra de revisão. O supabase-js nunca lança em falha de escrita:
// todo builder resolve para { data, error }. Um
// `await supabase.from('t').update(...).eq(...)` como instrução solta perde a
// falha em silêncio, e a tela mostra sucesso. A escrita precisa ler o
// resultado: `const { error } = await …`, ou passar por runGuarded /
// runOptimistic (src/lib/optimistic.ts).
//
// Acusa só o caso inequívoco: instrução cujo valor é descartado, com
// `.from(...)` e um insert/update/upsert/delete na mesma cadeia. Terminar em
// .then()/.catch()/.finally() é tratamento explícito (ex.: o delete de
// presença no pagehide, que não dá para esperar) e não é acusado.

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])
const HANDLERS = new Set(['then', 'catch', 'finally'])

/** O método de escrita da cadeia `x.from(...)…write(...)…`, ou null. */
function writeMethodOf(node) {
  const outer = node?.type === 'CallExpression' && node.callee.type === 'MemberExpression' ? node.callee.property : null
  if (outer?.type === 'Identifier' && HANDLERS.has(outer.name)) return null
  let write = null
  let hasFrom = false
  let current = node
  while (current?.type === 'CallExpression' && current.callee.type === 'MemberExpression') {
    const property = current.callee.property
    const name = property.type === 'Identifier' ? property.name : null
    if (name === 'from') hasFrom = true
    else if (name && WRITE_METHODS.has(name)) write = name
    current = current.callee.object
  }
  return hasFrom ? write : null
}

export const noDiscardedSupabaseWrite = {
  meta: {
    type: 'problem',
    docs: { description: 'Escrita do supabase com o resultado descartado (o erro some em silêncio).' },
    schema: [],
    messages: {
      discarded: 'O resultado deste {{method}} é descartado, e a falha some em silêncio. Leia o `error` ou use runGuarded/runOptimistic (src/lib/optimistic.ts).',
    },
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        const expression = node.expression.type === 'AwaitExpression' ? node.expression.argument : node.expression
        const method = writeMethodOf(expression)
        if (method) context.report({ node, messageId: 'discarded', data: { method } })
      },
    }
  },
}

export default {
  meta: { name: 'akool' },
  rules: { 'no-discarded-supabase-write': noDiscardedSupabaseWrite },
}

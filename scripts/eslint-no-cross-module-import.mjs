// ARCH-006: fronteira entre módulos. Um módulo (src/modules/<nome>) não importa
// de outro módulo, nem por import estático nem por import(): o que é comum vai
// para src/shared (UI e hooks genéricos) ou src/lib, e a comunicação entre
// módulos é por eventos (src/lib/appEvents.ts). A camada src/shared só importa
// src/lib e src/i18n: nunca módulos, telas, contextos ou páginas. As entradas
// lazy dos módulos (DocumentsPanel, MainContent…) ficam fora da regra porque
// vivem em src/components. Caminhos com `@/` são resolvidos como src/.
import { isAbsolute, posix, relative } from 'node:path'

const MODULE_RE = /^src\/modules\/([^/]+)\//
const SHARED_RE = /^src\/shared\//
const APP_LAYERS_RE = /^src\/(modules|components|contexts|pages)\//

/** Caminho do alvo relativo à raiz do repo, ou null para pacote (react, lucide…). */
export function importTarget(spec, fileRel) {
  if (spec.startsWith('@/')) return `src/${spec.slice(2)}`
  if (spec.startsWith('./') || spec.startsWith('../')) return posix.normalize(posix.join(posix.dirname(fileRel), spec))
  return null
}

export const noCrossModuleImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Módulos não se importam entre si, e src/shared só importa src/lib e src/i18n.' },
    schema: [],
    messages: {
      module: 'Import de outro módulo ({{target}}): módulos não se importam. O que é comum vai para src/shared ou src/lib; entre módulos, use src/lib/appEvents.ts.',
      shared: 'src/shared só importa src/lib e src/i18n (importou {{target}}).',
    },
  },
  create(context) {
    const file = context.filename ?? context.getFilename()
    const rel = (isAbsolute(file) ? relative(context.cwd ?? process.cwd(), file) : file).split('\\').join('/')
    const own = MODULE_RE.exec(rel)?.[1] ?? null
    const inShared = SHARED_RE.test(rel)
    if (!own && !inShared) return {}

    const check = (node, spec) => {
      if (typeof spec !== 'string') return
      const target = importTarget(spec, rel)
      if (!target) return
      const probe = `${target}/`
      if (own) {
        const other = MODULE_RE.exec(probe)?.[1]
        if (other && other !== own) context.report({ node, messageId: 'module', data: { target } })
      } else if (APP_LAYERS_RE.test(probe)) {
        context.report({ node, messageId: 'shared', data: { target } })
      }
    }

    return {
      ImportDeclaration(node) { check(node.source, node.source.value) },
      ExportAllDeclaration(node) { if (node.source) check(node.source, node.source.value) },
      ExportNamedDeclaration(node) { if (node.source) check(node.source, node.source.value) },
      ImportExpression(node) { if (node.source.type === 'Literal') check(node.source, node.source.value) },
    }
  },
}

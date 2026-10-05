import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// API-005: fronteira de imports dos módulos puros (docs/api-arquitetura.md §3).
// Fora de runtime/, `_api` e `_domain` só importam caminhos relativos `.ts`
// dentro de supabase/functions (inclusive `import type` e `export … from`),
// nunca src/, `@/`, pacote, npm: ou jsr:, nem a cola Deno (`index.ts`) e o
// runtime/. O bundler do staging:reset e o deploy seguem só caminhos
// relativos, e o app importa estes módulos direto. Testes podem importar
// vitest e node:*; este arquivo também usa o parser do typescript.

const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PURE_DIRS = ['_api', '_domain']
const SELF = 'importBoundary.test.ts'

export type ImportKind = 'import' | 'import-type' | 'export' | 'dynamic' | 'side-effect' | 'require'
export interface ImportRef { specifier: string; kind: ImportKind }

/** Todos os imports do arquivo, pelo parser do TypeScript (comentários não enganam). */
export function importsOf(source: string, fileName = 'x.ts'): ImportRef[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const refs: ImportRef[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const kind: ImportKind = !node.importClause ? 'side-effect' : node.importClause.isTypeOnly ? 'import-type' : 'import'
      refs.push({ specifier: node.moduleSpecifier.text, kind })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ specifier: node.moduleSpecifier.text, kind: 'export' })
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      refs.push({ specifier: node.moduleReference.expression.text, kind: 'require' })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      refs.push({ specifier: arg && ts.isStringLiteral(arg) ? arg.text : '<dinâmico>', kind: 'dynamic' })
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      refs.push({ specifier: node.argument.literal.text, kind: 'import-type' })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return refs
}

export interface BoundaryContext {
  /** Arquivo de teste: pode importar vitest e node:*. */
  isTest: boolean
  /** Este arquivo: também pode importar o typescript. */
  isSelf?: boolean
  exists: (path: string) => boolean
}

/** Problemas de fronteira de um arquivo (caminho absoluto) com estes imports. */
export function boundaryProblems(file: string, refs: readonly ImportRef[], ctx: BoundaryContext): string[] {
  const problems: string[] = []
  for (const { specifier, kind } of refs) {
    if (ctx.isTest && (specifier === 'vitest' || specifier.startsWith('node:'))) continue
    if (ctx.isSelf && specifier === 'typescript') continue
    if (kind === 'side-effect') {
      problems.push(`import de efeito colateral: ${specifier}`)
      continue
    }
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      problems.push(`import não relativo: ${specifier}`)
      continue
    }
    if (!specifier.endsWith('.ts')) {
      problems.push(`import sem a extensão .ts: ${specifier}`)
      continue
    }
    const target = resolve(dirname(file), specifier)
    if (!target.startsWith(FUNCTIONS + sep)) {
      problems.push(`import fora de supabase/functions: ${specifier}`)
      continue
    }
    if (relative(FUNCTIONS, target).split(sep).includes('runtime')) problems.push(`import do runtime/: ${specifier}`)
    else if (basename(target) === 'index.ts') problems.push(`import da cola Deno (index.ts): ${specifier}`)
    else if (!ctx.exists(target)) problems.push(`import de arquivo inexistente: ${specifier}`)
  }
  return problems
}

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'runtime' ? [] : tsFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('fronteira de imports de _api e _domain', () => {
  it('nenhum módulo puro (nem o que ele importa de fora) sai da fronteira', () => {
    const queue = PURE_DIRS.flatMap(dir => tsFiles(join(FUNCTIONS, dir)))
    expect(queue.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    const offenders: string[] = []
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (seen.has(file)) continue
      seen.add(file)
      const refs = importsOf(readFileSync(file, 'utf8'), file)
      const ctx = { isTest: file.includes('.test.'), isSelf: basename(file) === SELF, exists: existsSync }
      for (const problem of boundaryProblems(file, refs, ctx)) offenders.push(`${relative(FUNCTIONS, file)}: ${problem}`)
      // O que um módulo puro importa de fora (ex.: _shared) segue a mesma regra.
      for (const { specifier } of refs) {
        if (!specifier.startsWith('.')) continue
        const target = resolve(dirname(file), specifier)
        if (target.startsWith(FUNCTIONS + sep) && existsSync(target) && !seen.has(target)) queue.push(target)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('importsOf', () => {
  it('acha todas as formas de import, e ignora comentário', () => {
    const source = [
      "import a from './a.ts'",
      "import type { B } from './b.ts'",
      "export { c } from './c.ts'",
      "export * from './d.ts'",
      "const e = await import('./e.ts')",
      "import './f.ts'",
      "type G = typeof import('./g.ts')",
      "import h = require('./h.ts')",
      "// import nada from '../../../src/x.ts'",
    ].join('\n')
    expect(importsOf(source)).toEqual([
      { specifier: './a.ts', kind: 'import' },
      { specifier: './b.ts', kind: 'import-type' },
      { specifier: './c.ts', kind: 'export' },
      { specifier: './d.ts', kind: 'export' },
      { specifier: './e.ts', kind: 'dynamic' },
      { specifier: './f.ts', kind: 'side-effect' },
      { specifier: './g.ts', kind: 'import-type' },
      { specifier: './h.ts', kind: 'require' },
    ])
  })
})

describe('boundaryProblems', () => {
  const file = join(FUNCTIONS, '_api', 'algo.ts')
  const exists = (path: string) => !path.endsWith('ausente.ts')
  const problemsOf = (specifier: string, kind: ImportKind = 'import', isTest = false) =>
    boundaryProblems(file, [{ specifier, kind }], { isTest, exists })

  it.each([
    ['../../../src/lib/supabase.ts', 'import fora de supabase/functions'],
    ['@/lib/supabase', 'import não relativo'],
    ['../../../src/types/db.ts', 'import fora de supabase/functions'],
    ['zod', 'import não relativo'],
    ['npm:postgres@3', 'import não relativo'],
    ['jsr:@supabase/supabase-js@2', 'import não relativo'],
    ['./catalog', 'import sem a extensão .ts'],
    ['./runtime/db.ts', 'import do runtime/'],
    ['../cards-api/index.ts', 'import da cola Deno (index.ts)'],
    ['./ausente.ts', 'import de arquivo inexistente'],
  ])('%s é recusado', (specifier, problem) => {
    expect(problemsOf(specifier).join()).toContain(problem)
  })

  it('import de efeito colateral é recusado', () => {
    expect(problemsOf('./catalog.ts', 'side-effect')).toEqual(['import de efeito colateral: ./catalog.ts'])
  })

  it('import relativo .ts dentro de supabase/functions passa, inclusive _shared', () => {
    expect(problemsOf('./catalog.ts')).toEqual([])
    expect(problemsOf('../_shared/scrub.ts', 'import-type')).toEqual([])
  })

  it('só testes importam vitest e node:*', () => {
    expect(problemsOf('vitest', 'import', true)).toEqual([])
    expect(problemsOf('node:fs', 'import', true)).toEqual([])
    expect(problemsOf('vitest')).toEqual(['import não relativo: vitest'])
    expect(problemsOf('typescript', 'import', true)).toEqual(['import não relativo: typescript'])
  })
})

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
// API-020: de `_api`, `_domain` só importa `_api/schema.ts`, que é folha (não
// importa nada). Duas conferências: o import direto de um arquivo de `_domain`
// (fora dos testes) que cai em `_api` tem de ser o `schema.ts`; e o fecho do
// que `_domain` importa, seguido por `_shared` e pelas pastas das functions,
// não alcança outro arquivo de `_api`. Assim `_domain` não puxa o registry, as
// actions nem os erros, nem por um arquivo do meio, e não fecha ciclo com quem
// o importa.

const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PURE_DIRS = ['_api', '_domain']
const SELF = 'importBoundary.test.ts'
/** O único arquivo de `_api` que `_domain` pode importar. */
const DOMAIN_ALLOWED_API = join(FUNCTIONS, '_api', 'schema.ts')

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
    else if (!ctx.isTest && topDir(file) === '_domain' && topDir(target) === '_api' && target !== DOMAIN_ALLOWED_API) {
      problems.push(`_domain só importa _api/schema.ts: ${specifier}`)
    }
  }
  return problems
}

/** A pasta de supabase/functions onde o arquivo está (`_api`, `_domain`, `_shared`…). */
function topDir(path: string): string {
  return relative(FUNCTIONS, path).split(sep)[0]
}

export interface ClosureContext {
  exists: (path: string) => boolean
  read: (path: string) => string
}

/**
 * API-020: o fecho dos imports relativos a partir de `roots` (os arquivos de
 * `_domain` fora dos testes), seguindo qualquer pasta de supabase/functions
 * (`_shared`, `cards-api`…) e parando no `_api/schema.ts`. Devolve, para cada
 * arquivo de `_api` alcançado que não é o `schema.ts`, a cadeia que chega
 * nele. Tem o próprio `visited`: o crawl da fronteira também parte de `_api`, e
 * um arquivo que ele visse antes não seria marcado como alcançado de `_domain`.
 */
export function domainClosureProblems(roots: readonly string[], ctx: ClosureContext): string[] {
  const via = new Map<string, string | null>(roots.map(root => [root, null]))
  const queue = [...roots]
  const problems: string[] = []
  const chain = (file: string): string => {
    const parts: string[] = []
    for (let at: string | null | undefined = file; at; at = via.get(at)) parts.unshift(relative(FUNCTIONS, at))
    return parts.join(' → ')
  }
  while (queue.length > 0) {
    const file = queue.shift() as string
    if (topDir(file) === '_api' && file !== DOMAIN_ALLOWED_API) {
      problems.push(`_domain alcança ${relative(FUNCTIONS, file)}: ${chain(file)}`)
      continue
    }
    if (file === DOMAIN_ALLOWED_API) continue
    for (const { specifier } of importsOf(ctx.read(file), file)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      const target = resolve(dirname(file), specifier)
      if (!target.startsWith(FUNCTIONS + sep) || !ctx.exists(target) || via.has(target)) continue
      via.set(target, file)
      queue.push(target)
    }
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

  it('_api/schema.ts é folha: _domain o importa sem ciclo', () => {
    expect(importsOf(readFileSync(DOMAIN_ALLOWED_API, 'utf8'), DOMAIN_ALLOWED_API)).toEqual([])
  })

  it('o fecho de _domain (por _shared ou outra pasta) não alcança _api além do schema.ts', () => {
    const roots = tsFiles(join(FUNCTIONS, '_domain')).filter(file => !file.includes('.test.'))
    expect(roots.length).toBeGreaterThan(0)
    const read = (path: string) => readFileSync(path, 'utf8')
    expect(domainClosureProblems(roots, { exists: existsSync, read })).toEqual([])
  })
})

describe('domainClosureProblems', () => {
  const at = (...parts: string[]) => join(FUNCTIONS, ...parts)
  /** Arquivos virtuais por cima dos reais: `null` some com o arquivo. */
  const virtual = (files: Record<string, string | null>): ClosureContext => ({
    exists: path => (path in files ? files[path] !== null : existsSync(path)),
    read: path => files[path] ?? readFileSync(path, 'utf8'),
  })
  const domain = at('_domain', 'blocknote', 'ponteado.ts')

  it('_domain → _shared → _api/registry.ts é recusado (o import direto de cada um passa)', () => {
    const ponte = at('_shared', 'ponte.ts')
    const ctx = virtual({
      [domain]: "import { x } from '../../_shared/ponte.ts'",
      [ponte]: "export { registry as x } from '../_api/registry.ts'",
    })
    // A regra do import direto não vê nada: cada arquivo, sozinho, está dentro da fronteira.
    const direct = { isTest: false, exists: ctx.exists }
    expect(boundaryProblems(domain, importsOf(ctx.read(domain)), direct)).toEqual([])
    expect(boundaryProblems(ponte, importsOf(ctx.read(ponte)), direct)).toEqual([])
    expect(domainClosureProblems([domain], ctx)).toEqual([
      '_domain alcança _api/registry.ts: _domain/blocknote/ponteado.ts → _shared/ponte.ts → _api/registry.ts',
    ])
  })

  it('import type e export … from contam como caminho', () => {
    const ponte = at('_shared', 'ponte.ts')
    const ctx = virtual({
      [domain]: "import type { X } from '../../_shared/ponte.ts'",
      [ponte]: "export type { ApiError as X } from '../_api/errors.ts'",
    })
    expect(domainClosureProblems([domain], ctx)).toEqual([
      '_domain alcança _api/errors.ts: _domain/blocknote/ponteado.ts → _shared/ponte.ts → _api/errors.ts',
    ])
  })

  const scopeMap = at('cards-api', 'scopeMap.ts')
  it.runIf(existsSync(scopeMap))('cadeia real: _domain → cards-api/scopeMap.ts → _api/catalog.ts é recusada', () => {
    const ctx = virtual({ [domain]: "import { scopeFor } from '../../cards-api/scopeMap.ts'" })
    expect(domainClosureProblems([domain], ctx)).toEqual([
      '_domain alcança _api/catalog.ts: _domain/blocknote/ponteado.ts → cards-api/scopeMap.ts → _api/catalog.ts',
    ])
  })

  it('para no _api/schema.ts (a folha tem teste próprio) e não se perde em ciclo', () => {
    const a = at('_shared', 'a.ts')
    const b = at('_shared', 'b.ts')
    const ctx = virtual({
      [domain]: "import { s } from '../../_api/schema.ts'\nimport { a } from '../../_shared/a.ts'",
      [DOMAIN_ALLOWED_API]: "import { e } from './errors.ts'",
      [a]: "import { b } from './b.ts'\nexport const a = 1",
      [b]: "import { a } from './a.ts'\nexport const b = 2",
    })
    expect(domainClosureProblems([domain], ctx)).toEqual([])
  })

  it('import inexistente, fora de supabase/functions ou não relativo não entra no fecho', () => {
    const ctx = virtual({
      [domain]: "import z from 'zod'\nimport { s } from '../../../../src/lib/x.ts'\nimport { g } from '../../_shared/sumiu.ts'",
      [at('_shared', 'sumiu.ts')]: null,
    })
    expect(domainClosureProblems([domain], ctx)).toEqual([])
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

  it('_domain só importa _api/schema.ts (testes de _domain ficam de fora)', () => {
    const domain = join(FUNCTIONS, '_domain', 'blocknote', 'schema.ts')
    const of = (specifier: string, isTest = false) => boundaryProblems(domain, [{ specifier, kind: 'import' }], { isTest, exists: () => true })
    expect(of('../../_api/schema.ts')).toEqual([])
    expect(of('../../_api/errors.ts')).toEqual(['_domain só importa _api/schema.ts: ../../_api/errors.ts'])
    expect(of('../../_api/registry.ts')).toEqual(['_domain só importa _api/schema.ts: ../../_api/registry.ts'])
    expect(of('../../_api/actions/projetos/cards.ts')).toEqual(['_domain só importa _api/schema.ts: ../../_api/actions/projetos/cards.ts'])
    expect(of('../../_api/errors.ts', true)).toEqual([])
    // Fora de _domain a regra não vale; _domain pode importar o próprio _domain e o _shared.
    expect(problemsOf('./errors.ts')).toEqual([])
    expect(of('./spec.ts')).toEqual([])
    expect(of('../../_shared/scrub.ts')).toEqual([])
  })

  it('só testes importam vitest e node:*', () => {
    expect(problemsOf('vitest', 'import', true)).toEqual([])
    expect(problemsOf('node:fs', 'import', true)).toEqual([])
    expect(problemsOf('vitest')).toEqual(['import não relativo: vitest'])
    expect(problemsOf('typescript', 'import', true)).toEqual(['import não relativo: typescript'])
  })
})

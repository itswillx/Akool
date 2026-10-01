import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// UX-002: guarda contra clicáveis sem teclado. Faz o papel das regras
// click-events-have-key-events / no-static-element-interactions do
// eslint-plugin-jsx-a11y, que não suporta o ESLint 10 do projeto.
//
// Um elemento HTML não interativo (div, span, li, tr, h1…) com onClick precisa
// de `role` ou de um handler de teclado. Exceções:
//   - onClick que só faz stopPropagation (não é uma ação);
//   - data-kbd="<onde>": a mesma ação já tem caminho de teclado em outro
//     controle, dito no valor (ex.: <tr data-kbd="inner"> com um <button> no
//     título; a barra do Gantt com data-kbd="row-label").
// Fundo de modal usa role="presentation" (a saída pelo teclado é o Esc).

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'summary', 'option', 'details'])
const STOP_ONLY = /^onClick=\{\s*\(?\s*\w+\s*\)?\s*=>\s*\{?\s*\w+\.stopPropagation\(\)\s*;?\s*\}?\s*\}$/

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsxFiles(p)
    return p.endsWith('.tsx') && !p.includes('.test.') ? [p] : []
  })
}

export function findClickablesWithoutKeyboard(file: string, text: string): string[] {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(src)
      if (/^[a-z]/.test(tag) && !INTERACTIVE.has(tag)) {
        const attrs = node.attributes.properties
        const named = attrs.filter(ts.isJsxAttribute)
        const onClick = named.find(a => a.name.getText(src) === 'onClick')
        // Só contam os spreads que trazem papel e teclado: activateProps()
        // (inclusive condicional, `cond ? activateProps(…) : {}`) e os
        // dialogProps do useDialog (Esc/Tab). Outros ({...hoverProps}) não.
        const hasActivate = attrs.some(a => ts.isJsxSpreadAttribute(a)
          && /\bactivateProps\(|^dialogProps$/.test(a.expression.getText(src)))
        const ok = !onClick
          || hasActivate
          || STOP_ONLY.test(onClick.getText(src))
          || named.some(a => {
            const n = a.name.getText(src)
            return n === 'role' || n === 'data-kbd' || n.startsWith('onKey')
          })
        if (!ok) {
          const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1
          found.push(`${relative(ROOT, file)}:${line} <${tag}>`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return found
}

describe('clicáveis acessíveis por teclado (UX-002)', () => {
  it('detecta o padrão proibido e aceita as exceções', () => {
    const sample = `
      const a = <div onClick={go}>x</div>
      const b = <div role="button" tabIndex={0} onClick={go} onKeyDown={k}>x</div>
      const c = <div {...activateProps(go)} onClick={go}>x</div>
      const d = <span onClick={e => e.stopPropagation()}>x</span>
      const e = <tr data-kbd="inner" onClick={go}><td><button>t</button></td></tr>
      const f = <div role="presentation" onClick={close} />
      const g = <button onClick={go}>ok</button>
      const h = <Card onClick={go} />
      const i = <div {...hoverProps} onClick={go}>x</div>
      const j = <div {...(ok ? activateProps(go) : {})} onClick={go}>x</div>
      const k = <div {...dialogProps} onClick={close}>x</div>
    `
    expect(findClickablesWithoutKeyboard('sample.tsx', sample)).toEqual(['sample.tsx:2 <div>', 'sample.tsx:10 <div>'])
  })

  it('nenhum clicável sem teclado em src/', () => {
    const offenders = tsxFiles(SRC).flatMap(f => findClickablesWithoutKeyboard(f, readFileSync(f, 'utf8')))
    expect(offenders, `Use <button>, activateProps() de src/lib/a11y.ts ou role="presentation" (fundo de modal):\n${offenders.join('\n')}`).toEqual([])
  })
})

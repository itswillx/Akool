import axe from 'axe-core'
import { expect } from 'vitest'

// UX-008: varredura de acessibilidade nos testes de componente (happy-dom).
// A regra de contraste fica de fora: ela depende de layout e cores reais, que o
// happy-dom não calcula (o contraste tem teste próprio em
// scripts/theme-contrast.test.ts). Só falha com violação séria ou crítica.

export async function axeViolations(root: Element) {
  const result = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  })
  return result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
}

export async function expectNoAxeViolations(root: Element) {
  const violations = await axeViolations(root)
  const summary = violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
  expect(summary).toEqual([])
}

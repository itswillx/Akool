// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { axeViolations } from './axe'

// Garante que o axe roda de verdade no happy-dom: sem isto, um "0 violações"
// poderia ser só o axe não enxergando nada.
describe('axeViolations', () => {
  it('catches an icon-only button without a name and an unlabeled field', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<button type="button"><svg aria-hidden="true"></svg></button><input type="text" />'
    document.body.appendChild(root)
    const ids = (await axeViolations(root)).map(v => v.id)
    root.remove()
    expect(ids).toEqual(expect.arrayContaining(['button-name', 'label']))
  })
})

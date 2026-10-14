// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'projects_filter_labels_selected' ? '{count} selecionados' : k) }),
}))

import CardFilterBar from './CardFilterBar'
import { defaultCardFilters, type ProjectCardFilters } from '../../lib/projectCardFilters'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(filters: ProjectCardFilters, availableLabels: string[]) {
  const onChange = vi.fn<(next: ProjectCardFilters) => void>()
  act(() => {
    root.render(<CardFilterBar filters={filters} onChange={onChange} columns={[]} members={[]} availableLabels={availableLabels} />)
  })
  return onChange
}

const chip = (label: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement

const isActive = (el: HTMLButtonElement) => el.style.fontWeight === '600'

describe('CardFilterBar — rótulos sem caixa', () => {
  it('filtro salvo com outra grafia deixa o chip ativo e sai com um clique', () => {
    const filters = { ...defaultCardFilters(), labels: ['segurança'] }
    const onChange = render(filters, ['performance', 'Segurança'])

    expect(isActive(chip('Segurança'))).toBe(true)
    expect(isActive(chip('performance'))).toBe(false)

    act(() => { chip('Segurança').click() })
    expect(onChange).toHaveBeenCalledWith({ ...filters, labels: [] })
  })

  it('tira todas as grafias do mesmo tema e mantém os outros', () => {
    const filters = { ...defaultCardFilters(), labels: ['segurança', 'performance', 'SEGURANÇA'] }
    const onChange = render(filters, ['performance', 'Segurança'])

    act(() => { chip('Segurança').click() })
    expect(onChange).toHaveBeenCalledWith({ ...filters, labels: ['performance'] })
  })

  it('chip inativo acrescenta a grafia mostrada', () => {
    const filters = defaultCardFilters()
    const onChange = render(filters, ['Segurança'])

    expect(isActive(chip('Segurança'))).toBe(false)
    act(() => { chip('Segurança').click() })
    expect(onChange).toHaveBeenCalledWith({ ...filters, labels: ['Segurança'] })
  })

  it('com muitos rótulos recolhidos, mostra e conta cada tema uma vez', () => {
    const filters = { ...defaultCardFilters(), labels: ['segurança', 'Segurança'] }
    render(filters, ['a', 'b', 'c', 'd', 'e', 'f', 'Segurança'])

    expect(container.textContent).toContain('1 selecionados')
    const selected = [...container.querySelectorAll('button')].filter(b => b.textContent?.toLowerCase() === 'segurança')
    expect(selected).toHaveLength(1)
  })
})

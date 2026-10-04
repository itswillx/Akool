// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { render, screen } from '../../test/rtl'
import { AkoolBrand } from './AkoolBrand'

it('mostra o logotipo escondido do leitor de tela e o nome', () => {
  const { container } = render(<AkoolBrand />)
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(screen.getByText('Akool')).toBeTruthy()
})

it('compact esconde o nome (barra do topo no celular)', () => {
  render(<AkoolBrand compact size="sm" />)
  expect(screen.queryByText('Akool')).toBeNull()
})

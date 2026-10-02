// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RailBadge, RailButton, RailGroupTitle } from '@/shared/ui/RailButton'

// QA-004: o botão de nav lateral compartilhado por Projetos, Estudos,
// Documentos e Financeiro.
describe('RailButton', () => {
  afterEach(cleanup)

  it('marca o item ativo com aria-current e chama onClick', () => {
    const onClick = vi.fn()
    render(<RailButton icon={<span />} label="Quadros" active onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Quadros' })
    expect(btn.getAttribute('aria-current')).toBe('page')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('inativo não tem aria-current; badge e trailing aparecem', () => {
    render(<RailButton icon={<span />} label="Revisões" badge={3} trailing={<i data-testid="trailing" />} onClick={() => {}} />)
    const btn = screen.getByRole('button', { name: /Revisões/ })
    expect(btn.getAttribute('aria-current')).toBeNull()
    expect(btn.textContent).toContain('3')
    expect(screen.getByTestId('trailing')).toBeTruthy()
  })

  it('badge zero não aparece', () => {
    const { container } = render(<RailBadge count={0} />)
    expect(container.textContent).toBe('')
  })

  it('título de grupo renderiza o texto', () => {
    render(<RailGroupTitle>Início</RailGroupTitle>)
    expect(screen.getByText('Início')).toBeTruthy()
  })
})

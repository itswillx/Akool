// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Backdrop } from './Backdrop'

// QA-004: a camada de fundo dos modais, folhas e gavetas.
describe('Backdrop', () => {
  afterEach(cleanup)

  it('cobre a tela, recebe o clique fora e deixa o painel parar a propagação', () => {
    const onClick = vi.fn()
    render(
      <Backdrop onClick={onClick}>
        <div role="dialog" aria-label="painel">
          <button type="button" onClick={e => e.stopPropagation()}>dentro</button>
        </div>
      </Backdrop>,
    )
    const layer = screen.getByRole('presentation')
    expect(layer.style.position).toBe('fixed')
    expect(['0', '0px']).toContain(layer.style.inset)
    fireEvent.click(screen.getByRole('button', { name: 'dentro' }))
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.click(layer)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('alinha o painel na base (folha) ou à direita (gaveta)', () => {
    const { unmount } = render(<Backdrop align="bottom"><div /></Backdrop>)
    expect(screen.getByRole('presentation').style.justifyContent).toBe('flex-end')
    expect(screen.getByRole('presentation').style.flexDirection).toBe('column')
    unmount()
    render(<Backdrop align="right" zIndex={1100} color="rgb(1, 2, 3)"><div /></Backdrop>)
    const layer = screen.getByRole('presentation')
    expect(layer.style.justifyContent).toBe('flex-end')
    expect(layer.style.zIndex).toBe('1100')
    expect(layer.style.backgroundColor).toBe('rgb(1, 2, 3)')
  })
})

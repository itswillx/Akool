// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../../test/rtl'
import { getT } from '../../i18n/translations'
import { ModeSwitch } from './ModeSwitch'

const t = getT('pt-BR')

it('é uma navegação com dois links; o ativo leva aria-current e o clique pede a troca', () => {
  const onSwitch = vi.fn()
  render(<ModeSwitch view="signin" t={t} onSwitch={onSwitch} />)
  expect(screen.getByRole('navigation', { name: 'Entrar ou criar conta' })).toBeTruthy()
  const signin = screen.getByRole('link', { name: 'Entrar' })
  const signup = screen.getByRole('link', { name: 'Criar conta' })
  expect(signin.getAttribute('aria-current')).toBe('page')
  expect(signin.getAttribute('href')).toBe('#entrar')
  expect(signup.getAttribute('aria-current')).toBeNull()
  expect(signup.getAttribute('href')).toBe('#cadastro')
  fireEvent.click(signup)
  expect(onSwitch).toHaveBeenCalledWith('signup')
})

it('a pílula da aba ativa é uma só, decorativa, e segue a view', () => {
  const { container, rerender } = render(<ModeSwitch view="signin" t={t} onSwitch={vi.fn()} />)
  const nav = screen.getByRole('navigation')
  const pills = container.querySelectorAll('.auth-mode-pill')
  expect(pills).toHaveLength(1)
  expect(pills[0].getAttribute('aria-hidden')).toBe('true')
  expect(nav.getAttribute('data-active')).toBe('signin')
  rerender(<ModeSwitch view="signup" t={t} onSwitch={vi.fn()} />)
  // A mesma pílula (não remonta): o CSS a faz deslizar até a outra aba.
  expect(container.querySelector('.auth-mode-pill')).toBe(pills[0])
  expect(nav.getAttribute('data-active')).toBe('signup')
})

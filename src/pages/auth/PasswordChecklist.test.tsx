// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { render, screen } from '../../test/rtl'
import { getT } from '../../i18n/translations'
import { PasswordChecklist } from './PasswordChecklist'

const t = getT('pt-BR')

it('lista as quatro regras e marca o que a senha já atende', () => {
  const { container, rerender } = render(<PasswordChecklist password="" t={t} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  expect(container.querySelectorAll('li[data-met="true"]')).toHaveLength(0)
  rerender(<PasswordChecklist password="abcdefghij" t={t} />)
  // 10 caracteres e minúscula atendidos; maiúscula e número pendentes.
  expect(container.querySelectorAll('li[data-met="true"]')).toHaveLength(2)
  expect(screen.getByText('Uma letra maiúscula').parentElement?.getAttribute('data-met')).toBe('false')
  rerender(<PasswordChecklist password="Abcdefghij1" t={t} />)
  expect(container.querySelectorAll('li[data-met="true"]')).toHaveLength(4)
})

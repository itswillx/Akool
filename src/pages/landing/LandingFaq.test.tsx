// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { render, screen } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { landingContent } from '../../i18n/landingContent'
import { LandingFaq } from './LandingFaq'

it('perguntas frequentes: um <details> por pergunta, no mesmo grupo, sem violações sérias', async () => {
  const c = landingContent['pt-BR']
  const { container } = render(<LandingFaq c={c} isMobile />)
  expect(screen.getByRole('heading', { level: 2, name: c.faq.title })).toBeTruthy()
  const items = [...container.querySelectorAll('details')]
  expect(items).toHaveLength(c.faq.items.length)
  expect(items.every(d => d.getAttribute('name') === 'landing-faq')).toBe(true)
  expect(items.map(d => d.querySelector('summary')?.textContent)).toEqual(c.faq.items.map(item => item.q))
  expect(screen.getByText(c.faq.items[0].a)).toBeTruthy()
  await expectNoAxeViolations(container)
})

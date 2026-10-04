// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { authContent } from '../../i18n/authContent'
import type { AuthPanelContext } from '../../i18n/authContent'
import { getT } from '../../i18n/translations'
import { AuthContextPanel } from './AuthContextPanel'

// O painel ao lado (ou embaixo) do cartão muda com a tela.

const CONTEXTS: AuthPanelContext[] = ['signin', 'signup', 'forgot', 'mfa', 'reset']

describe('AuthContextPanel', () => {
  it.each(CONTEXTS)('%s: título, itens e nota do contexto, sem links nem violações sérias', async context => {
    const panel = authContent['pt-BR'][context]
    const { container } = render(<AuthContextPanel lang="pt-BR" t={getT('pt-BR')} context={context} wide />)
    const aside = screen.getByRole('complementary', { name: panel.title })
    expect(screen.getByRole('heading', { level: 2, name: panel.title })).toBeTruthy()
    expect(screen.getByText(panel.lead)).toBeTruthy()
    // Passos numerados em lista ordenada; pontos com ícone em lista simples.
    expect(aside.querySelectorAll(panel.kind === 'steps' ? 'ol > li' : 'ul > li')).toHaveLength(3)
    for (const item of panel.items) expect(screen.getByText(item.title)).toBeTruthy()
    expect(screen.getByText(panel.note)).toBeTruthy()
    expect(container.querySelectorAll('a, button')).toHaveLength(0)
    // A prévia do app só em Entrar, e só ao lado do cartão.
    expect(container.querySelector('.pv') !== null).toBe(context === 'signin')
    await expectNoAxeViolations(container)
  })

  it('embaixo do cartão fica sem a prévia; em inglês, com o texto em inglês', () => {
    const { container } = render(<AuthContextPanel lang="en" t={getT('en')} context="signin" wide={false} />)
    expect(screen.getByRole('heading', { level: 2, name: authContent.en.signin.title })).toBeTruthy()
    expect(container.querySelector('.pv')).toBeNull()
  })
})

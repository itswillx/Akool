// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { getT, loadLang } from '../../i18n/translations'
import { appPreviewContent } from '../../i18n/appPreviewContent'
import { landingContent } from '../../i18n/landingContent'
import type { Lang } from '../../i18n/translations'
import LandingSections from './LandingSections'

function renderLanding(lang: Lang) {
  const onNavigate = vi.fn()
  const utils = render(
    <LandingSections lang={lang} t={getT(lang)} isMobile={false} onNavigate={onNavigate} langSwitch={<span data-testid="lang-switch" />} />,
  )
  return { ...utils, onNavigate }
}

describe('LandingSections', () => {
  it('mostra hero, módulos, vitrine, passos, destaques, perguntas, faixa final e rodapé em pt-BR, sem violações sérias', async () => {
    const c = landingContent['pt-BR']
    const { container, onNavigate } = renderLanding('pt-BR')
    const region = (name: string) => within(screen.getByRole('region', { name }))

    expect(screen.getByRole('heading', { level: 1, name: c.hero.title })).toBeTruthy()
    expect(screen.getByText(c.hero.eyebrow)).toBeTruthy()
    expect(screen.getByText(c.hero.inviteNote)).toBeTruthy()
    expect(region(c.hero.title).getAllByRole('listitem').map(li => li.textContent)).toEqual(c.hero.facts)
    // A prévia do hero é uma demonstração: a barra lateral troca o módulo.
    const hero = region(c.hero.title)
    const demo = within(hero.getByRole('group', { name: appPreviewContent['pt-BR'].demo.label }))
    fireEvent.click(demo.getByRole('radio', { name: appPreviewContent['pt-BR'].nav.finance }))
    expect(demo.getByText(appPreviewContent['pt-BR'].finance.income)).toBeTruthy()
    for (const m of c.modules.items) expect(screen.getByRole('heading', { level: 3, name: m.title })).toBeTruthy()
    expect(region(c.showcase.title).getAllByRole('tab')).toHaveLength(c.showcase.items.length)
    expect(region(c.steps.title).getAllByRole('listitem')).toHaveLength(3)
    expect(region('Tudo em um só lugar').getAllByRole('listitem')).toHaveLength(c.highlights.items.length)
    expect(container.querySelectorAll('details[name="landing-faq"]')).toHaveLength(c.faq.items.length)
    expect(screen.getByRole('heading', { level: 2, name: c.cta.title })).toBeTruthy()
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} Akool`))).toBeTruthy()
    expect(screen.getByTestId('lang-switch')).toBeTruthy()

    // Hero, faixa final e rodapé.
    const signup = screen.getAllByRole('link', { name: 'Criar conta' })
    expect(signup.map(a => a.getAttribute('href'))).toEqual(['#cadastro', '#cadastro', '#cadastro'])
    expect(screen.getAllByRole('link', { name: 'Entrar' }).map(a => a.getAttribute('href'))).toEqual(['#entrar', '#entrar', '#entrar'])

    fireEvent.click(signup[0])
    expect(onNavigate).toHaveBeenCalledWith('signup')
    // cmd/ctrl + clique: o navegador abre o href real em nova aba; nada de preventDefault.
    expect(fireEvent.click(signup[0], { metaKey: true })).toBe(true)
    expect(onNavigate).toHaveBeenCalledTimes(1)

    await expectNoAxeViolations(container)
  })

  it('em inglês, usa o texto em inglês', async () => {
    await loadLang('en')
    renderLanding('en')
    expect(screen.getByRole('heading', { level: 1, name: landingContent.en.hero.title })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Sign in' })).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 2, name: landingContent.en.faq.title })).toBeTruthy()
  })
})

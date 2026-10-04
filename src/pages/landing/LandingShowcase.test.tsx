// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { fireEvent, render, screen, within } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { getT } from '../../i18n/translations'
import { appPreviewContent } from '../../i18n/appPreviewContent'
import { landingContent } from '../../i18n/landingContent'
import { LandingShowcase } from './LandingShowcase'

// A vitrine por módulo: abas WAI-ARIA, troca automática guiada pelo fim da
// animação da barra de progresso (aqui disparado à mão: o happy-dom não anima).

const c = landingContent['pt-BR']
const labels = c.showcase.items.map(item => item.label)

function renderShowcase(isMobile = false) {
  return render(<LandingShowcase c={c} lang="pt-BR" t={getT('pt-BR')} isMobile={isMobile} />)
}

const selectedTab = () => screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true')
const progressBar = () => {
  const bar = document.querySelector('.landing-tab-progress')
  if (!bar) throw new Error('barra de progresso não encontrada')
  return bar
}

describe('LandingShowcase', () => {
  it('mostra uma aba por módulo, o painel ligado à aba e nenhuma violação séria', async () => {
    const { container } = renderShowcase()
    expect(screen.getByRole('tablist', { name: c.showcase.tabsLabel })).toBeTruthy()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(labels)
    expect(selectedTab()?.textContent).toBe(labels[0])
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(selectedTab()?.id)
    expect(screen.getByText(c.showcase.items[0].lead)).toBeTruthy()
    expect(panel.querySelectorAll('li')).toHaveLength(4)
    // A prévia do painel é uma demonstração (grupo com nome), não decoração.
    expect(within(panel).getByRole('group', { name: appPreviewContent['pt-BR'].demo.label })).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('o fim da barra passa para a próxima aba e, na última, volta à primeira', () => {
    renderShowcase()
    for (const label of [...labels.slice(1), labels[0]]) {
      fireEvent.animationEnd(progressBar(), { animationName: 'landing-showcase-progress' })
      expect(selectedTab()?.textContent).toBe(label)
    }
    // Outra animação que termina dentro da aba não troca nada.
    fireEvent.animationEnd(progressBar(), { animationName: 'auth-rise' })
    expect(selectedTab()?.textContent).toBe(labels[0])
  })

  it('Pausar segura a troca; Retomar volta a trocar', () => {
    renderShowcase(true)
    fireEvent.click(screen.getByRole('button', { name: c.showcase.pause }))
    fireEvent.animationEnd(progressBar(), { animationName: 'landing-showcase-progress' })
    expect(selectedTab()?.textContent).toBe(labels[0])
    fireEvent.click(screen.getByRole('button', { name: c.showcase.resume }))
    fireEvent.animationEnd(progressBar(), { animationName: 'landing-showcase-progress' })
    expect(selectedTab()?.textContent).toBe(labels[1])
  })

  it('escolher uma aba (clique ou setas) abre o módulo e pausa a troca automática', () => {
    renderShowcase()
    fireEvent.click(screen.getByRole('tab', { name: labels[2] }))
    expect(screen.getByText(c.showcase.items[2].lead)).toBeTruthy()
    expect(screen.getByRole('button', { name: c.showcase.resume })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: labels[2] }), { key: 'ArrowRight' })
    expect(selectedTab()?.textContent).toBe(labels[3])
    expect(document.activeElement).toBe(selectedTab())
    fireEvent.animationEnd(progressBar(), { animationName: 'landing-showcase-progress' })
    expect(selectedTab()?.textContent).toBe(labels[3])
  })
})

describe('LandingShowcase: a prévia é uma demonstração', () => {
  const P = appPreviewContent['pt-BR']
  const navRadio = (name: string) => within(screen.getByRole('radiogroup', { name: P.demo.navLabel })).getByRole('radio', { name })

  afterEach(() => { vi.unstubAllGlobals() })

  it('a barra lateral da prévia troca a aba e pausa; a prévia não remonta', () => {
    renderShowcase()
    const finance = navRadio(P.nav.finance)
    fireEvent.click(finance)
    expect(selectedTab()?.textContent).toBe(c.showcase.items.find(item => item.id === 'finance')?.label)
    expect(screen.getByRole('button', { name: c.showcase.resume })).toBeTruthy()
    // O mesmo rádio continua na página: a prévia guardou o que a pessoa fez.
    expect(finance.isConnected).toBe(true)
  })

  it('o Dashboard mostra a visão geral sem trocar a aba; a troca automática volta ao módulo', () => {
    renderShowcase()
    fireEvent.click(navRadio(P.nav.dashboard))
    expect(selectedTab()?.textContent).toBe(labels[0])
    expect(document.querySelector('.landing-showcase-panel .pv-float')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: c.showcase.resume }))
    fireEvent.animationEnd(progressBar(), { animationName: 'landing-showcase-progress' })
    expect(selectedTab()?.textContent).toBe(labels[1])
    expect(document.querySelector('.landing-showcase-panel .pv-float')).toBeNull()
  })

  it('mexer na prévia (marcar uma tarefa) pausa a troca automática', () => {
    renderShowcase()
    fireEvent.click(screen.getByRole('checkbox', { name: P.page.tasks[2] }))
    expect(screen.getByRole('button', { name: c.showcase.resume })).toBeTruthy()
  })

  it('fora da tela, a vitrine marca data-inview=false (o CSS pausa a barra)', () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { notify = callback }
      observe() {}
      disconnect = disconnect
    })
    const { container, unmount } = renderShowcase()
    const root = container.querySelector('.landing-showcase')
    expect(root?.getAttribute('data-inview')).toBe('false')
    act(() => notify([{ isIntersecting: true }]))
    expect(root?.getAttribute('data-inview')).toBe('true')
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})

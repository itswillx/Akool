// @vitest-environment happy-dom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { appPreviewContent } from '../../i18n/appPreviewContent'
import { getT } from '../../i18n/translations'
import { AppPreview } from './AppPreview'
import type { AppPreviewVariant } from './AppPreview'
import { monthKpis, previewMoney } from './previewState'

// A prévia do app tem dois modos: ilustração (painel do login: aria-hidden +
// inert, nada focável) e demonstração (landing: controles nativos que mexem só
// na prévia).

const VARIANTS: AppPreviewVariant[] = ['overview', 'pages', 'projects', 'finance', 'study']
const FOCUSABLE = 'a, button, input, select, textarea, [tabindex]'
const PT = appPreviewContent['pt-BR']
const t = getT('pt-BR')

/** A demonstração controlada como a landing faz: a barra lateral troca o módulo. */
function Demo({ start = 'overview', onInteract }: { start?: AppPreviewVariant; onInteract?: () => void }) {
  const [variant, setVariant] = useState<AppPreviewVariant>(start)
  return <AppPreview lang="pt-BR" t={t} variant={variant} interactive onVariantChange={setVariant} onInteract={onInteract} />
}

const column = (name: string | RegExp) => screen.getByRole('group', { name })

describe('AppPreview: ilustração', () => {
  it.each(VARIANTS.flatMap(variant => (['md', 'sm'] as const).map(size => [variant, size] as const)))(
    '%s (%s) é decorativa e não tem nada focável',
    async (variant, size) => {
      const { container } = render(<AppPreview lang="pt-BR" t={t} variant={variant} size={size} />)
      const root = container.querySelector('.pv')
      expect(root?.getAttribute('aria-hidden')).toBe('true')
      expect(root?.hasAttribute('inert')).toBe(true)
      expect(root?.classList.contains(`pv-${size}`)).toBe(true)
      expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0)
      // A barra lateral só no tamanho md.
      expect(container.querySelector('.pv-side') !== null).toBe(size === 'md')
      await expectNoAxeViolations(container)
    },
  )

  it('mostra o conteúdo do idioma da tela', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      const c = appPreviewContent[lang]
      const { container, unmount } = render(<AppPreview lang={lang} t={getT(lang)} variant="overview" />)
      expect(container.textContent).toContain(c.board.cards.signup.title)
      expect(container.textContent).toContain(previewMoney(lang, monthKpis(5).balance))
      // Visão geral acende o Dashboard; o quadro mostra a prioridade com o rótulo do app.
      expect(container.querySelector('.pv-nav-on')?.textContent).toBe(c.nav.dashboard)
      unmount()
    }
    const { container } = render(<AppPreview lang="pt-BR" t={t} variant="projects" />)
    expect(container.textContent).toContain('Urgente')
  })
})

describe('AppPreview: demonstração', () => {
  it.each(VARIANTS)('%s é um grupo com nome, sem violações sérias', async variant => {
    const { container } = render(<AppPreview lang="pt-BR" t={t} variant={variant} interactive />)
    const root = screen.getByRole('group', { name: PT.demo.label })
    expect(root.hasAttribute('inert')).toBe(false)
    expect(root.getAttribute('aria-hidden')).toBeNull()
    expect(screen.getByText(PT.demo.hint)).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('a barra lateral troca o módulo (Estudos acende Documentos) e avisa a interação', () => {
    const onInteract = vi.fn()
    render(<Demo start="study" onInteract={onInteract} />)
    const nav = within(screen.getByRole('radiogroup', { name: PT.demo.navLabel }))
    expect(nav.getByRole<HTMLInputElement>('radio', { name: PT.nav.documents }).checked).toBe(true)
    fireEvent.click(nav.getByRole('radio', { name: PT.nav.finance }))
    expect(onInteract).toHaveBeenCalledTimes(1)
    expect(screen.getByText(PT.finance.monthsLong[5])).toBeTruthy()
    fireEvent.click(nav.getByRole('radio', { name: PT.nav.dashboard }))
    expect(screen.getByText(PT.board.name)).toBeTruthy()
    expect(document.querySelector('.pv-float')).toBeTruthy()
  })

  it('o card vai para a próxima coluna com o foco junto; da última volta à primeira; WIP acima do limite avisa', () => {
    render(<Demo start="projects" />)
    const [todo, doing, done] = PT.board.columns
    const card = () => screen.getByRole('button', { name: new RegExp(PT.board.cards.copy.title) })
    expect(within(column(todo)).getByRole('button', { name: new RegExp(PT.board.cards.copy.title) })).toBeTruthy()
    // O nome diz para onde o clique leva.
    expect(card().textContent).toContain(`${PT.demo.moveTo} ${doing}`)

    fireEvent.click(card())
    expect(within(column(`${doing} 3/3`)).getByRole('button', { name: new RegExp(PT.board.cards.copy.title) })).toBe(document.activeElement)
    expect(document.querySelector('.pv-wip-over')).toBeNull()

    // 4/3: a coluna avisa, sem bloquear.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(PT.board.cards.mobile.title) }))
    expect(column(`${doing} 4/3`)).toBeTruthy()
    expect(document.querySelector('.pv-wip-over')?.textContent).toBe('4/3')

    fireEvent.click(card())
    expect(within(column(done)).getByRole('button', { name: new RegExp(PT.board.cards.copy.title) })).toBe(document.activeElement)
    fireEvent.click(card())
    expect(within(column(todo)).getByRole('button', { name: new RegExp(PT.board.cards.copy.title) })).toBe(document.activeElement)
  })

  it('Cronograma e Lista mostram os mesmos cards, com o que já foi concluído riscado', () => {
    const { container } = render(<Demo start="projects" />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(PT.board.cards.pdf.title) }))
    const views = within(screen.getByRole('radiogroup', { name: PT.demo.viewsLabel }))
    fireEvent.click(views.getByRole('radio', { name: PT.board.views[1] }))
    expect(container.querySelectorAll('.pv-tl-bar')).toHaveLength(5)
    expect(container.querySelectorAll('.pv-tl-bar-done')).toHaveLength(2)
    fireEvent.click(views.getByRole('radio', { name: PT.board.views[2] }))
    const rows = [...container.querySelectorAll('.pv-list-row')]
    expect(rows).toHaveLength(5)
    expect(rows.find(row => row.textContent?.includes(PT.board.cards.pdf.title))?.textContent).toContain(PT.board.columns[2])
    expect(container.querySelectorAll('.pv-list-title.pv-done')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: new RegExp(PT.board.cards.pdf.title) })).toBeNull()
  })

  it('tarefas e pontos de estudo são checkboxes; a barra da etapa acompanha', () => {
    const pages = render(<Demo start="pages" />)
    const task = screen.getByRole<HTMLInputElement>('checkbox', { name: PT.page.tasks[2] })
    expect(task.checked).toBe(false)
    fireEvent.click(task)
    expect(task.checked).toBe(true)
    pages.unmount()

    const { container } = render(<Demo start="study" />)
    const progress = () => (container.querySelector('.pv-progress') as HTMLElement).style.width
    expect(progress()).toBe('67%')
    fireEvent.click(screen.getByRole('checkbox', { name: PT.study.points[2] }))
    expect(progress()).toBe('100%')
  })

  it('escolher um mês no gráfico troca os totais', () => {
    render(<Demo start="finance" />)
    const months = within(screen.getByRole('radiogroup', { name: PT.demo.monthsLabel }))
    fireEvent.click(months.getByRole('radio', { name: PT.finance.months[2] }))
    const july = monthKpis(2)
    expect(screen.getByText(PT.finance.monthsLong[2])).toBeTruthy()
    // O pt-BR separa "R$" com espaço não separável; o texto da tela vem normalizado.
    const money = (value: number) => previewMoney('pt-BR', value).replace(/\s/g, ' ')
    expect(screen.getByText(money(july.income))).toBeTruthy()
    expect(screen.getByText(money(july.balance))).toBeTruthy()
  })

  it('em inglês, com os textos em inglês', () => {
    const en = appPreviewContent.en
    render(<AppPreview lang="en" t={getT('en')} variant="projects" interactive />)
    expect(screen.getByRole('group', { name: en.demo.label })).toBeTruthy()
    expect(screen.getByRole('group', { name: `${en.board.columns[1]} 2/3` })).toBeTruthy()
  })
})

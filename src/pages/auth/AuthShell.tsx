import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import type { AuthPanelContext } from '../../i18n/authContent'
import type { Lang } from '../../i18n/translations'
import { AuthContextPanel } from './AuthContextPanel'
import { AuthTopBar } from './AuthTopBar'
import type { AuthView, Translate } from './authView'
import './authMotion.css'

// O shell de todas as telas sem sessão completa: landing, login/cadastro,
// MFA e redefinição de senha. Contêiner de rolagem (#root é overflow: hidden),
// barra do topo, foco e título da aba por view; o AuthCardLayout põe o cartão
// e o painel da tela (ao lado no desktop largo, embaixo nas outras larguras).
// O movimento (transições, entradas, barra ao rolar) fica em authMotion.css.

export function AuthShell({ view, lang, t, isMobile, onNavigate, onChangeLang, action, title, focus = 'heading', children }: {
  view: AuthView
  lang: Lang
  t: Translate
  isMobile: boolean
  onNavigate: (view: AuthView) => void
  onChangeLang: (lang: Lang) => void
  action?: ReactNode
  /** Título da aba ("X · Akool"); null = só "Akool". */
  title: string | null
  /** `heading`: foca o h1 da view (na landing, o contêiner). `none`: quem usa o shell cuida do foco. */
  focus?: 'heading' | 'none'
  children: ReactNode
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  useDocumentTitle(title)

  // Na montagem o foco vai ao h1 da view (ou ao contêiner, na landing, para
  // Space/PageDown rolarem antes de qualquer clique). Na troca de view a tela
  // volta ao topo e o foco vai ao título novo: o leitor de tela anuncia a tela
  // e o teclado continua dali; o Voltar do navegador passa pelo mesmo caminho.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const first = !mountedRef.current
    mountedRef.current = true
    if (!first) scroller.scrollTop = 0
    if (focus === 'none') return
    const heading = view === 'landing' && first ? null : scroller.querySelector<HTMLElement>('h1[tabindex]')
    ;(heading ?? scroller).focus({ preventScroll: true })
  }, [view, focus])

  return (
    // tabIndex -1: recebe o foco por código, nunca pelo Tab.
    <div
      ref={scrollerRef}
      tabIndex={-1}
      className="auth-scroll"
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg)' }}
    >
      <AuthTopBar view={view} lang={lang} t={t} isMobile={isMobile} onNavigate={onNavigate} onChangeLang={onChangeLang} action={action} />
      {children}
    </div>
  )
}

export function AuthCardLayout({ lang, t, isMobile, context, children }: {
  /** O idioma da tela (uiLang): o painel nunca mistura idiomas com o cartão. */
  lang: Lang
  t: Translate
  isMobile: boolean
  /** Qual painel acompanha o cartão. */
  context: AuthPanelContext
  children: ReactNode
}) {
  // Painel ao lado só com largura de sobra (≥ 960 px); abaixo disso, embaixo do cartão.
  const wide = !useIsMobile(959)
  return (
    <main
      style={{
        flex: 1, display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'center',
        padding: isMobile ? '16px 12px 24px' : '32px 24px', backgroundColor: 'var(--color-bg-secondary)', boxSizing: 'border-box',
      }}
    >
      {/* auth-enter: sobe ao montar (chegando da landing); a troca entre abas não remonta. */}
      <div className="auth-enter" style={{ width: '100%', maxWidth: wide ? 1040 : 420, display: 'grid', gridTemplateColumns: wide ? 'minmax(0, 1fr) 420px' : 'minmax(0, 1fr)', gap: wide ? 56 : 20, alignItems: 'center' }}>
        {/* O cartão vem antes no DOM (o formulário é o principal); no desktop o painel vai à esquerda por order. */}
        <div
          className="auth-card"
          style={{
            backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: isMobile ? 12 : 16,
            boxShadow: isMobile ? 'none' : '0 4px 24px rgba(0,0,0,0.14)', width: '100%', boxSizing: 'border-box',
          }}
        >
          <div className="auth-card-body" style={{ padding: isMobile ? 20 : 40 }}>{children}</div>
        </div>
        {/* key: a troca de tela remonta o painel e a entrada em sequência roda de novo. */}
        <AuthContextPanel key={context} lang={lang} t={t} context={context} wide={wide} />
      </div>
    </main>
  )
}

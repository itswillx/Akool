import { lazy, Suspense, useEffect, useState } from 'react'
import { recoveryLinkError } from '../lib/supabase'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { AuthForm } from './auth/AuthForm'
import { AuthCardLayout, AuthShell } from './auth/AuthShell'
import { LangSwitch } from './auth/AuthTopBar'
import { useAuthLang } from './auth/useAuthLang'
import { clearAuthHash, initialView, pushAuthView, replaceAuthView, subscribeAuthHash, viewFromHash } from './auth/authView'
import type { AuthFormView, AuthView } from './auth/authView'
import { runAuthTransition } from './auth/viewTransition'

// A tela de quem não está logado: a página pública (landing) em `/` e, em
// #entrar / #cadastro / #recuperar, a tela de login. O gate aqui cuida da view
// (espelhada no hash, ver authView.ts); idioma, foco e título vêm do AuthShell
// e do useAuthLang; o formulário está em auth/AuthForm.tsx. O tema do aparelho
// é aplicado no boot (main.tsx, src/lib/storedTheme.ts).
//
// PERF-012: as seções da landing são um chunk à parte (import() não é
// pré-carregado), então quem chega direto no login não baixa a landing.
// Na volta à landing, o chunk é baixado antes da transição e, uma vez aqui, o
// componente é usado direto: o React.lazy só se resolve ao renderizar, então a
// transição fotografaria o "Carregando…" em vez da landing.
type LandingModule = typeof import('./landing/LandingSections')
let landingModule: LandingModule | null = null
const loadLanding = () => import('./landing/LandingSections').then(module => {
  landingModule = module
  return module
})
const LazyLandingSections = lazy(loadLanding)

export default function AuthPage({ dailyLoginRequired = false, onSignedIn }: {
  dailyLoginRequired?: boolean
  /** Avisa o App que a pessoa entrou (ele zera a flag do login diário). */
  onSignedIn?: () => void
}) {
  const isMobile = useIsMobile()
  const { lang, uiLang, t, changeLang } = useAuthLang()
  // Login diário (REL-007) e link de recuperação expirado abrem direto no
  // formulário, como antes da página pública existir.
  const forced: AuthView | null = dailyLoginRequired ? 'signin' : recoveryLinkError ? 'forgot' : null
  const [view, setView] = useState<AuthView>(() => initialView(forced, window.location.hash))
  // Abriu direto no login (#entrar, login diário…): ao chegar à landing depois,
  // o h1 dela recebe o foco quando o chunk montar.
  const [startedOnLanding] = useState(() => view === 'landing')

  // Voltar/Avançar do navegador e links com hash: a view segue a URL.
  useEffect(() => subscribeAuthHash(() => setView(viewFromHash(window.location.hash))), [])
  // A URL espelha a view forçada sem entrada nova no histórico (e troca o
  // `#error=…` do link expirado por #recuperar).
  useEffect(() => { if (forced) replaceAuthView(forced) }, [forced])

  // Landing ↔ login: crossfade da página (View Transition) e o conteúdo novo
  // sobe ao montar. O Voltar do navegador (acima) não anima: o celular já
  // anima o gesto.
  const go = (next: AuthView) => {
    if (next === view) return
    pushAuthView(next)
    const run = () => runAuthTransition('page', () => setView(next))
    if (next === 'landing') void loadLanding().then(run, run)
    else run()
  }
  // Entrar ↔ Criar conta não empilha histórico; abrir a recuperação sim (o
  // Voltar devolve o login). Síncrono: o AuthForm já chama isto dentro da
  // transição do cartão.
  const switchForm = (next: AuthFormView) => {
    if (next === 'forgot') pushAuthView(next)
    else replaceAuthView(next)
    setView(next)
  }
  const handleSignedIn = () => {
    clearAuthHash()
    onSignedIn?.()
  }
  const title = view === 'landing' ? null
    : view === 'signin' ? t('auth_signin_btn')
    : view === 'signup' ? t('auth_signup_btn')
    : t('auth_forgot_title')

  const Landing = landingModule?.default ?? LazyLandingSections
  return (
    <AuthShell view={view} lang={lang} t={t} isMobile={isMobile} onNavigate={go} onChangeLang={changeLang} title={title}>
      {view === 'landing' ? (
        <Suspense
          fallback={
            // Enquanto o chunk da landing baixa: a página nunca fica em branco nem sem o landmark.
            <main aria-busy="true" style={{ flex: 1, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)' }}>
              {t('app_loading')}
            </main>
          }
        >
          <Landing
            lang={uiLang}
            t={t}
            isMobile={isMobile}
            onNavigate={go}
            langSwitch={<LangSwitch lang={lang} t={t} isMobile={isMobile} onChange={changeLang} />}
            focusHeading={!startedOnLanding}
          />
        </Suspense>
      ) : (
        <AuthCardLayout lang={uiLang} t={t} isMobile={isMobile} context={view}>
          <AuthForm
            view={view}
            onSwitch={switchForm}
            t={t}
            dailyLoginRequired={dailyLoginRequired}
            recoveryExpired={recoveryLinkError}
            onSignedIn={handleSignedIn}
          />
        </AuthCardLayout>
      )}
    </AuthShell>
  )
}

import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { LOCAL_KEYS } from './lib/localKeys'
import { Menu } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider, useToast } from './contexts/ToastContext'
import { PagesProvider } from './contexts/PagesContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { OnboardingProvider } from './contexts/OnboardingContext'
import { LanguageProvider, useLanguage } from './i18n/LanguageContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { WorkspaceModeProvider } from './contexts/WorkspaceModeContext'
import AuthPage from './pages/AuthPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import MfaChallengePage from './pages/MfaChallengePage'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import WorkspaceModeSwitch from './components/WorkspaceModeSwitch'
import { UserAvatar } from '@/shared/ui/UserAvatar'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { useDialog } from '@/shared/hooks/useDialog'
import { useDayRollover } from './hooks/useDayRollover'
import { mustReLogin } from './lib/dailyLogin'
import { localDateKey } from './lib/localDate'
import { setObservabilityUser } from './lib/observability'
import { onReconnect } from './lib/connectivity'
import OfflineBanner from './components/OfflineBanner'

// PERF-009: fora do boot (leva o AvatarCropModal e o react-easy-crop junto).
const UserSettingsModal = lazy(() => import('./components/UserSettingsModal'))
import { getT, toLang } from './i18n/translations'

// UX-003: a sidebar aberta é um painel modal (Esc fecha, Tab preso, foco volta
// ao botão). Componentes à parte porque precisam do LanguageProvider, que o
// AppInner monta abaixo de si.
function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage()
  const { dialogProps } = useDialog({ open, onClose, closeOnEsc: true, label: t('sidebar_label') })
  if (!open) return null
  return (
    <>
      <div id="app-sidebar" {...dialogProps} style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 60, boxShadow: '4px 0 24px rgba(0,0,0,0.18)' }}>
        <Sidebar onNavigate={onClose} />
      </div>
      <div role="presentation"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 55 }}
      />
    </>
  )
}

function SidebarToggle({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('sidebar_open')}
      aria-expanded={open}
      aria-controls="app-sidebar"
      style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-text)', padding: 0 }}
    >
      <Menu size={18} />
    </button>
  )
}

function AppInner() {
  const { user, profile, loading, signOut, justSignedIn, recoveryMode, mfaPending } = useAuth()
  // UX-011: o AppInner já está dentro do LanguageProvider (idioma do perfil ou
  // da tela de login).
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [dailyLoginRequired, setDailyLoginRequired] = useState(false)
  const { showToast } = useToast()
  // Conta já checada neste boot (REL-007).
  const dailyCheckedUserRef = useRef<string | null>(null)

  useEffect(() => {
    // REL-007: uma vez por conta, no boot — antes a checagem rodava a cada
    // mudança do profile (trocar tema/idioma) e deslogava no meio da sessão.
    // recoveryMode: a user arriving from the recovery email link hasn't
    // "logged in today" yet — signing them out here would kill the reset flow.
    if (loading || !user?.id || !profile || profile.id !== user.id) return
    if (dailyCheckedUserRef.current === user.id) return
    dailyCheckedUserRef.current = user.id
    if (mustReLogin({ lastLoginDate: profile.last_login_date, today: localDateKey(), justSignedIn, recoveryMode })) {
      // Fora do corpo do efeito: o aviso fica marcado antes do SIGNED_OUT,
      // e a tela de login já abre explicando o porquê.
      queueMicrotask(() => {
        setDailyLoginRequired(true)
        void signOut()
      })
    }
  }, [loading, user?.id, profile, justSignedIn, recoveryMode, signOut])

  // REL-011: eventos do Sentry levam só o id da conta (nada de e-mail).
  useEffect(() => { setObservabilityUser(user?.id ?? null) }, [user?.id])

  // REL-012: rascunhos guardados sem conexão voltam para o servidor logo após
  // o login e sempre que a conexão volta (páginas abertas cuidam das suas).
  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    const send = () => { void import('./lib/offlineSync').then(sync => sync.flushDrafts(userId)) }
    send()
    return onReconnect(send)
  }, [user?.id])

  // Dia que vira com o app aberto: só avisa; o login é pedido no próximo boot.
  useDayRollover(!!user && !loading, () => {
    const lang = toLang(localStorage.getItem(LOCAL_KEYS.authLang))
    showToast('warning', getT(lang)('daily_login_rollover'), { duration: 0, dedupeKey: 'daily-login-rollover' })
  })


  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700 }}>A</div>
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{t('app_loading')}</span>
        </div>
      </div>
    )
  }

  // Recovery link flow: show the set-new-password screen even while `user`
  // is momentarily null (the page handles the missing-session case itself).
  if (recoveryMode) return <ResetPasswordPage />

  if (!user) return <AuthPage dailyLoginRequired={dailyLoginRequired} />

  // SEC-004: conta com MFA ativo entra só depois do código (sessão AAL2).
  if (mfaPending) return <MfaChallengePage />

  const closeSidebar = () => setSidebarOpen(false)

  return (
    // O LanguageProvider fica em App (UX-011), acima do PagesProvider e do
    // ToastProvider: os toasts e o contexto de páginas saem no idioma do perfil.
    <PagesProvider>
      <NotificationsProvider>
      <ThemeProvider>
      <OnboardingProvider>
      <WorkspaceModeProvider>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        {/* Sidebar: overlay drawer on all devices */}
        <SidebarDrawer open={sidebarOpen} onClose={closeSidebar} />

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <OfflineBanner />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', flexShrink: 0 }}>
              <SidebarToggle open={sidebarOpen} onOpen={() => setSidebarOpen(true)} />
              <div style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700, fontSize: 13 }}>A</div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Akool</span>
              <WorkspaceModeSwitch />
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setShowAccount(true)}
                  title={profile?.display_name || user?.email || ''}
                  aria-label={t('account_menu')}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: isMobile ? 4 : '0 12px 0 5px', borderRadius: 9, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text)', flexShrink: 0 }}
                >
                  <UserAvatar
                    name={profile?.display_name || user?.email || '?'}
                    seed={user?.email}
                    emoji={profile?.avatar_emoji}
                    color={profile?.avatar_color}
                    url={profile?.avatar_url}
                    size={26}
                  />
                  {!isMobile && (
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile?.display_name || user?.email}
                    </span>
                  )}
                </button>
              </div>
            </div>
          <MainContent isMobile={isMobile} />
          {showAccount && (
            <Suspense fallback={null}>
              <UserSettingsModal open onClose={() => setShowAccount(false)} />
            </Suspense>
          )}
        </main>
      </div>
      </WorkspaceModeProvider>
      </OnboardingProvider>
      </ThemeProvider>
      </NotificationsProvider>
    </PagesProvider>
  )
}

// UX-011: Auth > Language > Toast. O LanguageProvider depende do perfil (Auth),
// e o ToastStack escreve com t() (o "Fechar" do toast): com o Toast por fora,
// ele ficava sempre em pt-BR. O AuthProvider não usa toast.
export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </LanguageProvider>
    </AuthProvider>
  )
}

import { useState, useEffect, useRef } from 'react'
import { Menu } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PagesProvider } from './contexts/PagesContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { OnboardingProvider } from './contexts/OnboardingContext'
import { LanguageProvider } from './i18n/LanguageContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { WorkspaceModeProvider } from './contexts/WorkspaceModeContext'
import AuthPage from './pages/AuthPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import WorkspaceModeSwitch from './components/WorkspaceModeSwitch'
import UserSettingsModal from './components/UserSettingsModal'
import { UserAvatar } from './components/UserAvatar'
import { useIsMobile } from './hooks/useIsMobile'
import { getT } from './i18n/translations'
import type { Lang } from './i18n/translations'

function AppInner() {
  const { user, profile, loading, signOut, justSignedIn, recoveryMode } = useAuth()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [dailyLoginRequired, setDailyLoginRequired] = useState(false)
  const mountTimeRef = useRef(Date.now())

  useEffect(() => {
    // recoveryMode: a user arriving from the recovery email link hasn't
    // "logged in today" yet — signing them out here would kill the reset flow.
    if (!loading && user && profile && !justSignedIn && !recoveryMode) {
      const today = new Date().toISOString().split('T')[0]
      const secondsSinceMount = (Date.now() - mountTimeRef.current) / 1000
      if (profile.last_login_date !== today && secondsSinceMount > 5) {
        setDailyLoginRequired(true)
        signOut()
      }
    }
  }, [loading, user, profile, justSignedIn, recoveryMode])

  const storedLang = (localStorage.getItem('excalinotion_auth_lang') ?? 'pt-BR') as Lang
  const tFallback = getT(storedLang)

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700 }}>E</div>
          <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{tFallback('app_loading')}</span>
        </div>
      </div>
    )
  }

  // Recovery link flow: show the set-new-password screen even while `user`
  // is momentarily null (the page handles the missing-session case itself).
  if (recoveryMode) return <ResetPasswordPage />

  if (!user) return <AuthPage dailyLoginRequired={dailyLoginRequired} />

  const showSidebar = sidebarOpen
  const closeSidebar = () => setSidebarOpen(false)

  return (
    <PagesProvider>
      <NotificationsProvider>
      <LanguageProvider>
      <ThemeProvider>
      <OnboardingProvider>
      <WorkspaceModeProvider>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        {/* Sidebar: overlay drawer on all devices */}
        {showSidebar && (
          <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 60, boxShadow: '4px 0 24px rgba(0,0,0,0.18)' }}>
            <Sidebar onNavigate={closeSidebar} />
          </div>
        )}

        {/* Backdrop */}
        {sidebarOpen && (
          <div
            onClick={closeSidebar}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 55 }}
          />
        )}

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', flexShrink: 0 }}>
              <button
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
                style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-text)', padding: 0 }}
              >
                <Menu size={18} />
              </button>
              <div style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700, fontSize: 13 }}>A</div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Akool</span>
              <WorkspaceModeSwitch />
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setShowAccount(true)}
                  title={profile?.display_name || user?.email || ''}
                  aria-label={tFallback('account_menu')}
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
          <UserSettingsModal open={showAccount} onClose={() => setShowAccount(false)} />
        </main>
      </div>
      </WorkspaceModeProvider>
      </OnboardingProvider>
      </ThemeProvider>
      </LanguageProvider>
      </NotificationsProvider>
    </PagesProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}

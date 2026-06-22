import { useState, useEffect, useRef } from 'react'
import { Menu } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PagesProvider } from './contexts/PagesContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { LanguageProvider } from './i18n/LanguageContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AuthPage from './pages/AuthPage'
import Sidebar from './components/Sidebar'
import MainContent from './components/MainContent'
import { useIsMobile } from './hooks/useIsMobile'
import { getT } from './i18n/translations'
import type { Lang } from './i18n/translations'

function AppInner() {
  const { user, profile, loading, signOut, justSignedIn } = useAuth()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dailyLoginRequired, setDailyLoginRequired] = useState(false)
  const mountTimeRef = useRef(Date.now())

  useEffect(() => {
    if (!loading && user && profile && !justSignedIn) {
      const today = new Date().toISOString().split('T')[0]
      const secondsSinceMount = (Date.now() - mountTimeRef.current) / 1000
      if (profile.last_login_date !== today && secondsSinceMount > 5) {
        setDailyLoginRequired(true)
        signOut()
      }
    }
  }, [loading, user, profile, justSignedIn])

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

  if (!user) return <AuthPage dailyLoginRequired={dailyLoginRequired} />

  const showSidebar = sidebarOpen
  const closeSidebar = () => setSidebarOpen(false)

  return (
    <PagesProvider>
      <NotificationsProvider>
      <LanguageProvider>
      <ThemeProvider>
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
            </div>
          <MainContent isMobile={isMobile} />
        </main>
      </div>
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

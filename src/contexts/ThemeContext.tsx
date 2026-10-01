import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { LOCAL_KEYS } from '../lib/localKeys'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { useLanguage } from '../i18n/LanguageContext'

export type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const LS_KEY = LOCAL_KEYS.theme

function applyTheme(t: Theme) {
  if (t === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile, updateProfile } = useAuth()
  const { showToast } = useToast()
  const { t: translate } = useLanguage()
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(LS_KEY) as Theme | null
    return stored === 'dark' ? 'dark' : 'light'
  })

  // Sync from profile when it loads
  useEffect(() => {
    if (profile?.theme) {
      const t = profile.theme
      setThemeState(t)
      localStorage.setItem(LS_KEY, t)
      applyTheme(t)
    }
  }, [profile?.theme])

  // Apply on initial mount from localStorage
  useEffect(() => {
    applyTheme(theme)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = useCallback(async (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(LS_KEY, t)
    applyTheme(t)
    // REL-004: o tema já vale na tela; se a conta não gravar, ele volta ao da
    // conta no próximo carregamento, e o aviso diz isso.
    const { error } = await updateProfile({ theme: t })
    if (error) {
      console.error('[theme] profile save failed', error)
      showToast('warning', translate('theme_save_error'), { dedupeKey: 'theme-save-error' })
    }
  }, [updateProfile, showToast, translate])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
